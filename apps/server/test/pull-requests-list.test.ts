import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { setupTestDb } from './db'

// Synthetic PRs behind a fake Bitbucket; nothing here touches a real workspace.
const tag = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const UUID = `{00000000-0000-4000-8000-${Math.floor(Math.random() * 1e11).toString().padStart(12, '0')}}`

const pr = (id: number, repo = 'repo-a') => ({
  id, title: `PR ${id}`, state: 'OPEN', draft: false,
  author: { uuid: UUID, display_name: 'Author', links: { avatar: { href: '' } } },
  created_on: '2026-11-01T00:00:00.000Z', updated_on: `2026-11-${String(10 + (id % 18)).padStart(2, '0')}T00:00:00.000Z`,
  comment_count: 0, task_count: 0,
  source: { branch: { name: `feature/x-${id}` } },
  destination: { branch: { name: 'main' }, repository: { full_name: `ws/${repo}`, name: repo } },
  reviewers: [], participants: [], links: { html: { href: `https://example.test/${repo}/${id}` } },
})

describe('pull request list paging', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Prs: typeof import('../src/modules/pull-requests/service').PullRequestsService
  let bbEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let user: typeof import('../src/db/schema').users.$inferSelect
  const calls: { path: string; pagelen: string | null; page: string | null }[] = []
  let authorSize = 57

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Prs = (await import('../src/modules/pull-requests/service')).PullRequestsService
    bbEnv = (await import('../src/config/env')).env.bitbucket as unknown as Record<string, unknown>
    saved = { ...bbEnv }
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        calls.push({ path: u.pathname, pagelen: u.searchParams.get('pagelen'), page: u.searchParams.get('page') })
        if (u.pathname.startsWith('/2.0/workspaces/ws/pullrequests/')) {
          const n = Number(u.searchParams.get('pagelen') ?? 10)
          const values = Array.from({ length: Math.min(n, 5) }, (_, i) => pr(i + 1, i % 2 ? 'repo-b' : 'repo-a'))
          return Response.json({ values, size: authorSize, page: Number(u.searchParams.get('page') ?? 1), pagelen: n, next: 'https://example.test/next' })
        }
        if (u.pathname.match(/^\/2\.0\/repositories\/ws\/[^/]+\/pullrequests$/)) {
          const repo = u.pathname.split('/')[4]!
          const base = repo === 'repo-a' ? 100 : 200
          return Response.json({ values: Array.from({ length: 45 }, (_, i) => pr(i + base, repo)), size: 45 })
        }
        return Response.json({ error: 'not mocked' }, { status: 404 })
      },
    })
    Object.assign(bbEnv, { apiUrl: `http://localhost:${server.port}/2.0`, workspace: 'ws', accessToken: 'bb-token' })
    const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-u@test.local`, name: 'U' }).returning()
    user = u!
    await ctx.db.insert(S.connections).values({ userId: user.id, bitbucketUuid: UUID })
  })

  afterAll(async () => {
    Object.assign(bbEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  const last = () => calls[calls.length - 1]!

  test('shows 20 per page by default and reports the workspace total', async () => {
    const res = await Prs.list(user, { role: 'author', page: 2 })
    expect(last().pagelen).toBe('20')
    expect(last().page).toBe('2')
    expect(res).toMatchObject({ page: 2, pagelen: 20, total: 57, hasNext: true })
  })

  test('honours a custom page size', async () => {
    const res = await Prs.list(user, { role: 'author', pagelen: 50 })
    expect(last().pagelen).toBe('50')
    expect(res.pagelen).toBe(50)
  })

  test('a repository filter is applied after the fetch, so the total is unknown', async () => {
    const res = await Prs.list(user, { role: 'author', repo: 'repo-a' })
    expect(res.items.every((p) => p.repo === 'repo-a')).toBe(true)
    expect(res.total).toBeNull()
  })

  test('reviewer list pages through the merged results', async () => {
    // two involved repos x 45 open PRs each
    const first = await Prs.list(user, { role: 'reviewer', page: 1, pagelen: 20 })
    expect(first).toMatchObject({ total: 90, pagelen: 20, hasNext: true })
    expect(first.items).toHaveLength(20)
    const last = await Prs.list(user, { role: 'reviewer', page: 5, pagelen: 20 })
    expect(last.items).toHaveLength(10)
    expect(last.hasNext).toBe(false)
  })
})
