import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../src/shared/errors'
import { setupTestDb } from './db'

// Synthetic users only. Everything created here is tagged and removed in afterAll.
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let ctx: Awaited<ReturnType<typeof setupTestDb>>
let S: typeof import('../src/db/schema')
let Org: typeof import('../src/modules/org/service').OrgService
let Plans: typeof import('../src/modules/pgp/plan.service').PlanService
let templateId = ''
let seq = 0

type U = typeof import('../src/db/schema').users.$inferSelect

beforeAll(async () => {
  ctx = await setupTestDb()
  S = await import('../src/db/schema')
  Org = (await import('../src/modules/org/service')).OrgService
  Plans = (await import('../src/modules/pgp/plan.service')).PlanService
  const [tpl] = await ctx.db.insert(S.templates).values({ title: `${tag} template`, period: '2099-Q1', status: 'published' }).returning()
  templateId = tpl!.id
  await ctx.db.insert(S.templateItems).values({ templateId, position: 0, objective: 'O', keyResult: 'KR', weight: 100, initiative: 'I' })
})

afterAll(async () => {
  await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`)) // cascades requests and plans
  await ctx.db.delete(S.templates).where(eq(S.templates.id, templateId))
})

const mk = async (name: string, role: 'admin' | 'member' = 'member'): Promise<U> => {
  const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-${++seq}-${name}@test.local`, name: `${tag} ${name}`, role }).returning()
  return u!
}
const fresh = async (u: U): Promise<U> => (await ctx.db.select().from(S.users).where(eq(S.users.id, u.id)))[0]!
const pending = (reportId: string) => ctx.db.select().from(S.reportingRequests).where(eq(S.reportingRequests.reportId, reportId))

describe('reporting line requests', () => {
  test('report proposes leader, leader accepts', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    const { requestId } = await Org.requestLeader(report, leader.id)

    const inbox = await Org.me(leader)
    expect(inbox.incoming).toHaveLength(1)
    expect(inbox.incoming[0]).toMatchObject({ requestId, direction: 'as_leader', user: { id: report.id } })
    expect((await Org.me(report)).outgoing[0]).toMatchObject({ requestId, direction: 'as_report' })

    await Org.accept(leader, requestId)
    expect((await fresh(report)).managerId).toBe(leader.id)
    expect(await pending(report.id)).toHaveLength(0)
    expect((await Org.team(leader, '2099-Q1')).members.map((m) => m.user.id)).toEqual([report.id])
  })

  test('leader proposes report, report accepts', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    const { requestId } = await Org.requestReport(leader, report.id)

    expect((await Org.me(report)).incoming[0]).toMatchObject({ requestId, direction: 'as_report', user: { id: leader.id } })
    await Org.accept(report, requestId)
    expect((await fresh(report)).managerId).toBe(leader.id)
    expect((await Org.me(leader)).reports.map((r) => r.id)).toEqual([report.id])
  })

  test('requester cannot accept own request, in either direction', async () => {
    const [a, b] = [await mk('a'), await mk('b')]
    const fromReport = await Org.requestLeader(b, a.id)
    await expect(Org.accept(b, fromReport.requestId)).rejects.toBeInstanceOf(ForbiddenError)
    const fromLeader = await Org.requestReport(a, b.id)
    await expect(Org.accept(a, fromLeader.requestId)).rejects.toBeInstanceOf(ForbiddenError)
    expect((await fresh(b)).managerId).toBeNull()
  })

  test('third party cannot accept or reject', async () => {
    const [leader, report, other] = [await mk('leader'), await mk('report'), await mk('other')]
    const { requestId } = await Org.requestLeader(report, leader.id)
    await expect(Org.accept(other, requestId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Org.reject(other, requestId)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await pending(report.id)).toHaveLength(1)
  })

  test('reject removes the request without linking', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    const { requestId } = await Org.requestLeader(report, leader.id)
    await expect(Org.reject(report, requestId)).rejects.toBeInstanceOf(ForbiddenError)
    await Org.reject(leader, requestId)
    expect(await pending(report.id)).toHaveLength(0)
    expect((await fresh(report)).managerId).toBeNull()
  })

  test('only the requester can cancel', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    const { requestId } = await Org.requestLeader(report, leader.id)
    await expect(Org.cancel(leader, requestId)).rejects.toBeInstanceOf(ForbiddenError)
    await Org.cancel(report, requestId)
    expect(await pending(report.id)).toHaveLength(0)
    await expect(Org.cancel(report, requestId)).rejects.toBeInstanceOf(NotFoundError)
  })

  test('a new request replaces the pending one', async () => {
    const [x, y, report] = [await mk('x'), await mk('y'), await mk('report')]
    await Org.requestLeader(report, x.id)
    await Org.requestReport(y, report.id)
    const rows = await pending(report.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ leaderId: y.id, requestedBy: y.id })
  })

  test('accepting a new leader replaces the old one', async () => {
    const [old, next, report] = [await mk('old'), await mk('next'), await mk('report')]
    await Org.accept(old, (await Org.requestLeader(report, old.id)).requestId)
    await Org.accept(next, (await Org.requestLeader(report, next.id)).requestId)
    expect((await fresh(report)).managerId).toBe(next.id)
  })

  test('leader drops a report, report drops a leader', async () => {
    const [leader, report, stranger] = [await mk('leader'), await mk('report'), await mk('stranger')]
    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    await expect(Org.removeReport(leader, stranger.id)).rejects.toBeInstanceOf(NotFoundError)
    await Org.removeReport(leader, report.id)
    expect((await fresh(report)).managerId).toBeNull()

    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    await Org.removeLeader(report)
    expect((await fresh(report)).managerId).toBeNull()
  })
})

