import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { planItems, plans, templateItems, templates, users, type PlanItem, type User } from '../../db/schema'
import { BadRequestError, ForbiddenError, NotFoundError, PeriodExistsError } from '../../shared/errors'
import { formatPeriod, parsePeriod } from '../../shared/period'
import type { PlanItemInputT } from './model'

const round = (n: number) => Math.round(n * 100) / 100

export const scoreOf = (items: Pick<PlanItem, 'weight' | 'achievement'>[]) => ({
  totalWeight: round(items.reduce((s, i) => s + i.weight, 0)),
  score: round(items.reduce((s, i) => s + Math.min(i.achievement ?? 0, i.weight), 0)),
})

export abstract class PlanService {
  static async listMine(user: User) {
    const rows = await db
      .select({
        id: plans.id, status: plans.status, updatedAt: plans.updatedAt, submittedAt: plans.submittedAt,
        templateId: plans.templateId, templateTitle: sql<string>`coalesce(${templates.title}, 'PGP ' || "pgp_plans"."year" || '-Q' || "pgp_plans"."quarter")`,
        year: plans.year, quarter: plans.quarter,
        totalWeight: sql<number>`(select coalesce(sum(pi.weight),0)::float from pgp_plan_items pi where pi.plan_id = "pgp_plans"."id")`,
        score: sql<number>`(select coalesce(sum(least(coalesce(pi.achievement,0), pi.weight)),0)::float from pgp_plan_items pi where pi.plan_id = "pgp_plans"."id")`,
      })
      .from(plans)
      .leftJoin(templates, eq(templates.id, plans.templateId))
      .where(eq(plans.userId, user.id))
      .orderBy(desc(plans.year), desc(plans.quarter))
    return rows.map((r) => ({ ...r, period: formatPeriod(r.year, r.quarter) }))
  }

