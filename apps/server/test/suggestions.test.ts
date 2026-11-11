import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { AppError, BadRequestError, ForbiddenError, NotConnectedError } from '../src/shared/errors'
import { epicDelivery, epicInQuarter, pageKind } from '../src/modules/pgp/suggestions.service'
import { invalidate } from '../src/shared/cache'
import { monthRange, quarterRange } from '../src/shared/period'
import { setupTestDb } from './db'

// Synthetic data only. A fake Atlassian site answers Jira JQL search and Confluence CQL search.
const tag = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ACCOUNT = `acct-${tag}`

const issue = (key: string, fields: Record<string, unknown>) => ({ id: key, key, fields })
// Same source as the app config, so the fixtures follow whatever story point field the environment names.
const SPF = process.env.JIRA_STORY_POINT_FIELD || 'customfield_10016'
const CF = `cf[${SPF.slice('customfield_'.length)}]`
const sp = (n: number) => ({ [SPF]: n })
const DELIVERY = [
  issue('T-1', { summary: 'One', resolutiondate: '2026-07-05T10:00:00.000+0700', ...sp(3) }),
  issue('T-2', { summary: 'Two', resolutiondate: '2026-07-20T10:00:00.000+0700', ...sp(5) }),
  issue('T-3', { summary: 'Three', resolutiondate: '2026-07-31T23:30:00.000+0700', ...sp(2) }),
  issue('T-4', { summary: 'Four', resolutiondate: '2026-08-02T10:00:00.000+0700', ...sp(8) }),
]
const ver = (name: string, released: boolean) => ({ fixVersions: [{ name, released }] })
const st = (name: string, cat = 'done') => ({ status: { name, statusCategory: { key: cat } } })
const RATE = [
  issue('R-1', { resolutiondate: '2026-07-10T10:00:00.000+0700', issuetype: { name: 'Task' }, ...st('Done'), ...sp(5), ...ver('[BE] Release v1', true) }),
  issue('R-2', { resolutiondate: '2026-08-10T10:00:00.000+0700', issuetype: { name: 'Task' }, ...st('Done'), ...sp(3) }),
  issue('R-3', { resolutiondate: null, issuetype: { name: 'Task' }, ...st('To Do', 'new'), ...sp(2) }),
  issue('R-4', { resolutiondate: '2026-10-05T10:00:00.000+0700', issuetype: { name: 'Task' }, ...st('Done'), ...sp(1) }),
  issue('R-5', { resolutiondate: null, issuetype: { name: 'Epic' }, summary: 'Epic with children', created: '2026-05-01T10:00:00.000+0700', ...st('In Progress', 'indeterminate') }),
  issue('R-6', { resolutiondate: '2026-08-12T10:00:00.000+0700', issuetype: { name: 'Task' }, ...st("Won't Fix"), ...sp(4) }),
  issue('R-7', { resolutiondate: '2026-09-02T10:00:00.000+0700', issuetype: { name: 'Task' }, ...st('Done'), ...sp(2), ...ver('[BE] Release v2', false) }),
  issue('R-8', { resolutiondate: null, issuetype: { name: 'Epic' }, summary: '26Q3 Epic without children', created: '2026-01-01T10:00:00.000+0700', ...st('To Do', 'new') }),
  issue('R-9', { resolutiondate: '2026-08-20T10:00:00.000+0700', issuetype: { name: 'Epic' }, summary: '26Q3 Delivered epic', created: '2026-01-01T10:00:00.000+0700', ...st('Done'), [process.env.JIRA_DELIVERY_DATE_FIELD || 'customfield_11781']: '2026-08-20' }),
  issue('R-10', { resolutiondate: null, issuetype: { name: 'Epic' }, summary: '26Q3 Closing epic', created: '2026-01-01T10:00:00.000+0700', ...st('In Progress', 'indeterminate') }),
  issue('R-11', { resolutiondate: null, issuetype: { name: 'Epic' }, summary: '23Q3 Old bucket epic', created: '2023-07-01T10:00:00.000+0700', ...st('To Do', 'new') }),
]
const TOGGLE = process.env.JIRA_TOGGLE_FIELD || 'customfield_11708'
const kid = (key: string, parent: string, resolved: boolean | string, v?: ReturnType<typeof ver>, status = resolved ? 'Done' : 'To Do', toggles?: string[]) =>
  issue(key, { parent: { key: parent }, resolutiondate: resolved ? (typeof resolved === 'string' ? resolved : '2026-08-01T10:00:00.000+0700') : null, ...st(status, resolved ? 'done' : 'new'), ...(v ?? {}), ...(toggles ? { [TOGGLE]: toggles } : {}) })
