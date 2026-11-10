import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { plans, reportingRequests, templates, users, type User } from '../../db/schema'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors'
import type { RequestDirection } from './model'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

const publicUser = { id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl }

/** Rules shared by requests, accept and admin set: no self-link, no mutual link, no duplicate active link. */
async function assertPair(ex: Executor, reportId: string, leaderId: string, opts: { allowActive?: boolean } = {}) {
  if (reportId === leaderId) throw new BadRequestError('You cannot be your own leader or report')
  const found = await ex.select({ id: users.id, managerId: users.managerId }).from(users).where(inArray(users.id, [reportId, leaderId]))
  const report = found.find((u) => u.id === reportId)
  const leader = found.find((u) => u.id === leaderId)
  if (!report || !leader) throw new NotFoundError('User')
  if (leader.managerId === reportId) throw new BadRequestError('Two people cannot be each other\'s leader')
  if (!opts.allowActive && report.managerId === leaderId) throw new BadRequestError('This reporting line is already active')
}

async function loadRequest(ex: Executor, id: string) {
  const [req] = await ex.select().from(reportingRequests).where(eq(reportingRequests.id, id))
  if (!req) throw new NotFoundError('Request')
  return req
}

const isParty = (req: { reportId: string; leaderId: string }, userId: string) => req.reportId === userId || req.leaderId === userId

export abstract class OrgService {
  static async me(user: User) {
    const [leaderRow] = user.managerId
      ? await db.select(publicUser).from(users).where(eq(users.id, user.managerId))
      : []
    const reports = await db.select(publicUser).from(users).where(eq(users.managerId, user.id)).orderBy(users.name)

    const reqs = await db.select().from(reportingRequests)
      .where(or(eq(reportingRequests.reportId, user.id), eq(reportingRequests.leaderId, user.id)))
      .orderBy(desc(reportingRequests.createdAt))
    const otherIds = [...new Set(reqs.map((r) => (r.reportId === user.id ? r.leaderId : r.reportId)))]
    const others = otherIds.length ? await db.select(publicUser).from(users).where(inArray(users.id, otherIds)) : []
    const byId = new Map(others.map((u) => [u.id, u]))

    const item = (r: (typeof reqs)[number]) => {
      const direction: RequestDirection = r.reportId === user.id ? 'as_report' : 'as_leader'
      return { requestId: r.id, direction, user: byId.get(direction === 'as_report' ? r.leaderId : r.reportId)!, createdAt: r.createdAt }
    }
    return {
      leader: leaderRow ?? null,
      reports,
      incoming: reqs.filter((r) => r.requestedBy !== user.id).map(item),
      outgoing: reqs.filter((r) => r.requestedBy === user.id).map(item),
    }
  }

