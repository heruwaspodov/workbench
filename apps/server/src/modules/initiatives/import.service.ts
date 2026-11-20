import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client'
import { initiativeMilestones, initiatives, type Initiative } from '../../db/schema'
import { BadRequestError } from '../../shared/errors'
import { ExcelService } from '../pgp/excel.service'
import { isInitiativeSheet, parseInitiativeSheet, periodFromText, yearForMonth } from './sheet-parser'
import { JIRA_KEY, checkItems, clean, validDate, type Fields, type Milestone } from './service'

/** The planning sheet is wider and longer than a PGP sheet (week columns reach AF). */
const READ_LIMITS = { maxRows: 1000, maxCols: 60 }

/** Fields compared on re-import. `remark` is handled separately because it belongs to the TPM. */
const COMPARED = [
  'squad', 'title', 'criticality', 'epicStatus', 'projectStatus', 'ownerName', 'estDeliveryDate', 'actualDeliveryDate',
  'doneItems', 'totalItems', 'prdUrl', 'rfcUrl', 'remarkProposed', 'needsReview',
] as const
type Compared = typeof COMPARED[number]

/** A week-cell marker without a year; the year comes from the quarter chosen at import. */
export interface ImportMilestone { kind: 'release' | 'self_test'; month: number; day: number; label?: string | null }
export interface ImportItem extends Omit<Fields, 'milestones'> { jiraKey: string; title: string; milestones?: ImportMilestone[] }
export interface ImportInput { year: number; quarter: number; sourceRef?: string | null; items: ImportItem[]; dryRun?: boolean }
export interface ImportRow { jiraKey: string; title: string; action: 'new' | 'changed' | 'unchanged'; changes: string[] }

type Incoming = Omit<ImportItem, 'milestones'> & { milestones: Milestone[] }
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const markKey = (m: { kind: string; date: string; label?: string | null }) => `${m.kind}|${m.date}|${m.label ?? ''}`

export abstract class InitiativesImportService {
  /** Reads an uploaded workbook and returns one tab parsed for review. Saves nothing. */
  static async preview(file: File, tab?: string) {
    let book: Awaited<ReturnType<typeof ExcelService.readWorkbookWithLinks>>
    try { book = await ExcelService.readWorkbookWithLinks(await file.arrayBuffer(), READ_LIMITS) } catch { throw new BadRequestError('That file is not a readable .xlsx workbook') }

    const usable = [...book.keys()].filter((name) => isInitiativeSheet(book.get(name)!.rows))
    if (!usable.length) throw new BadRequestError('No tab has the "Jira Key" and "Initiative" columns. Export the initiatives tab as .xlsx.')
    // A tab name that is not in the file at all (the browser client sends an unset field as "undefined") means "pick for me".
    if (tab && book.has(tab) && !usable.includes(tab)) throw new BadRequestError(`Tab "${tab}" is not an initiatives tab`)
    const selectedTab = tab && usable.includes(tab) ? tab : usable.find((n) => /initiative/i.test(n)) ?? usable[0]!

    const sheet = book.get(selectedTab)!
    const parsed = parseInitiativeSheet(sheet.rows, sheet.links)
    return {
      tabs: usable,
      selectedTab,
      sourceRef: `${file.name}#${selectedTab}`,
      suggestedPeriod: periodFromText(selectedTab, file.name),
      items: parsed.items,
      warnings: parsed.warnings,
    }
  }