const CHILDREN: Record<string, ReturnType<typeof kid>[]> = {
  'R-5': [kid('K-1', 'R-5', true, ver('[BE] Release v1', true), undefined, ['ft_b', 'ft_a']), kid('K-2', 'R-5', false), kid('K-3', 'R-5', false, undefined, "Won't Fix")],
  'R-9': [kid('K-4', 'R-9', true)],
  'R-10': [kid('K-5', 'R-10', true), kid('K-6', 'R-10', true, undefined, undefined, ['ft_a'])],
  'R-11': [kid('K-7', 'R-11', true), ...Array.from({ length: 7 }, (_, n) => kid(`K-${8 + n}`, 'R-11', '2023-11-01T10:00:00.000+0700'))],
}
const epic = (key: string, summary: string, cat = 'indeterminate') => issue(key, { summary, status: { name: 'In Progress', statusCategory: { key: cat } }, resolutiondate: null })

describe('SuggestionsService', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Svc: typeof import('../src/modules/pgp/suggestions.service').SuggestionsService
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let owner: typeof import('../src/db/schema').users.$inferSelect
  let other: typeof import('../src/db/schema').users.$inferSelect
  let loner: typeof import('../src/db/schema').users.$inferSelect
  let planQ3 = ''
  let planQ2 = ''
  let lonerPlan = ''

  const jiraHits: string[] = []
  const wikiHits: string[] = []
  let wikiDown = false

  const handleJql = (jql: string) => {
    if (jql.includes('issuetype = Epic')) return [epic('E-1', 'Platform cleanup'), epic('E-2', '26Q3 Reliability'), epic('E-3', '25Q4 Old work', 'done')]
    if (jql.includes('parent is not EMPTY')) {
      const parent = (key: string, type: string, summary: string) => ({ id: key, key, fields: { summary, status: { name: 'To Do', statusCategory: { key: 'new' } }, issuetype: { name: type } } })
      return [
        issue('C-1', { parent: parent('E-2', 'Epic', '26Q3 Reliability') }), // already assigned to the user
        issue('C-2', { parent: parent('E-9', 'Epic', 'Unassigned epic') }),
        issue('C-3', { parent: parent('S-1', 'Story', 'A story, not an epic') }),
      ]
    }
    if (jql.includes('issuetype = Bug')) return [issue('B-1', { priority: { name: 'Medium - P2' } }), issue('B-2', { priority: { name: 'Medium - P2' } }), issue('B-3', { priority: { name: 'High - P1' } }), issue('B-4', { priority: { name: 'Lowest' } })]
    if (jql.startsWith('parent in (')) return Object.entries(CHILDREN).filter(([k]) => jql.includes(`"${k}"`)).flatMap(([, v]) => v)
    if (jql.includes('labels =')) return RATE
    const [from, to] = [...jql.matchAll(/resolutiondate (?:>=|<) "([^"]+)"/g)].map((m) => m[1]!)
    return DELIVERY.filter((i) => String(i.fields.resolutiondate).slice(0, 10) >= from! && String(i.fields.resolutiondate).slice(0, 10) < to!)
  }

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Svc = (await import('../src/modules/pgp/suggestions.service')).SuggestionsService
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url)
        if (u.pathname === '/rest/api/3/search/jql') {
          const { jql } = (await req.json()) as { jql: string }
          jiraHits.push(jql)
          return Response.json({ issues: handleJql(jql) })
        }
        if (u.pathname === '/wiki/rest/api/search') {
          wikiHits.push(u.searchParams.get('cql')!)
          if (wikiDown) return new Response('boom', { status: 500 })
          const page = (n: number, title: string) => ({
            content: { id: String(n), type: 'page' }, title, excerpt: 'SECRET BODY TEXT', url: `/spaces/ENG/pages/${n}/p`, lastModified: '2026-10-01T10:00:00.000Z', resultGlobalContainer: { title: 'Engineering' },
          })
          return Response.json({ results: [page(1, 'RFC: new signing flow'), page(2, 'RCA 2026-09 outage'), page(3, 'Runbook for webhooks'), page(4, 'Meeting notes')], totalSize: 4 })
        }
        return new Response('not found', { status: 404 })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token' })

    const mk = async (n: string) => (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
    owner = await mk('owner'); other = await mk('other'); loner = await mk('loner')
    await ctx.db.insert(S.connections).values({ userId: owner.id, jiraAccountId: ACCOUNT, jiraVerifiedEmail: owner.email })
    const plan = async (userId: string, year: number, quarter: number) => (await ctx.db.insert(S.plans).values({ userId, year, quarter }).returning())[0]!.id
    planQ3 = await plan(owner.id, 2026, 3)
    planQ2 = await plan(owner.id, 2026, 2)
    lonerPlan = await plan(loner.id, 2026, 3)
  })

  afterAll(async () => {
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('quarter and month ranges cover Q1 to Q4 including the year boundary', () => {
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-04-01', months: ['2026-01', '2026-02', '2026-03'] })
    expect(quarterRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2027-01-01', months: ['2026-10', '2026-11', '2026-12'] })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' })
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-08-01' })
  })

  test('page kind comes from the title only', () => {
    expect(['RFC: x', 'RCA for y', 'Postmortem z', 'Tech design foo', 'Runbook bar', 'Weekly notes'].map(pageKind))
      .toEqual(['rfc', 'rca', 'rca', 'tech-doc', 'tech-doc', 'other'])
  })

  test('delivery: story points and tickets per month of the plan quarter, with the JQL and Jira link', async () => {
    const res = await Svc.get(planQ3, owner)
    expect(res.period).toBe('2026-Q3')
    expect(res.delivery.map((d) => [d.month, d.tickets, d.storyPoints])).toEqual([['2026-07', 3, 10], ['2026-08', 1, 8], ['2026-09', 0, 0]])
    const july = res.delivery[0]!
    expect(july.jql).toBe(`assignee = "${ACCOUNT}" AND resolutiondate >= "2026-07-01" AND resolutiondate < "2026-08-01" AND ${CF} > 0 ORDER BY resolutiondate ASC`)
    expect(july.url).toBe(`http://localhost:${server.port}/issues?jql=${encodeURIComponent(july.jql)}`)
    expect(jiraHits.some((j) => j.includes('resolutiondate >= "2026-07-01" AND resolutiondate < "2026-10-01"'))).toBe(true)
  })

  test('epics: assigned plus parent epics of resolved issues, no duplicates, quarter-labelled first', async () => {
    const res = await Svc.get(planQ3, owner)
    expect(res.epics.map((e) => [e.key, e.source])).toEqual([['E-2', 'assigned'], ['E-1', 'assigned'], ['E-3', 'assigned'], ['E-9', 'child']])
    expect(res.epics[0]).toMatchObject({ summary: '26Q3 Reliability', url: `http://localhost:${server.port}/browse/E-2` })
    const jql = jiraHits.find((j) => j.includes('issuetype = Epic'))!
    expect(jql).toContain(`assignee = "${ACCOUNT}"`)
    expect(jql).toContain('created < "2026-10-01"')
    expect(jql).toContain('updated >= "2026-07-01"')
    expect(jql).toContain('resolutiondate >= "2026-07-01"')
  })

  test('pages: last 3 months of the owner contributions, classified, without body or excerpt', async () => {
    const res = await Svc.get(planQ3, owner)
    expect(res.pages.map((p) => [p.title, p.kind])).toEqual([['RFC: new signing flow', 'rfc'], ['RCA 2026-09 outage', 'rca'], ['Runbook for webhooks', 'tech-doc'], ['Meeting notes', 'other']])
    expect(wikiHits.at(-1)).toBe(`type = page AND contributor = "${ACCOUNT}" AND lastmodified >= now("-92d") ORDER BY lastmodified DESC`)
    expect(JSON.stringify(res)).not.toContain('SECRET BODY')
  })

  test('bugs: assigned to the owner and created in the quarter, counted per priority level', async () => {
    const res = await Svc.get(planQ3, owner)
    expect(res.bugs).toMatchObject({ total: 4, value: 'Lowest: 1, P1: 1, P2: 2' })
    expect(res.bugs!.items.map((i) => [i.label, i.count])).toEqual([['Lowest', 1], ['P1', 1], ['P2', 2]])
    expect(res.bugs!.jql).toBe(`assignee = "${ACCOUNT}" AND issuetype = Bug AND created >= "2026-07-01" AND created < "2026-10-01" ORDER BY created ASC`)
    expect(res.bugs!.url).toContain(encodeURIComponent('issuetype = Bug'))
    expect(res.errors.bugs).toBeNull()
  })

  test('identical requests are served from the cache', async () => {
    await Svc.get(planQ3, owner)
    const before = jiraHits.length + wikiHits.length
    await Svc.get(planQ3, owner)
    expect(jiraHits.length + wikiHits.length).toBe(before)
  })

  test('one failing source degrades only its own section', async () => {
    invalidate('cf:') // the Confluence service keeps its own 60 s cache
    wikiDown = true
    const res = await Svc.get(planQ2, owner)
    wikiDown = false
    expect(res.pages).toEqual([])
    expect(res.errors.pages).toMatch(/Confluence/)
    expect(res.errors.epics).toBeNull()
    expect(res.errors.delivery).toBeNull()
    expect(res.delivery).toHaveLength(3)
  })

  test('month detail lists the tickets and rejects a month outside the quarter', async () => {
    const res = await Svc.deliveryMonth(planQ3, owner, '2026-07')
    expect(res).toMatchObject({ month: '2026-07', tickets: 3, storyPoints: 10 })
    expect(res.issues.map((i) => [i.key, i.storyPoints])).toEqual([['T-1', 3], ['T-2', 5], ['T-3', 2]])
    expect(res.url).toContain(encodeURIComponent('resolutiondate >= "2026-07-01"'))
    await expect(Svc.deliveryMonth(planQ3, owner, '2026-10')).rejects.toBeInstanceOf(BadRequestError)
  })

  test('team delivery rate: epics and Won\'t Fix are set aside, untouched backlog is not a commitment', async () => {
    const res = await Svc.deliveryRate(planQ3, owner, ' team-x ')
    expect(res).toMatchObject({ label: 'team-x', from: '2026-07-01', to: '2026-10-01', truncated: false, excluded: { epics: 5, wontFix: 1, epicsOutOfQuarter: 1 } })
    expect(res.tickets).toEqual({ done: 3, total: 5, rate: 60 })
    expect(res.storyPoints).toEqual({ done: 10, total: 13, rate: 76.9 })
    expect(res.jql).toBe('labels = "team-x" AND created < "2026-10-01" AND (resolutiondate >= "2026-07-01" OR (resolution is EMPTY AND updated >= "2026-07-01"))')
    expect(res.jql).not.toContain(ACCOUNT) // whole team, not only the owner
    await expect(Svc.deliveryRate(planQ3, owner, '   ')).rejects.toBeInstanceOf(BadRequestError)
  })

  test('team delivery rate: released share of done, done without a fixVersion reported apart', async () => {
    const res = await Svc.deliveryRate(planQ3, owner, 'team-x')
    expect(res.released.tickets).toEqual({ released: 1, noVersion: 1, done: 3, rate: 33.3 })
    expect(res.released.storyPoints).toEqual({ released: 5, noVersion: 3, done: 10, rate: 50 })
  })

  test('team delivery rate: delivery status per labelled epic follows the epic status, quarter-bound', async () => {
    const res = await Svc.deliveryRate(planQ3, owner, 'team-x')
    expect(res.epics.map((e) => [e.key, e.delivery, e.children])).toEqual([
      ['R-10', 'children_done', { total: 2, done: 2, released: 0 }],
      ['R-9', 'delivered', { total: 1, done: 1, released: 0 }],
      ['R-8', 'no_children', { total: 0, done: 0, released: 0 }],
      ['R-5', 'in_progress', { total: 2, done: 1, released: 1 }],
    ])
    expect(res.epicSummary).toEqual({ delivered: 1, children_done: 1, in_progress: 1, no_children: 1 })
    expect(res.epicsDelivered).toEqual({ delivered: 1, total: 4 })
    expect(res.epics.find((e) => e.key === 'R-9')!.deliveredOn).toBe('2026-08-20')
    expect(res.epics.find((e) => e.key === 'R-5')!.deliveredOn).toBeNull()
    expect(res.epics.find((e) => e.key === 'R-5')!.toggles).toEqual(['ft_a', 'ft_b'])
    expect(res.epics.find((e) => e.key === 'R-10')!.toggles).toEqual(['ft_a'])
    expect(res.epics.map((e) => e.key)).not.toContain('R-11') // old epic with one stray ticket this quarter
    expect(res.epics[0]!.url).toBe(`http://localhost:${server.port}/browse/R-10`)
    expect(res.epicsTruncated).toBe(false)
  })

  test('epic delivery status rules', () => {
    const epic = (cat: string) => issue('E', { summary: 'x', ...st(cat === 'done' ? 'Done' : 'In Progress', cat) })
    const k = (resolved: boolean) => issue('x', { resolutiondate: resolved ? '2026-08-01' : null, ...st(resolved ? 'Done' : 'To Do') })
    expect(epicDelivery(epic('done'), [k(false)])).toBe('delivered') // the epic status is trusted
    expect(epicDelivery(epic('indeterminate'), [])).toBe('no_children')
    expect(epicDelivery(epic('indeterminate'), [k(true), k(true)])).toBe('children_done')
    expect(epicDelivery(epic('indeterminate'), [k(true), k(false)])).toBe('in_progress')
    expect(epicDelivery(epic('indeterminate'), [k(true), issue('w', { resolutiondate: null, ...st("Won't Fix") })])).toBe('children_done')
  })

  test('epic quarter rules: resolved, created, tagged, or a quarter of its work', () => {
    const range = { from: '2026-07-01', to: '2026-10-01' }
    const e = (summary: string, extra: Record<string, unknown> = {}) => issue('E', { summary, created: '2025-01-01T00:00:00.000+0000', resolutiondate: null, ...extra })
    const k = (date: string | null) => issue('k', { resolutiondate: date, ...st('Done') })
    expect(epicInQuarter(e('plain', { resolutiondate: '2026-08-01T00:00:00.000+0000' }), [], range, '26Q3')).toBe(true)
    expect(epicInQuarter(e('plain', { created: '2026-08-01T00:00:00.000+0000' }), [], range, '26Q3')).toBe(true)
    expect(epicInQuarter(e('[26Q3] Tagged'), [], range, '26Q3')).toBe(true)
    expect(epicInQuarter(e('126Q31 not a tag'), [], range, '26Q3')).toBe(false)
    expect(epicInQuarter(e('23Q3 Old'), [k('2026-08-01'), k('2023-01-01'), k('2023-01-01'), k('2023-01-01'), k('2023-01-01')], range, '26Q3')).toBe(false) // 1 of 5
    expect(epicInQuarter(e('23Q3 Old'), [k('2026-08-01'), k('2026-09-01'), k('2023-01-01'), k('2023-01-01')], range, '26Q3')).toBe(true) // half of it
  })

  test('only the plan owner may read suggestions', async () => {
    await expect(Svc.get(planQ3, other)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Svc.deliveryMonth(planQ3, other, '2026-07')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(Svc.deliveryRate(planQ3, other, 'x')).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('without a Jira connection: NOT_CONNECTED; without the service account: 503', async () => {
    await expect(Svc.get(lonerPlan, loner)).rejects.toBeInstanceOf(NotConnectedError)
    const email = jiraEnv.email
    jiraEnv.email = undefined
    const err = await Svc.get(planQ3, owner).catch((e) => e)
    jiraEnv.email = email
    expect(err).toBeInstanceOf(AppError)
    expect(err.status).toBe(503)
  })
})