  static async searchUsers(user: User, q = '') {
    const term = q.trim()
    if (!term) return []
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`
    return db.select(publicUser).from(users)
      .where(and(ne(users.id, user.id), or(sql`${users.name} ilike ${like}`, sql`${users.email} ilike ${like}`)))
      .orderBy(users.name)
      .limit(20)
  }

  /** Report proposes a leader. */
  static async requestLeader(user: User, leaderId: string) {
    return this.propose(user, user.id, leaderId)
  }

  /** Leader proposes a report. */
  static async requestReport(user: User, reportId: string) {
    return this.propose(user, reportId, user.id)
  }

  private static async propose(user: User, reportId: string, leaderId: string) {
    await assertPair(db, reportId, leaderId)
    const [row] = await db.insert(reportingRequests)
      .values({ reportId, leaderId, requestedBy: user.id })
      .onConflictDoUpdate({
        target: reportingRequests.reportId,
        set: { leaderId, requestedBy: user.id, createdAt: sql`now()` },
      })
      .returning()
    return { requestId: row!.id }
  }

  static async accept(user: User, requestId: string) {
    await db.transaction(async (tx) => {
      const req = await loadRequest(tx, requestId)
      if (!isParty(req, user.id)) throw new ForbiddenError()
      if (req.requestedBy === user.id) throw new ForbiddenError('The other person has to confirm this request')
      await assertPair(tx, req.reportId, req.leaderId)
      await tx.update(users).set({ managerId: req.leaderId }).where(eq(users.id, req.reportId))
      await tx.delete(reportingRequests).where(eq(reportingRequests.id, req.id))
    })
    return { ok: true }
  }

  static async reject(user: User, requestId: string) {
    const req = await loadRequest(db, requestId)
    if (!isParty(req, user.id)) throw new ForbiddenError()
    if (req.requestedBy === user.id) throw new ForbiddenError('Use cancel for your own request')
    await db.delete(reportingRequests).where(eq(reportingRequests.id, req.id))
    return { ok: true }
  }

  static async cancel(user: User, requestId: string) {
    const req = await loadRequest(db, requestId)
    if (req.requestedBy !== user.id) throw new ForbiddenError('Only the requester can cancel')
    await db.delete(reportingRequests).where(eq(reportingRequests.id, req.id))
    return { ok: true }
  }

  /** Leader drops an active direct report. */
  static async removeReport(user: User, reportId: string) {
    const rows = await db.update(users).set({ managerId: null })
      .where(and(eq(users.id, reportId), eq(users.managerId, user.id))).returning({ id: users.id })
    if (!rows.length) throw new NotFoundError('Direct report')
    return { ok: true }
  }

  /** Report drops their own active leader. */
  static async removeLeader(user: User) {
    await db.update(users).set({ managerId: null }).where(eq(users.id, user.id))
    return { ok: true }
  }

  /** Admin correction: sets (or clears) the active leader and discards the user's pending request. */
  static async adminSetManager(userId: string, managerId: string | null) {
    await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))
      if (!target) throw new NotFoundError('User')
      if (managerId) await assertPair(tx, userId, managerId, { allowActive: true })
      await tx.update(users).set({ managerId }).where(eq(users.id, userId))
      await tx.delete(reportingRequests).where(eq(reportingRequests.reportId, userId))
    })
    return { ok: true }
  }

  /** Active direct reports with their plan for one period (default: newest published template). */
  static async team(user: User, period?: string) {
    const reports = await db.select(publicUser).from(users).where(eq(users.managerId, user.id)).orderBy(users.name)
    const effective = period ?? (await this.latestPublishedPeriod())
    if (!reports.length || !effective) return { period: effective ?? null, members: reports.map((u) => ({ user: u, plan: null })) }

    const rows = await db
      .select({
        userId: plans.userId, planId: plans.id, status: plans.status, updatedAt: plans.updatedAt,
        totalWeight: sql<number>`(select coalesce(sum(pi.weight),0)::float from pgp_plan_items pi where pi.plan_id = "pgp_plans"."id")`,
        score: sql<number>`(select coalesce(sum(least(coalesce(pi.achievement,0), pi.weight)),0)::float from pgp_plan_items pi where pi.plan_id = "pgp_plans"."id")`,
      })
      .from(plans)
      .innerJoin(templates, eq(templates.id, plans.templateId))
      .where(and(eq(templates.period, effective), inArray(plans.userId, reports.map((r) => r.id))))
      .orderBy(desc(plans.updatedAt))
    const planOf = new Map<string, (typeof rows)[number]>()
    for (const r of rows) if (!planOf.has(r.userId)) planOf.set(r.userId, r)

    return {
      period: effective,
      members: reports.map((u) => {
        const p = planOf.get(u.id)
        return { user: u, plan: p ? { planId: p.planId, status: p.status, score: p.score, totalWeight: p.totalWeight, updatedAt: p.updatedAt } : null }
      }),
    }
  }

  private static async latestPublishedPeriod() {
    const [row] = await db.select({ period: templates.period }).from(templates)
      .where(eq(templates.status, 'published')).orderBy(desc(templates.period), desc(templates.updatedAt)).limit(1)
    return row?.period
  }
}
