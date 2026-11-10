import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { planItems, plans, type User } from '../../db/schema'
import { BadRequestError, PeriodExistsError } from '../../shared/errors'
import { formatPeriod } from '../../shared/period'
import { ExcelService } from './excel.service'
import type { PlanFromXlsxT } from './model'
import { normalizeStatus, periodFromTab } from './plan-import.util'
import { parsePgpSheet, type ParsedSheet } from './sheet-parser'
import { PlanService } from './plan.service'

const hasProgress = (p: ParsedSheet) => p.items.some((i) => i.currentValue || i.achievement != null || i.status)
const hasEvidence = (p: ParsedSheet) => p.items.some((i) => i.evidenceLinks.length)

const tryParse = (rows: string[][], links: string[][]): ParsedSheet | null => {
  try { return parsePgpSheet(rows, links) } catch { return null }
}

export abstract class PlanImportService {
  /** Reads an uploaded workbook and returns one tab parsed for review. Saves nothing. */
  static async preview(file: File, tab?: string) {
    let book: Awaited<ReturnType<typeof ExcelService.readWorkbookWithLinks>>
    try { book = await ExcelService.readWorkbookWithLinks(await file.arrayBuffer()) } catch { throw new BadRequestError('That file is not a readable .xlsx workbook') }
    const tabs = [...book.keys()]
    if (!tabs.length) throw new BadRequestError('Workbook has no sheets')

    const parsed = new Map(tabs.map((name) => [name, tryParse(book.get(name)!.rows, book.get(name)!.links)] as const))
    const when = (name: string) => periodFromTab(name, parsed.get(name)?.meta.period)
    const rank = (name: string) => { const w = when(name); return w ? w.year * 10 + w.quarter : 0 }
    // Default tab: the newest one that is actually filled in (progress present), else the newest parsable, else the first.
    const usable = tabs.filter((n) => parsed.get(n)?.items.length)
    const newest = (names: string[]) => [...names].sort((a, b) => rank(b) - rank(a))[0]
    const selectedTab = tab && book.has(tab)
      ? tab
      : newest(usable.filter((n) => hasProgress(parsed.get(n)!))) ?? newest(usable) ?? tabs[0]!

    const sheet = parsed.get(selectedTab)
    if (!sheet) {
      try { parsePgpSheet(book.get(selectedTab)!.rows) } catch (e) { throw new BadRequestError(`Tab "${selectedTab}": ${(e as Error).message}`) }
      throw new BadRequestError(`Tab "${selectedTab}" could not be read`)
    }
    return {
      tabs,
      selectedTab,
      sourceRef: `${file.name}#${selectedTab}`,
      suggestedPeriod: when(selectedTab),
      meta: sheet.meta,
      items: sheet.items.map((i) => ({ ...i, status: normalizeStatus(i.status) })),
      totalWeight: sheet.totalWeight,
      warnings: sheet.warnings,
      hasProgress: hasProgress(sheet),
      hasEvidence: hasEvidence(sheet),
    }
  }

  /** Creates the user's plan for one quarter from reviewed items. One plan per user per quarter. */
  static async create(user: User, input: PlanFromXlsxT) {
    const period = formatPeriod(input.year, input.quarter)
    const taken = await db.query.plans.findFirst({ where: and(eq(plans.userId, user.id), eq(plans.year, input.year), eq(plans.quarter, input.quarter)) })
    if (taken) throw new PeriodExistsError(taken.id, period)
    if (!input.items.length) throw new BadRequestError('Add at least one item')
    for (const i of input.items) {
      if (i.achievement != null && i.achievement > i.weight) {
        throw new BadRequestError(`Achievement (${i.achievement}) cannot exceed weight (${i.weight}) for "${i.initiative.slice(0, 60)}"`)
      }
    }

    const id = await db.transaction(async (tx) => {
      const [plan] = await tx.insert(plans).values({
        userId: user.id, year: input.year, quarter: input.quarter, sourceRef: input.sourceRef ?? null,
        division: input.division ?? null, sbu: input.sbu ?? null, sbuDetail: input.sbuDetail ?? null, directLeader: input.directLeader ?? null,
      }).onConflictDoNothing().returning()
      if (!plan) {
        const again = await tx.query.plans.findFirst({ where: and(eq(plans.userId, user.id), eq(plans.year, input.year), eq(plans.quarter, input.quarter)) })
        throw new PeriodExistsError(again!.id, period)
      }
      await tx.insert(planItems).values(input.items.map((i, position) => ({
        planId: plan.id, position,
        companyOkr: i.companyOkr ?? null, objective: i.objective, keyResult: i.keyResult, weight: i.weight, initiative: i.initiative,
        startValue: i.startValue ?? null, targetValue: i.targetValue ?? null, currentValue: i.currentValue ?? null,
        achievement: i.achievement ?? null, status: i.status ?? 'not_started',
        // Only http(s) links are kept: the UI renders them as clickable anchors.
        evidenceLinks: [...new Set((i.evidenceLinks ?? []).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)))],
        notes: i.notes ?? null,
      })))
      return plan.id
    })
    return PlanService.get(id, user)
  }
}
