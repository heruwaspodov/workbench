import { and, eq, inArray } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { initiatives, type Initiative } from '../../db/schema'
import { jira, jiraConfigured, type JiraIssue } from '../../integrations/jira.client'
import { AppError } from '../../shared/errors'
import { normalizeEmail } from './email'

/** Children fetched per group of epics, as in the PGP epic suggestions: Jira pages at 100 and a group stops at this many. */
const CHILD_CAP = 6000
const EPIC_CHUNK = 40
const CHILD_CHUNK = 15

const quote = (key: string) => `"${key.replace(/"/g, '')}"`
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const option = (v: unknown): string | null => {
  const text = v && typeof v === 'object' ? (v as { value?: unknown; name?: unknown }).value ?? (v as { name?: unknown }).name : v
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

export interface SyncInput { year: number; quarter: number; keys?: string[] }
export interface SyncRow { jiraKey: string; changes: string[] }
export interface SyncResult {
  checked: number
  updated: number
  unchanged: number
  /** Keys Jira did not return (deleted, moved or not visible to the service account). Their rows are left as they are. */
  missing: string[]
  /** Keys whose children could not be counted completely, so only their progress was left alone. */
  skipped: string[]
  rows: SyncRow[]
  syncedAt: string
}

let running = false

/**
 * Refreshes the Jira-owned columns of a quarter's initiatives from Jira: status, project status, owner, est and actual
 * delivery date, criticality and the child progress. Everything the TPM or the sheet wrote (title, squad, remarks,
 * anomalies, repo note, links, markers, review flag) is left alone.
 */
export abstract class InitiativesSyncService {
  static async run(input: SyncInput): Promise<SyncResult> {
    if (!jiraConfigured()) throw new AppError(503, 'Jira service account is not configured', 'JIRA_NOT_CONFIGURED')
    if (running) throw new AppError(409, 'A sync is already running. Try again in a moment.', 'SYNC_RUNNING')
    running = true
    try { return await this.sync(input) } finally { running = false }
  }

  private static async sync({ year, quarter, keys }: SyncInput): Promise<SyncResult> {
    const wanted = keys?.map((k) => k.trim().toUpperCase())
    const where = wanted?.length
      ? and(eq(initiatives.year, year), eq(initiatives.quarter, quarter), inArray(initiatives.jiraKey, wanted))
      : and(eq(initiatives.year, year), eq(initiatives.quarter, quarter))
    const rows = await db.select().from(initiatives).where(where)
    const syncedAt = new Date()
    const empty: SyncResult = { checked: rows.length, updated: 0, unchanged: 0, missing: [], skipped: [], rows: [], syncedAt: syncedAt.toISOString() }
    if (!rows.length) return empty

    const j = env.jira
    const fields = ['summary', 'status', 'assignee', ...[j.estDeliveryField, j.deliveryDateField, j.criticalityField, j.projectStatusField].filter(Boolean)]

    const epics = new Map<string, JiraIssue>()
    for (let n = 0; n < rows.length; n += EPIC_CHUNK) {
      const chunk = rows.slice(n, n + EPIC_CHUNK).map((r) => quote(r.jiraKey))
      for (const e of (await jira.search(`key in (${chunk.join(', ')})`, fields, 100)).issues) epics.set(e.key, e)
    }

    // Progress: done over all child items, counted from the Jira status category. "Won't Fix" is in the done category.
    const progress = new Map<string, { done: number; total: number }>()
    const skipped = new Set<string>()
    const found = [...epics.keys()]
    for (let n = 0; n < found.length; n += CHILD_CHUNK) {
      const group = found.slice(n, n + CHILD_CHUNK)
      const r = await jira.search(`parent in (${group.map(quote).join(', ')})`, ['status', 'parent'], CHILD_CAP)
      if (r.truncated) { group.forEach((k) => skipped.add(k)); continue }
      for (const k of group) progress.set(k, { done: 0, total: 0 })
      for (const c of r.issues) {
        const p = progress.get(String(c.fields.parent?.key ?? ''))
        if (!p) continue
        p.total++
        if (c.fields.status?.statusCategory?.key === 'done') p.done++
      }
    }

    const missing: string[] = []
    const changed: SyncRow[] = []
    const checkedIds: string[] = []
    const patches: { id: string; patch: Partial<typeof initiatives.$inferInsert> }[] = []

    for (const row of rows) {
      const epic = epics.get(row.jiraKey)
      if (!epic) { missing.push(row.jiraKey); continue }
      checkedIds.push(row.id)

      const ownerName = typeof epic.fields.assignee?.displayName === 'string' ? epic.fields.assignee.displayName.trim() || null : null
      const next: Partial<Record<keyof Initiative, unknown>> = {
        epicStatus: String(epic.fields.status?.name ?? '').trim() || row.epicStatus,
        ownerName,
      }
      // Owner email: Jira's address wins when it returns one (it may hide it). Without one, the value from the sheet stays,
      // unless the epic now has a different owner (or none), because then it would point at the previous person.
      const jiraEmail = normalizeEmail(epic.fields.assignee?.emailAddress)
      if (jiraEmail) next.ownerEmail = jiraEmail
      else if (row.ownerEmail && (ownerName === null || (row.ownerName !== null && row.ownerName.trim().toLowerCase() !== ownerName.toLowerCase()))) next.ownerEmail = null
      if (j.projectStatusField) next.projectStatus = option(epic.fields[j.projectStatusField])
      if (j.estDeliveryField) next.estDeliveryDate = day(epic.fields[j.estDeliveryField])
      if (j.deliveryDateField) next.actualDeliveryDate = day(epic.fields[j.deliveryDateField])
      if (j.criticalityField) next.criticality = option(epic.fields[j.criticalityField])
      const p = progress.get(row.jiraKey)
      if (p) { next.totalItems = p.total || null; next.doneItems = p.total ? p.done : null }

      const patch: Record<string, unknown> = {}
      const names = new Set<string>()
      for (const [key, value] of Object.entries(next)) {
        if ((row as Record<string, unknown>)[key] === value) continue
        patch[key] = value
        names.add(key === 'doneItems' || key === 'totalItems' ? 'progress' : key)
      }
      if (names.size) {
        patches.push({ id: row.id, patch: patch as Partial<typeof initiatives.$inferInsert> })
        changed.push({ jiraKey: row.jiraKey, changes: [...names] })
      }
    }

    await db.transaction(async (tx) => {
      for (const { id, patch } of patches) await tx.update(initiatives).set(patch).where(eq(initiatives.id, id))
      if (checkedIds.length) await tx.update(initiatives).set({ jiraSyncedAt: syncedAt }).where(inArray(initiatives.id, checkedIds))
    })

    return {
      ...empty,
      updated: changed.length,
      unchanged: checkedIds.length - changed.length,
      missing,
      skipped: [...skipped].filter((k) => rows.some((r) => r.jiraKey === k)),
      rows: changed,
    }
  }
}