  /**
   * Upserts reviewed rows into one quarter. With `dryRun` it only reports what would happen.
   * Re-importing the same file changes nothing, a filled `remark` (owned by the TPM) is never overwritten,
   * and rows missing from the file are left alone.
   */
  static async run(input: ImportInput) {
    const { year, quarter } = input
    const incoming = new Map<string, Incoming>()
    for (const raw of input.items) {
      const jiraKey = raw.jiraKey.trim().toUpperCase()
      if (!JIRA_KEY.test(jiraKey)) throw new BadRequestError(`"${raw.jiraKey}" is not a Jira key (example: MESIGN-123)`)
      if (incoming.has(jiraKey)) throw new BadRequestError(`${jiraKey} appears more than once`)
      const { milestones = [], ...rest } = raw
      try {
        const fields = clean(rest)
        checkItems(fields.doneItems, fields.totalItems)
        const marks = milestones.map((m): Milestone => {
          const date = `${yearForMonth(year, quarter, m.month)}-${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}`
          validDate(date, 'Milestone date')
          return { kind: m.kind, date, label: m.label?.trim() || null }
        })
        incoming.set(jiraKey, { ...fields, jiraKey, title: fields.title!, milestones: marks })
      } catch (e) {
        if (e instanceof BadRequestError) throw new BadRequestError(`${jiraKey}: ${e.message}`)
        throw e
      }
    }

    const existing = await db.select().from(initiatives).where(and(eq(initiatives.year, year), eq(initiatives.quarter, quarter)))
    const byKey = new Map(existing.map((r) => [r.jiraKey, r]))
    const marksOf = new Map<string, { kind: string; date: string; label: string | null }[]>()
    if (existing.length) {
      for (const m of await db.select().from(initiativeMilestones).where(inArray(initiativeMilestones.initiativeId, existing.map((r) => r.id)))) {
        marksOf.set(m.initiativeId, [...(marksOf.get(m.initiativeId) ?? []), m])
      }
    }

    const rows: ImportRow[] = []
    const writes: { row: Incoming; current?: Initiative; patch: Record<string, unknown>; marksChanged: boolean }[] = []

    for (const [jiraKey, item] of incoming) {
      const current = byKey.get(jiraKey)
      if (!current) {
        rows.push({ jiraKey, title: item.title, action: 'new', changes: [] })
        writes.push({ row: item, patch: {}, marksChanged: true })
        continue
      }
      const patch: Record<string, unknown> = {}
      const changes: string[] = []
      for (const f of COMPARED) {
        const next = f === 'needsReview' ? item.needsReview ?? false : f === 'epicStatus' ? item.epicStatus ?? 'To Do' : item[f] ?? null
        if (!same(next, current[f])) { patch[f] = next; changes.push(f) }
      }
      if (!current.remark?.trim() && item.remark) { patch.remark = item.remark; changes.push('remark') }
      const a = (marksOf.get(current.id) ?? []).map(markKey).sort().join(';')
      const b = item.milestones.map(markKey).sort().join(';')
      const marksChanged = a !== b
      if (marksChanged) changes.push('milestones')
      rows.push({ jiraKey, title: item.title, action: changes.length ? 'changed' : 'unchanged', changes })
      if (changes.length) writes.push({ row: item, current, patch, marksChanged })
    }

    const summary = {
      dryRun: Boolean(input.dryRun),
      year, quarter,
      new: rows.filter((r) => r.action === 'new').length,
      changed: rows.filter((r) => r.action === 'changed').length,
      unchanged: rows.filter((r) => r.action === 'unchanged').length,
      rows,
    }
    if (input.dryRun || writes.length === 0) return summary

    const sourceRef = input.sourceRef?.trim() || null
    await db.transaction(async (tx) => {
      for (const w of writes) {
        let id = w.current?.id
        if (!id) {
          const { milestones: _skip, jiraKey, ...fields } = w.row
          const [created] = await tx.insert(initiatives).values({ ...fields, title: w.row.title, year, quarter, jiraKey, sourceRef })
            .onConflictDoNothing().returning({ id: initiatives.id })
          if (!created) throw new BadRequestError(`${jiraKey} was added by someone else while importing. Preview again.`)
          id = created.id
        } else {
          await tx.update(initiatives).set({ ...(w.patch as Partial<typeof initiatives.$inferInsert>), sourceRef: sourceRef ?? w.current!.sourceRef }).where(eq(initiatives.id, id))
        }
        if (w.marksChanged) {
          await tx.delete(initiativeMilestones).where(eq(initiativeMilestones.initiativeId, id))
          if (w.row.milestones.length) await tx.insert(initiativeMilestones).values(w.row.milestones.map((m) => ({ initiativeId: id!, kind: m.kind, date: m.date, label: m.label })))
        }
      }
    })
    return summary
  }
}
