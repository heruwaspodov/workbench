import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { initiativeMilestones, initiatives, type Initiative, type InitiativeMilestone } from '../../db/schema'
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors'
import { anomaliesFor, statusCategory, type StatusCategory } from './anomalies'
import type { InitiativeFilters } from './model'

export type Milestone = { kind: 'release' | 'self_test'; date: string; label?: string | null }
export type Fields = Partial<Omit<Initiative, 'id' | 'year' | 'quarter' | 'jiraKey' | 'sourceRef' | 'createdAt' | 'updatedAt'>> & { milestones?: Milestone[] }

export interface InitiativeView extends Initiative {
  statusCategory: StatusCategory
  anomalies: string[]
  /** Derived: "Open" while there is anything to act on, otherwise null. */
  resolution: 'Open' | null
  milestones: Pick<InitiativeMilestone, 'id' | 'kind' | 'date' | 'label'>[]
}

export const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/

/** Today in Jakarta as YYYY-MM-DD (the team's calendar). */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

export const validDate = (value: string, label: string) => {
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BadRequestError(`${label} "${value}" is not a real date`)
}

/** Links are rendered as <a>; only http(s) is accepted so a stored value can never be a script URL. */
const validUrl = (value: string, label: string) => {
  try {
    const u = new URL(value)
    if (u.protocol === 'http:' || u.protocol === 'https:') return
  } catch { /* fall through */ }
  throw new BadRequestError(`${label} must be an http(s) link`)
}

export function clean(fields: Fields): Fields {
  const out: Fields = { ...fields }
  for (const key of ['squad', 'criticality', 'projectStatus', 'ownerName', 'remark', 'remarkProposed'] as const) {
    if (typeof out[key] === 'string') out[key] = out[key]!.trim() || null
  }
  if (typeof out.title === 'string') {
    out.title = out.title.trim()
    if (!out.title) throw new BadRequestError('Title is required')
  }
  if (typeof out.epicStatus === 'string') out.epicStatus = out.epicStatus.trim() || 'To Do'
  for (const key of ['estDeliveryDate', 'actualDeliveryDate'] as const) {
    if (typeof out[key] === 'string') out[key] = out[key]!.slice(0, 10)
    if (typeof out[key] === 'string') validDate(out[key]!, key === 'estDeliveryDate' ? 'Est. Delivery Date' : 'Actual Delivery Date')
  }
  for (const key of ['prdUrl', 'rfcUrl'] as const) {
    if (typeof out[key] === 'string') {
      out[key] = out[key]!.trim() || null
      if (out[key]) validUrl(out[key]!, key === 'prdUrl' ? 'PRD link' : 'RFC link')
    }
  }
  if (out.milestones) out.milestones = out.milestones.map((m) => ({ ...m, date: m.date.slice(0, 10) }))
  for (const m of out.milestones ?? []) validDate(m.date, 'Milestone date')
  return out
}

export function checkItems(done: number | null | undefined, total: number | null | undefined) {
  if (done != null && total != null && done > total) throw new BadRequestError('Done items cannot exceed total items')
  if (done != null && total == null) throw new BadRequestError('Total items is required when done items is set')
}