  /** Owner, active direct leader or admin may read; only owner may write. Pending requests grant nothing. */
  static async get(id: string, user: User, mode: 'read' | 'write' = 'read') {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, id),
      with: {
        items: { orderBy: [asc(planItems.position)] },
        template: { columns: { id: true, title: true, period: true, status: true } },
        user: { columns: { id: true, name: true, email: true, managerId: true } },
      },
    })
    if (!plan) throw new NotFoundError('Plan')
    const isOwner = plan.userId === user.id
    const isLeader = !isOwner && plan.user.managerId === user.id
    const isAdmin = user.role === 'admin'
    if (!isOwner && !(mode === 'read' && (isLeader || isAdmin))) throw new ForbiddenError()
    const viewerRole = isOwner ? 'owner' : isLeader ? 'leader' : 'admin'
    const period = formatPeriod(plan.year, plan.quarter)
    const title = plan.template?.title ?? `PGP ${period}`
    return { ...plan, period, title, ...scoreOf(plan.items), canEdit: isOwner, viewerRole } as const
  }

  static async create(user: User, templateId: string) {
    const tpl = await db.query.templates.findFirst({
      where: eq(templates.id, templateId),
      with: { items: { orderBy: [asc(templateItems.position)] } },
    })
    if (!tpl || tpl.status !== 'published') throw new NotFoundError('Published template')

    const when = parsePeriod(tpl.period)
    if (!when) throw new BadRequestError(`Template period "${tpl.period}" is not in YYYY-Qn format; ask an admin to fix it`)
    const taken = await db.query.plans.findFirst({ where: and(eq(plans.userId, user.id), eq(plans.year, when.year), eq(plans.quarter, when.quarter)) })
    if (taken) throw new PeriodExistsError(taken.id, tpl.period)

    // Prefill header from the user's previous plan.
    const previous = await db.query.plans.findFirst({ where: eq(plans.userId, user.id), orderBy: [desc(plans.createdAt)] })
    const managerName = previous?.directLeader || !user.managerId
      ? null
      : (await db.select({ name: users.name }).from(users).where(eq(users.id, user.managerId)))[0]?.name ?? null

    const id = await db.transaction(async (tx) => {
      // A concurrent create for the same quarter loses on the unique index; report it like the check above.
      const [plan] = await tx.insert(plans).values({
        templateId, userId: user.id, year: when.year, quarter: when.quarter,
        division: previous?.division, sbu: previous?.sbu, sbuDetail: previous?.sbuDetail, directLeader: previous?.directLeader || managerName,
      }).onConflictDoNothing().returning()
      if (!plan) {
        const again = await tx.query.plans.findFirst({ where: and(eq(plans.userId, user.id), eq(plans.year, when.year), eq(plans.quarter, when.quarter)) })
        throw new PeriodExistsError(again!.id, tpl.period)
      }
      if (tpl.items.length) {
        await tx.insert(planItems).values(tpl.items.map((i) => ({
          planId: plan!.id, templateItemId: i.id, position: i.position,
          companyOkr: i.companyOkr, objective: i.objective, keyResult: i.keyResult, weight: i.weight, initiative: i.initiative,
        })))
      }
      return plan!.id
    })
    return this.get(id, user)
  }

  static async updateHeader(id: string, user: User, patch: { division?: string | null; sbu?: string | null; sbuDetail?: string | null; directLeader?: string | null }) {
    await this.get(id, user, 'write')
    await db.update(plans).set(patch).where(eq(plans.id, id))
    return this.get(id, user)
  }

  /**
   * Draft plans: full edit (add / remove / reorder / change weights).
   * Submitted plans: planning columns are locked — only progress columns of existing items are updated.
   */
  static async replaceItems(id: string, user: User, input: PlanItemInputT[]) {
    const plan = await this.get(id, user, 'write')
    let items = input
    if (plan.status === 'submitted') {
      const incoming = new Map(input.filter((i) => i.id).map((i) => [i.id!, i]))
      items = plan.items.map((orig) => {
        const i = incoming.get(orig.id)
        return {
          id: orig.id, templateItemId: orig.templateItemId, companyOkr: orig.companyOkr, objective: orig.objective,
          keyResult: orig.keyResult, weight: orig.weight, initiative: orig.initiative,
          startValue: i ? i.startValue : orig.startValue,
          targetValue: i ? i.targetValue : orig.targetValue,
          currentValue: i ? i.currentValue : orig.currentValue,
          achievement: i ? i.achievement : orig.achievement,
          status: i?.status ?? orig.status,
          evidenceLinks: i?.evidenceLinks ?? orig.evidenceLinks,
          notes: i ? i.notes : orig.notes,
        }
      })
    }
    for (const i of items) {
      if (i.achievement != null && i.achievement > i.weight) {
        throw new BadRequestError(`Achievement (${i.achievement}) cannot exceed weight (${i.weight}) for "${i.initiative.slice(0, 60)}"`)
      }
    }
    await db.transaction(async (tx) => {
      const keepIds = items.map((i) => i.id).filter((x): x is string => Boolean(x))
      await tx.delete(planItems).where(and(eq(planItems.planId, id), keepIds.length ? notInArray(planItems.id, keepIds) : undefined))
      const existing = keepIds.length
        ? new Set((await tx.select({ id: planItems.id }).from(planItems).where(and(eq(planItems.planId, id), inArray(planItems.id, keepIds)))).map((r) => r.id))
        : new Set<string>()
      for (const [position, i] of items.entries()) {
        const row = {
          planId: id, position,
          templateItemId: i.templateItemId ?? null,
          companyOkr: i.companyOkr ?? null, objective: i.objective, keyResult: i.keyResult, weight: i.weight, initiative: i.initiative,
          startValue: i.startValue ?? null, targetValue: i.targetValue ?? null, currentValue: i.currentValue ?? null,
          achievement: i.achievement ?? null, status: i.status ?? 'not_started',
          evidenceLinks: (i.evidenceLinks ?? []).map((l) => l.trim()).filter(Boolean), notes: i.notes ?? null,
        }
        if (i.id && existing.has(i.id)) await tx.update(planItems).set(row).where(eq(planItems.id, i.id))
        else await tx.insert(planItems).values(row)
      }
      await tx.update(plans).set({ updatedAt: new Date() }).where(eq(plans.id, id))
    })
    return this.get(id, user)
  }

  static async setStatus(id: string, user: User, status: 'draft' | 'submitted') {
    const plan = await this.get(id, user, 'write')
    if (status === 'submitted' && plan.totalWeight !== 100) {
      throw new BadRequestError(`Total weight must be 100% before submitting (currently ${plan.totalWeight}%)`)
    }
    await db.update(plans).set({ status, submittedAt: status === 'submitted' ? new Date() : null }).where(eq(plans.id, id))
    return this.get(id, user)
  }

  static async remove(id: string, user: User) {
    await this.get(id, user, 'write')
    await db.delete(plans).where(eq(plans.id, id))
    return { ok: true }
  }

  static ownerOf = async (id: string) =>
    (await db.select({ name: users.name }).from(plans).innerJoin(users, eq(users.id, plans.userId)).where(eq(plans.id, id)))[0]
}
