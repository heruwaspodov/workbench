import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { NotConnectedError, NotFoundError } from '../src/shared/errors'
import { invalidate } from '../src/shared/cache'
import { setupTestDb } from './db'

// Synthetic data only. The service account can read everyone's data, so these tests pin what a user may see:
// only their own Jira account (matched by SSO email), their own Bitbucket member, and issues/PRs they are part of.
const tag = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

describe('connection security', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Conn: typeof import('../src/modules/connections/service').ConnectionsService
  let Kanban: typeof import('../src/modules/kanban/service').KanbanService
  let Prs: typeof import('../src/modules/pull-requests/service').PullRequestsService
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let envMod: typeof import('../src/config/env')
  let saved: { jira: Record<string, unknown>; bb: Record<string, unknown> }
  let server: ReturnType<typeof Bun.serve>
  let seq = 0

  const A_ME = `acct-${tag}-me`
  const A_OTHER = `acct-${tag}-other`
  const U_ME = '{00000000-0000-4000-8000-0000000000aa}'
  const U_OTHER = '{00000000-0000-4000-8000-0000000000bb}'
  const email = (n: string) => `${tag}-${n}@test.local`

  // What the fake Atlassian site knows.
  // `foundBy` makes Jira return an account for a query even though its email is hidden (as the real search does).
  let people: { accountId: string; emailAddress?: string; active?: boolean; displayName: string; foundBy?: string }[] = []

  const issue = (key: string, assignee: string | null, reporter: string | null) => ({
    id: key, key,
    fields: {
      summary: `Issue ${key}`, status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } }, issuetype: { name: 'Task' }, updated: '2026-11-01T00:00:00.000Z',
      assignee: assignee ? { accountId: assignee, displayName: 'x' } : null, reporter: reporter ? { accountId: reporter, displayName: 'y' } : null,
      description: null, subtasks: [], components: [], fixVersions: [], labels: [],
    },
  })
  const pr = (id: number, author: string, reviewers: string[] = [], participants: string[] = []) => ({
    id, title: `PR ${id}`, description: '', state: 'OPEN', author: { uuid: author, display_name: 'a' }, created_on: '2026-11-01T00:00:00Z', updated_on: '2026-11-01T00:00:00Z',
    source: { branch: { name: 'b' } }, destination: { branch: { name: 'main' }, repository: { full_name: 'ws/r', name: 'r' } },
    reviewers: reviewers.map((uuid) => ({ uuid, display_name: 'r' })), participants: participants.map((uuid) => ({ user: { uuid, display_name: 'p' }, role: 'PARTICIPANT', approved: false })),
    links: { html: { href: 'https://example.test/pr' } },
  })

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Conn = (await import('../src/modules/connections/service')).ConnectionsService
    Kanban = (await import('../src/modules/kanban/service')).KanbanService
    Prs = (await import('../src/modules/pull-requests/service')).PullRequestsService
    handler = (await import('../src/app')).app
    envMod = await import('../src/config/env')
    saved = { jira: { ...envMod.env.jira }, bb: { ...envMod.env.bitbucket } }

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        const p = u.pathname
        if (p === '/rest/api/3/user/search') {
          const q = (u.searchParams.get('query') ?? '').toLowerCase()
          return Response.json(people.filter((x) => (x.emailAddress ?? '').toLowerCase().includes(q) || x.foundBy?.toLowerCase() === q))
        }
        if (p === '/rest/api/3/user') {
          const found = people.find((x) => x.accountId === u.searchParams.get('accountId'))
          return found ? Response.json(found) : Response.json({ errorMessages: ['nope'] }, { status: 404 })
        }
        const issueMatch = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/comment)?$/)
        if (issueMatch) {
          if (issueMatch[2]) return Response.json({ comments: [] })
          return Response.json({ MINE: issue('T-1', A_ME, null), REPORTED: issue('T-2', null, A_ME), THEIRS: issue('T-3', A_OTHER, A_OTHER) }[{ 'T-1': 'MINE', 'T-2': 'REPORTED', 'T-3': 'THEIRS' }[issueMatch[1]!] ?? 'THEIRS']!)
        }
        if (p === '/2.0/workspaces/ws/members') {
          return Response.json({
            values: [
              { user: { uuid: U_OTHER, display_name: 'Same Name', account_id: A_OTHER } },
              { user: { uuid: U_ME, display_name: 'Same Name', account_id: A_ME } },
            ], pagelen: 100,
          })
        }
        const prMatch = p.match(/^\/2\.0\/repositories\/ws\/r\/pullrequests\/(\d+)(?:\/(diffstat|commits|comments|statuses|diff))?$/)
        if (prMatch) {
          const n = Number(prMatch[1])
          if (prMatch[2] === 'diff') return new Response('diff --git a b', { headers: { 'content-type': 'text/plain' } })
          if (prMatch[2]) return Response.json({ values: [] })
          return Response.json(n === 1 ? pr(1, U_ME) : n === 2 ? pr(2, U_OTHER, [U_ME]) : n === 3 ? pr(3, U_OTHER, [], [U_ME]) : pr(4, U_OTHER, [U_OTHER]))
        }
        return Response.json({ error: 'not mocked', path: p }, { status: 404 })
      },
    })
    Object.assign(envMod.env.jira, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token' })
    Object.assign(envMod.env.bitbucket, { apiUrl: `http://localhost:${server.port}/2.0`, workspace: 'ws', accessToken: 'bb-token' })
  })

  afterAll(async () => {
    Object.assign(envMod.env.jira, saved.jira)
    Object.assign(envMod.env.bitbucket, saved.bb)
    invalidate('bb:members')
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  const user = async (name = `u${++seq}`) => (await ctx.db.insert(S.users).values({ email: email(name), name: 'Same Name' }).returning())[0]!
  const row = async (id: string) => (await ctx.db.select().from(S.connections).where(eq(S.connections.userId, id)))[0]!

  describe('auto-connect Jira', () => {
    test('links the account whose email is exactly the SSO email, never a lookalike', async () => {
      const u = await user('exact')
      people = [
        { accountId: A_OTHER, emailAddress: `x${u.email}`, displayName: 'Lookalike' }, // contains the email but is not it
        { accountId: A_ME, emailAddress: u.email.toUpperCase(), displayName: 'Me' },
      ]
      await Conn.autoConnectJira(u)
      expect(await row(u.id)).toMatchObject({ jiraAccountId: A_ME, jiraVerifiedEmail: u.email })
    })

    test('a single result that hides its email is not trusted', async () => {
      const u = await user('hidden')
      people = [{ accountId: A_OTHER, displayName: 'Hidden', emailAddress: undefined, foundBy: u.email }]
      await expect(Conn.autoConnectJira(u)).rejects.toBeInstanceOf(NotFoundError)
      expect((await Conn.get(u.id)).jiraAccountId).toBeNull()
    })

    test('an inactive account is ignored', async () => {
      const u = await user('inactive')
      people = [{ accountId: A_OTHER, emailAddress: u.email, active: false, displayName: 'Gone' }]
      await expect(Conn.autoConnectJira(u)).rejects.toBeInstanceOf(NotFoundError)
      expect((await Conn.get(u.id)).jiraAccountId).toBeNull()
    })
  })

  describe('manual linking is gone', () => {
    const call = (method: string, path: string, body?: unknown) =>
      handler.handle(new Request(`http://localhost${path}`, {
        method, headers: { origin: envMod.env.appUrl, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      }))

    test('the endpoints that picked any Jira or Bitbucket account no longer exist', async () => {
      for (const [m, path, body] of [
        ['GET', '/api/connections/jira/users?q=a'], ['PUT', '/api/connections/jira', { accountId: A_OTHER }],
        ['GET', '/api/connections/bitbucket/members?q=a'], ['PUT', '/api/connections/bitbucket', { uuid: U_OTHER }],
      ] as const) expect((await call(m, path, body)).status).toBe(404)
      expect((await call('GET', '/api/connections')).status).toBe(401) // the route that remains is guarded
    })
  })

  describe('links made before proof was kept', () => {
    test('a link to someone else is removed when it is first used, together with the Bitbucket link', async () => {
      const u = await user('stolen')
      people = [{ accountId: A_OTHER, emailAddress: email('someone-else'), displayName: 'Other' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_OTHER, bitbucketUuid: U_OTHER })
      const err = await Conn.requireJira(u).catch((e) => e)
      expect(err).toBeInstanceOf(NotConnectedError)
      expect(await row(u.id)).toMatchObject({ jiraAccountId: null, jiraVerifiedEmail: null, bitbucketUuid: null })
    })

    test('a link to an account that hides its email cannot be proven and is removed', async () => {
      const u = await user('unproven')
      people = [{ accountId: A_OTHER, emailAddress: undefined, displayName: 'Hidden' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_OTHER })
      await expect(Conn.requireJira(u)).rejects.toBeInstanceOf(NotConnectedError)
      expect((await row(u.id)).jiraAccountId).toBeNull()
    })

    test('the user\'s own link keeps working and the proof is stored', async () => {
      const u = await user('own')
      people = [{ accountId: A_ME, emailAddress: u.email, displayName: 'Me' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_ME })
      expect((await Conn.requireJira(u)).accountId).toBe(A_ME)
      expect((await row(u.id)).jiraVerifiedEmail).toBe(u.email)
    })

    test('the overview shows the removal as a notice instead of listing the stranger as connected', async () => {
      const u = await user('overview')
      people = [{ accountId: A_OTHER, emailAddress: email('nobody'), displayName: 'Other' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_OTHER, jiraDisplayName: 'Other' })
      const o = await Conn.overview(u)
      expect(o.jira.accountId).toBeNull()
      expect(o.notice).toMatch(/removed/)
    })
  })

  describe('Bitbucket', () => {
    const jiraOwn = async (u: Awaited<ReturnType<typeof user>>) => {
      people = [{ accountId: A_ME, emailAddress: u.email, displayName: 'Me' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_ME, jiraVerifiedEmail: u.email })
    }

    test('matches on the Atlassian account id, not on a shared display name', async () => {
      invalidate('bb:members')
      const u = await user('bb-auto')
      await jiraOwn(u)
      await Conn.autoConnectBitbucket(u)
      expect(await row(u.id)).toMatchObject({ bitbucketUuid: U_ME, bitbucketVerifiedAccountId: A_ME })
    })

    test('needs a Jira link first', async () => {
      const u = await user('bb-nojira')
      const err = await Conn.autoConnectBitbucket(u).catch((e) => e)
      expect(err).toBeInstanceOf(NotConnectedError)
      expect(err.message).toMatch(/Connect Jira first/)
    })

    test('an old link to another member is removed when it is first used; the right one is kept', async () => {
      invalidate('bb:members')
      const wrong = await user('bb-wrong')
      await jiraOwn(wrong)
      await ctx.db.update(S.connections).set({ bitbucketUuid: U_OTHER }).where(eq(S.connections.userId, wrong.id))
      await expect(Conn.requireBitbucket(wrong)).rejects.toBeInstanceOf(NotConnectedError)
      expect(await row(wrong.id)).toMatchObject({ bitbucketUuid: null, jiraAccountId: A_ME })

      const right = await user('bb-right')
      await jiraOwn(right)
      await ctx.db.update(S.connections).set({ bitbucketUuid: U_ME }).where(eq(S.connections.userId, right.id))
      expect((await Conn.requireBitbucket(right)).uuid).toBe(U_ME)
      expect((await row(right.id)).bitbucketVerifiedAccountId).toBe(A_ME)
    })
  })

  describe('details are limited to what the user is part of', () => {
    const connected = async (name: string) => {
      invalidate('bb:members')
      const u = await user(name)
      people = [{ accountId: A_ME, emailAddress: u.email, displayName: 'Me' }]
      await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: A_ME, jiraVerifiedEmail: u.email, bitbucketUuid: U_ME, bitbucketVerifiedAccountId: A_ME })
      return u
    }

    test('a Jira issue is shown to its assignee or reporter, and reads as not found to anyone else', async () => {
      const u = await connected('issue')
      expect((await Kanban.issue(u, 'T-1')).key).toBe('T-1')
      expect((await Kanban.issue(u, 'T-2')).key).toBe('T-2')
      await expect(Kanban.issue(u, 'T-3')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('a pull request is shown to its author, a reviewer or a participant, and reads as not found to anyone else', async () => {
      const u = await connected('pr')
      for (const id of [1, 2, 3]) expect((await Prs.detail(u, 'r', id)).id).toBe(id)
      await expect(Prs.detail(u, 'r', 4)).rejects.toBeInstanceOf(NotFoundError)
      expect((await Prs.diff(u, 'r', 1)).diff).toContain('diff --git')
      await expect(Prs.diff(u, 'r', 4)).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