describe('reporting line validation', () => {
  test('rejects self links', async () => {
    const a = await mk('a')
    await expect(Org.requestLeader(a, a.id)).rejects.toBeInstanceOf(BadRequestError)
    await expect(Org.requestReport(a, a.id)).rejects.toBeInstanceOf(BadRequestError)
  })

  test('rejects mutual links and duplicates of an active link', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    await expect(Org.requestLeader(report, leader.id)).rejects.toBeInstanceOf(BadRequestError)
    await expect(Org.requestReport(leader, report.id)).rejects.toBeInstanceOf(BadRequestError)
    await expect(Org.requestLeader(leader, report.id)).rejects.toBeInstanceOf(BadRequestError)
  })

  test('accept re-checks mutual links created by crossing requests', async () => {
    const [a, b] = [await mk('a'), await mk('b')]
    const first = await Org.requestLeader(b, a.id)
    const second = await Org.requestLeader(a, b.id)
    await Org.accept(a, first.requestId)
    await expect(Org.accept(b, second.requestId)).rejects.toBeInstanceOf(BadRequestError)
    expect((await fresh(a)).managerId).toBeNull()
  })

  test('unknown user is not found', async () => {
    const a = await mk('a')
    await expect(Org.requestLeader(a, '00000000-0000-4000-8000-00000000dead')).rejects.toBeInstanceOf(NotFoundError)
  })

  test('search excludes self and empty queries', async () => {
    const [a, b] = [await mk('findme'), await mk('other')]
    expect((await Org.searchUsers(a, `${tag} findme`)).map((u) => u.id)).toEqual([])
    expect((await Org.searchUsers(b, `${tag} findme`)).map((u) => u.id)).toEqual([a.id])
    expect(await Org.searchUsers(a, '   ')).toEqual([])
  })
})

describe('admin set manager', () => {
  test('sets directly, clears pending, can unset', async () => {
    const [leader, report, other] = [await mk('leader'), await mk('report'), await mk('other')]
    await Org.requestLeader(report, other.id)
    await Org.adminSetManager(report.id, leader.id)
    expect((await fresh(report)).managerId).toBe(leader.id)
    expect(await pending(report.id)).toHaveLength(0)
    await Org.adminSetManager(report.id, null)
    expect((await fresh(report)).managerId).toBeNull()
  })

  test('still rejects self, mutual and unknown users', async () => {
    const [a, b] = [await mk('a'), await mk('b')]
    await Org.adminSetManager(b.id, a.id)
    await expect(Org.adminSetManager(a.id, a.id)).rejects.toBeInstanceOf(BadRequestError)
    await expect(Org.adminSetManager(a.id, b.id)).rejects.toBeInstanceOf(BadRequestError)
    await expect(Org.adminSetManager('00000000-0000-4000-8000-00000000dead', a.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('plan access', () => {
  test('owner, active leader, pending party, other user, admin', async () => {
    const [leader, report, pendingParty, other] = [await mk('leader'), await mk('report'), await mk('pending'), await mk('other')]
    const admin = await mk('admin', 'admin')
    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    const plan = await Plans.create(await fresh(report), templateId)

    const own = await Plans.get(plan.id, report)
    expect(own).toMatchObject({ viewerRole: 'owner', canEdit: true })

    const asLeader = await Plans.get(plan.id, leader)
    expect(asLeader).toMatchObject({ viewerRole: 'leader', canEdit: false })
    await expect(Plans.get(plan.id, leader, 'write')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Plans.replaceItems(plan.id, leader, [])).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Plans.updateHeader(plan.id, leader, { division: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Plans.setStatus(plan.id, leader, 'submitted')).rejects.toBeInstanceOf(ForbiddenError)

    await Org.requestReport(pendingParty, report.id) // pending only, replaces nothing active
    await expect(Plans.get(plan.id, pendingParty)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Plans.get(plan.id, other)).rejects.toBeInstanceOf(ForbiddenError)

    expect(await Plans.get(plan.id, admin)).toMatchObject({ viewerRole: 'admin', canEdit: false })
    await expect(Plans.get(plan.id, admin, 'write')).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('leader loses access once released', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    const plan = await Plans.create(await fresh(report), templateId)
    await Plans.get(plan.id, leader)
    await Org.removeReport(leader, report.id)
    await expect(Plans.get(plan.id, leader)).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('new plan prefills Direct Leader from the active manager', async () => {
    const [leader, report] = [await mk('leader'), await mk('report')]
    await Org.accept(leader, (await Org.requestLeader(report, leader.id)).requestId)
    const plan = await Plans.create(await fresh(report), templateId)
    expect(plan.directLeader).toBe(leader.name)
  })

  test('team lists reports with plan summary and null for no plan', async () => {
    const [leader, withPlan, without] = [await mk('leader'), await mk('withplan'), await mk('without')]
    await Org.accept(leader, (await Org.requestLeader(withPlan, leader.id)).requestId)
    await Org.accept(leader, (await Org.requestLeader(without, leader.id)).requestId)
    const plan = await Plans.create(await fresh(withPlan), templateId)

    const team = await Org.team(leader, '2099-Q1')
    const byId = new Map(team.members.map((m) => [m.user.id, m.plan]))
    expect(byId.get(withPlan.id)).toMatchObject({ planId: plan.id, status: 'draft', totalWeight: 100, score: 0 })
    expect(byId.get(without.id)).toBeNull()
  })
})