async function view(rows: Initiative[]): Promise<InitiativeView[]> {
  if (rows.length === 0) return []
  const marks = await db.select().from(initiativeMilestones)
    .where(inArray(initiativeMilestones.initiativeId, rows.map((r) => r.id)))
    .orderBy(asc(initiativeMilestones.date))
  const byInitiative = new Map<string, InitiativeView['milestones']>()
  for (const m of marks) {
    const list = byInitiative.get(m.initiativeId) ?? []
    list.push({ id: m.id, kind: m.kind as Milestone['kind'], date: m.date, label: m.label })
    byInitiative.set(m.initiativeId, list)
  }
  const now = today()
  return rows.map((r) => {
    const anomalies = anomaliesFor(r, now)
    return { ...r, statusCategory: statusCategory(r.epicStatus), anomalies, resolution: anomalies.length ? 'Open' : null, milestones: byInitiative.get(r.id) ?? [] }
  })
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export abstract class InitiativesService {
  static async list(f: InitiativeFilters): Promise<InitiativeView[]> {
    const where: (SQL | undefined)[] = [eq(initiatives.year, f.year), eq(initiatives.quarter, f.quarter)]
    if (f.squad) where.push(eq(initiatives.squad, f.squad))
    if (f.criticality) where.push(eq(initiatives.criticality, f.criticality))
    if (f.status) where.push(sql`lower(${initiatives.epicStatus}) = lower(${f.status})`)
    if (f.month) where.push(sql`to_char(${initiatives.estDeliveryDate}, 'YYYY-MM') = ${f.month}`)
    const q = f.q?.trim()
    if (q) {
      const pattern = `%${likeEscape(q)}%`
      where.push(or(ilike(initiatives.title, pattern), ilike(initiatives.jiraKey, pattern), ilike(initiatives.ownerName, pattern), ilike(initiatives.remark, pattern)))
    }
    const rows = await db.select().from(initiatives).where(and(...where)).orderBy(asc(initiatives.squad), asc(initiatives.jiraKey))
    return view(rows)
  }

  /** Quarters that have data, newest first (feeds the Year + Quarter selector). */
  static async periods() {
    const rows = await db.select({ year: initiatives.year, quarter: initiatives.quarter, count: sql<number>`count(*)::int` })
      .from(initiatives).groupBy(initiatives.year, initiatives.quarter).orderBy(desc(initiatives.year), desc(initiatives.quarter))
    return rows
  }

  static async summary(year: number, quarter: number) {
    const rows = await this.list({ year, quarter })
    const squads = new Map<string, { squad: string; total: number; done: number }>()
    for (const r of rows) {
      const name = r.squad ?? 'Unassigned'
      const s = squads.get(name) ?? { squad: name, total: 0, done: 0 }
      s.total++
      if (r.statusCategory === 'done') s.done++
      squads.set(name, s)
    }
    const count = (c: StatusCategory) => rows.filter((r) => r.statusCategory === c).length
    const done = count('done')
    return {
      year, quarter,
      total: rows.length,
      done,
      donePercent: rows.length ? Math.round((done / rows.length) * 100) : 0,
      active: count('active'),
      notStarted: count('todo'),
      needsReview: rows.filter((r) => r.needsReview).length,
      withAnomalies: rows.filter((r) => r.anomalies.length > 0).length,
      squads: [...squads.values()].sort((a, b) => a.squad.localeCompare(b.squad)),
    }
  }

  static async get(id: string): Promise<InitiativeView> {
    const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id))
    if (!row) throw new NotFoundError('Initiative')
    return (await view([row]))[0]!
  }

  static async create(input: { year: number; quarter: number; jiraKey: string; sourceRef?: string | null } & Fields & { title: string }) {
    const jiraKey = input.jiraKey.trim().toUpperCase()
    if (!JIRA_KEY.test(jiraKey)) throw new BadRequestError(`"${input.jiraKey}" is not a Jira key (example: MESIGN-123)`)
    const { year, quarter, sourceRef, ...rest } = input
    const { milestones, ...fields } = clean(rest) // clean() also validates the milestone dates
    checkItems(fields.doneItems, fields.totalItems)

    const id = await db.transaction(async (tx) => {
      // A concurrent create for the same epic loses on the unique index and is reported like the normal duplicate.
      const [row] = await tx.insert(initiatives).values({ ...fields, title: fields.title!, year, quarter, jiraKey, sourceRef: sourceRef?.trim() || null })
        .onConflictDoNothing().returning({ id: initiatives.id })
      if (!row) throw new AppError(409, `${jiraKey} is already in ${year} Q${quarter}.`, 'INITIATIVE_EXISTS')
      if (milestones?.length) await tx.insert(initiativeMilestones).values(milestones.map((m) => ({ initiativeId: row.id, kind: m.kind, date: m.date, label: m.label?.trim() || null })))
      return row.id
    })
    return this.get(id)
  }

  static async update(id: string, patch: Fields) {
    const current = await this.get(id)
    const { milestones, ...rest } = clean(patch)
    if (Object.keys(rest).length === 0 && milestones === undefined) throw new BadRequestError('Nothing to update')
    checkItems('doneItems' in rest ? rest.doneItems : current.doneItems, 'totalItems' in rest ? rest.totalItems : current.totalItems)

    await db.transaction(async (tx) => {
      if (Object.keys(rest).length) await tx.update(initiatives).set(rest).where(eq(initiatives.id, id))
      else await tx.update(initiatives).set({ updatedAt: new Date() }).where(eq(initiatives.id, id))
      if (milestones) {
        await tx.delete(initiativeMilestones).where(eq(initiativeMilestones.initiativeId, id))
        if (milestones.length) await tx.insert(initiativeMilestones).values(milestones.map((m) => ({ initiativeId: id, kind: m.kind, date: m.date, label: m.label?.trim() || null })))
      }
    })
    return this.get(id)
  }

  static async remove(id: string) {
    const [row] = await db.delete(initiatives).where(eq(initiatives.id, id)).returning({ id: initiatives.id })
    if (!row) throw new NotFoundError('Initiative')
    return { ok: true as const }
  }
}
