import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { BadRequestError, ForbiddenError } from '../src/shared/errors'
import { setupTestDb } from './db'

// Synthetic Fast Track tickets behind a fake Jira. Goals come from the migration's defaults (the Time to SLA copy).
const tag = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const at = (s: string) => `${s}+0700`
const NOW = Date.parse('2026-09-30T10:00:00+07:00')

const ft = (key: string, priority: string, labels: string[], created: string, resolved: string | null, assignee = true) => ({
  id: key, key,
  fields: {
    summary: `Ticket ${key}`, priority: { name: priority }, labels, created: at(created), resolutiondate: resolved ? at(resolved) : null,
    status: { name: resolved ? 'Done' : 'In Progress' }, assignee: assignee ? { accountId: 'someone' } : null,
  },
})
const TICKETS = [
  ft('F-1', 'Medium - P2', ['team-x', 'mesign-p2'], '2026-08-03T10:00:00', '2026-08-03T12:00:00'), // 2h of 45h: met
  ft('F-2', 'Medium - P2', ['team-x', 'mesign-p2'], '2026-08-03T10:00:00', '2026-08-18T10:00:00'), // ~11 working days: missed
  ft('F-3', 'High - P1', ['team-x', 'mesign-p1'], '2026-08-05T10:00:00', '2026-08-05T17:00:00'), // 7h of 18h: met
  ft('F-4', 'High - P1', ['team-x', 'mesign-p1'], '2026-08-05T10:00:00', '2026-08-05T11:00:00', false), // no assignee: no goal
  ft('F-5', 'Medium - P2', ['team-x', 'other'], '2026-08-05T10:00:00', '2026-08-05T11:00:00'), // no matching label: no goal
  ft('F-6', 'Medium - P2', ['team-x', 'mesign-p2'], '2026-09-29T10:00:00', null), // open, within target: running
  ft('F-7', 'Medium - P2', ['team-x', 'mesign-p2'], '2026-07-02T10:00:00', null), // open, long past target: missed
  ft('F-8', 'Low - P3', ['team-x', 'mesign-p3'], '2026-08-01T10:00:00', '2026-08-12T10:00:00'), // 24x7 calendar, 264h of 360h: met
  ft('F-9', 'Medium - P2', ['team-x', 'VIP-MESIGN-P2'], '2026-08-03T10:00:00', '2026-08-05T10:00:00'), // label match ignores case; P2 VIP is 3d on 24x7: 48h met
]

