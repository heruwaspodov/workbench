import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { AppError, NotConnectedError } from '../src/shared/errors'
import { setupTestDb } from './db'

// Synthetic data only. A fake Confluence server stands in for Atlassian.
const tag = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ACCOUNT = `acct-${tag}`

describe('ConfluenceService', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Svc: typeof import('../src/modules/confluence/service').ConfluenceService
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let connected: typeof import('../src/db/schema').users.$inferSelect
  let loner: typeof import('../src/db/schema').users.$inferSelect

  const hits: { cql: string; start: string; limit: string; auth: string | null; path: string }[] = []
  let total = 60

  const result = (n: number, extra: Record<string, unknown> = {}) => ({
    content: { id: String(1000 + n), type: 'page' },
    title: `@@@hl@@@Doc@@@endhl@@@ ${n}`,
    excerpt: 'SECRET BODY TEXT',
    url: `/spaces/ENG/pages/${1000 + n}/Doc-${n}`,
    lastModified: '2026-11-01T10:00:00.000Z',
    resultGlobalContainer: { title: 'Engineering' },
    ...extra,
  })

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Svc = (await import('../src/modules/confluence/service')).ConfluenceService
    handler = (await import('../src/app')).app
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        hits.push({ cql: u.searchParams.get('cql')!, start: u.searchParams.get('start')!, limit: u.searchParams.get('limit')!, auth: req.headers.get('authorization'), path: u.pathname })
        return Response.json({
          results: [result(1), result(2), { ...result(3), url: 'https://evil.example/x' }, { title: 'no content id', url: '/spaces/X/pages/1/x' }],
          totalSize: total, size: 4,
        })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token' })

    const [a] = await ctx.db.insert(S.users).values({ email: `${tag}-a@test.local`, name: 'A' }).returning()
    const [b] = await ctx.db.insert(S.users).values({ email: `${tag}-b@test.local`, name: 'B' }).returning()
    connected = a!; loner = b!
    await ctx.db.insert(S.connections).values({ userId: connected.id, jiraAccountId: ACCOUNT, jiraVerifiedEmail: connected.email })
  })

  afterAll(async () => {
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  const last = () => hits[hits.length - 1]!

  test('lists pages the user created, newest first, mapped to metadata only', async () => {
    const res = await Svc.pages(connected, {})
    expect(last().path).toBe('/wiki/rest/api/search')
    expect(last().cql).toBe(`type = page AND creator = "${ACCOUNT}" ORDER BY lastmodified DESC`)
    expect(last().auth).toMatch(/^Basic /)
    expect([last().start, last().limit]).toEqual(['0', '20'])
    expect(res.items).toEqual([
      { id: '1001', title: 'Doc 1', space: 'Engineering', url: `http://localhost:${server.port}/wiki/spaces/ENG/pages/1001/Doc-1`, lastModified: '2026-11-01T10:00:00.000Z' },
      { id: '1002', title: 'Doc 2', space: 'Engineering', url: `http://localhost:${server.port}/wiki/spaces/ENG/pages/1002/Doc-2`, lastModified: '2026-11-01T10:00:00.000Z' },
    ])
    expect(res).toMatchObject({ total: 60, page: 1, pagelen: 20, hasNext: true })
  })

  test('never returns page body or excerpt', async () => {
    const res = await Svc.pages(connected, { role: 'contributor' })
    expect(JSON.stringify(res)).not.toContain('SECRET BODY')
  })

  test('contributor role with a day window', async () => {
    await Svc.pages(connected, { role: 'contributor', days: 90 })
    expect(last().cql).toBe(`type = page AND contributor = "${ACCOUNT}" AND lastmodified >= now("-90d") ORDER BY lastmodified DESC`)
  })

  test('title search is quoted and escaped', async () => {
    await Svc.pages(connected, { q: 'a"b\\c' })
    expect(last().cql).toContain('title ~ "a\\"b\\\\c"')
    expect(last().cql).toContain(`creator = "${ACCOUNT}"`)
  })

  test('paging maps to start and limit, and the last page has no next', async () => {
    const res = await Svc.pages(connected, { page: 3, pagelen: 10, q: 'paging' })
    expect([last().start, last().limit]).toEqual(['20', '10'])
    expect(res.hasNext).toBe(true)
    total = 22
    expect((await Svc.pages(connected, { page: 3, pagelen: 10, q: 'paging-end' })).hasNext).toBe(false)
    total = 60
  })

  test('identical requests are served from the cache', async () => {
    const before = hits.length
    await Svc.pages(connected, { q: 'cache-me' })
    await Svc.pages(connected, { q: 'cache-me' })
    expect(hits.length - before).toBe(1)
  })

  test('a user without a Jira connection gets NOT_CONNECTED and no call is made', async () => {
    const before = hits.length
    await expect(Svc.pages(loner, {})).rejects.toBeInstanceOf(NotConnectedError)
    expect(hits.length).toBe(before)
  })

  test('an unconfigured service account is a 503', async () => {
    Object.assign(jiraEnv, { email: undefined })
    const err = (await Svc.pages(connected, { q: 'no-config' }).catch((e) => e)) as AppError
    Object.assign(jiraEnv, { email: 'svc@example.test' })
    expect(err).toBeInstanceOf(AppError)
    expect(err.status).toBe(503)
  })

  test('the HTTP route requires a session', async () => {
    const res = await handler.handle(new Request('http://localhost/api/confluence/pages'))
    expect(res.status).toBe(401)
  })
})