describe('Fast Track SLA card', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Svc: typeof import('../src/modules/pgp/fast-track-sla.service').FastTrackSlaService
  let Goals: typeof import('../src/modules/sla/service').SlaService
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let owner: typeof import('../src/db/schema').users.$inferSelect
  let other: typeof import('../src/db/schema').users.$inferSelect
  let plan = ''
  const jqls: string[] = []
  let defaults: Awaited<ReturnType<typeof import('../src/modules/sla/service').SlaService.list>> = []

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Svc = (await import('../src/modules/pgp/fast-track-sla.service')).FastTrackSlaService
    Goals = (await import('../src/modules/sla/service')).SlaService
    handler = (await import('../src/app')).app
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url)
        if (u.pathname === '/rest/api/3/search/jql') {
          const { jql } = (await req.json()) as { jql: string }
          jqls.push(jql)
          return Response.json({ issues: TICKETS })
        }
        return new Response('not found', { status: 404 })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token', slaProject: 'MESIGN' })
    const mk = async (n: string) => (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
    owner = await mk('owner'); other = await mk('other')
    await ctx.db.insert(S.connections).values({ userId: owner.id, jiraAccountId: `acct-${tag}`, jiraVerifiedEmail: owner.email, teamLabel: 'team-x' })
    plan = (await ctx.db.insert(S.plans).values({ userId: owner.id, year: 2026, quarter: 3 }).returning())[0]!.id
    defaults = await Goals.list()
  })

  afterAll(async () => {
    await Goals.replace(defaults.map(({ name, priority, label, calendar, target }) => ({ name, priority, label, calendar: calendar as 'weekdays' | 'always', target })))
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('the migration seeds the eight Time to SLA goals in order', () => {
    expect(defaults.map((g) => [g.position, g.name, g.calendar, g.target])).toEqual([
      [1, 'VIP Time Weekday', 'weekdays', '8h'], [2, 'Weekend VIP PZero', 'weekdays', '10h'], [3, 'P1 Mekari Sign VIP', 'weekdays', '1d12h'], [4, 'P1 General', 'weekdays', '2d'],
      [5, 'P2 VIP', 'always', '3d'], [6, 'P2 General', 'weekdays', '5d'], [7, 'P3 VIP', 'always', '10d'], [8, 'P3 General', 'always', '15d'],
    ])
  })

  test('met, missed, running and no-goal tickets; the team label comes from Connections', async () => {
    const res = await Svc.evaluate(plan, owner, undefined, NOW)
    expect(res).toMatchObject({ label: 'team-x', total: 9, met: 4, missed: 2, running: 1, noGoal: 2, rate: 66.7, truncated: false })
    expect(res.jql).toBe('project = "MESIGN" AND issuetype = "Fast Track" AND labels = "team-x" AND created >= "2026-07-01" AND created < "2026-10-01" ORDER BY created ASC')
    expect(res.url).toContain(encodeURIComponent('issuetype = "Fast Track"'))
  })

  test('per goal breakdown and the missed list (worst overrun first)', async () => {
    const res = await Svc.evaluate(plan, owner, undefined, NOW)
    expect(res.goals.map((g) => [g.name, g.met, g.missed, g.running])).toEqual([['P1 General', 1, 0, 0], ['P2 VIP', 1, 0, 0], ['P2 General', 1, 2, 1], ['P3 General', 1, 0, 0]])
    expect(res.missedTickets.map((t) => [t.key, t.open])).toEqual([['F-7', true], ['F-2', false]])
    expect(res.missedTickets[0]).toMatchObject({ goal: 'P2 General', targetMinutes: 45 * 60 })
  })

  test('an explicit label overrides the default; no label at all is a 400', async () => {
    await Svc.evaluate(plan, owner, 'team-y', NOW)
    expect(jqls.at(-1)).toContain('labels = "team-y"')
    await ctx.db.update(S.connections).set({ teamLabel: null }).where(eq(S.connections.userId, owner.id))
    await expect(Svc.evaluate(plan, owner, undefined, NOW)).rejects.toBeInstanceOf(BadRequestError)
    await ctx.db.update(S.connections).set({ teamLabel: 'team-x' }).where(eq(S.connections.userId, owner.id))
  })

  test('only the plan owner may read it', async () => {
    await expect(Svc.evaluate(plan, other, 'team-x', NOW)).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('editing the goals changes the result (and rejects what is not a duration)', async () => {
    await expect(Goals.replace([{ name: 'x', priority: 'Medium - P2', label: 'mesign-p2', calendar: 'weekdays', target: 'soon' }])).rejects.toBeInstanceOf(BadRequestError)
    await Goals.replace([{ name: 'Tight P2', priority: 'Medium - P2', label: 'MESIGN-P2', calendar: 'weekdays', target: '1h' }])
    const res = await Svc.evaluate(plan, owner, undefined, NOW)
    // F-1 took 2h: now missed; F-2 and F-7 missed; F-6 (open, created yesterday 10:00, 9 working hours so far) missed too
    expect(res).toMatchObject({ met: 0, missed: 4, running: 0 })
    expect(res.goals.map((g) => g.name)).toEqual(['Tight P2'])
    await Goals.replace(defaults.map(({ name, priority, label, calendar, target }) => ({ name, priority, label, calendar: calendar as 'weekdays' | 'always', target })))
  })

  test('the goals route needs a session; saving needs an admin', async () => {
    expect((await handler.handle(new Request('http://localhost/api/sla/goals'))).status).toBe(401)
    const put = await handler.handle(new Request('http://localhost/api/sla/goals', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: '{"goals":[]}' }))
    expect([401, 403]).toContain(put.status)
  })
})
