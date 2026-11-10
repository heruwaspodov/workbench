import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { setupTestDb } from './db'

// Synthetic boards. A fake Jira server stands in for Atlassian; nothing here touches a real site.
const tag = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const boards = [
  { id: 2508, name: 'Escape Kanban Board', type: 'kanban', location: { projectKey: 'MESIGN', displayName: 'Mekari ESign' } },
  { id: 212, name: 'MESIGN Sprint Board', type: 'scrum', location: { projectKey: 'MESIGN', displayName: 'Mekari ESign' } },
  { id: 7, name: 'Other board', type: 'scrum', location: { projectKey: 'OTH', displayName: 'Other' } },
]

describe('Jira board search and selection', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Svc: typeof import('../src/modules/connections/service').ConnectionsService
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  const calls: string[] = []

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Svc = (await import('../src/modules/connections/service')).ConnectionsService
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        calls.push(`${u.pathname}${u.search}`)
        if (u.pathname === '/rest/agile/1.0/board') {
          const name = u.searchParams.get('name')?.toLowerCase()
          const project = u.searchParams.get('projectKeyOrId')
          if (project && !['MESIGN', 'OTH'].includes(project)) return Response.json({ errorMessages: [`No project could be found with key '${project}'.`] }, { status: 400 })
          const values = boards.filter((b) => (name ? b.name.toLowerCase().includes(name) : true) && (project ? b.location.projectKey === project : true))
          return Response.json({ values })
        }
        const one = u.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)$/)
        const found = one && boards.find((b) => b.id === Number(one[1]))
        return found ? Response.json(found) : Response.json({ errorMessages: ['not found'] }, { status: 404 })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token', defaultBoardId: undefined })
  })

  afterAll(async () => {
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  const ids = (r: { id: number }[]) => r.map((b) => b.id).sort((a, b) => a - b)

  test('an empty search lists boards', async () => {
    expect(ids(await Svc.listBoards(''))).toEqual([7, 212, 2508])
  })

  test('a project key finds the project boards even when the name does not contain it', async () => {
    const found = await Svc.listBoards('MESIGN')
    expect(ids(found)).toEqual([212, 2508])
    expect(found.find((b) => b.id === 2508)).toEqual({ id: 2508, name: 'Escape Kanban Board', type: 'kanban', project: 'MESIGN' })
  })

  test('a lowercase project key works and duplicates are merged', async () => {
    expect(ids(await Svc.listBoards('mesign'))).toEqual([212, 2508])
  })

  test('a plain word that is not a project key still finds boards by name', async () => {
    expect(ids(await Svc.listBoards('Escape'))).toEqual([2508])
  })

  test('a name with spaces is only a name search', async () => {
    calls.length = 0
    expect(ids(await Svc.listBoards('Escape Kanban'))).toEqual([2508])
    expect(calls.some((c) => c.includes('projectKeyOrId'))).toBe(false)
  })

  test('a pasted Jira board URL resolves exactly that board', async () => {
    const url = 'https://jurnal.atlassian.net/jira/software/c/projects/MESIGN/boards/2508?assignee=abc123'
    expect(ids(await Svc.listBoards(url))).toEqual([2508])
  })

  test('a numeric id resolves that board, an unknown id resolves nothing', async () => {
    expect(ids(await Svc.listBoards(' 212 '))).toEqual([212])
    expect(await Svc.listBoards('999999')).toEqual([])
  })

  test('overview shows the selected board name', async () => {
    const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-sel@test.local`, name: 'Sel' }).returning()
    await ctx.db.insert(S.connections).values({ userId: u!.id, jiraAccountId: `acct-${tag}`, jiraBoardId: 2508 })
    const o = await Svc.overview(u!)
    expect(o.jira).toMatchObject({ boardId: 2508, boardName: 'Escape Kanban Board', boardIsDefault: false })
  })

  test('without a choice the team default board is used and flagged as default', async () => {
    Object.assign(jiraEnv, { defaultBoardId: 212 })
    const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-def@test.local`, name: 'Def' }).returning()
    await ctx.db.insert(S.connections).values({ userId: u!.id, jiraAccountId: `acct-${tag}-2` })
    const o = await Svc.overview(u!)
    Object.assign(jiraEnv, { defaultBoardId: undefined })
    expect(o.jira).toMatchObject({ boardId: 212, boardName: 'MESIGN Sprint Board', boardIsDefault: true })
  })

  test('a user who has not connected Jira triggers no board lookup', async () => {
    Object.assign(jiraEnv, { defaultBoardId: 7 })
    const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-none@test.local`, name: 'None' }).returning()
    const before = calls.length
    const o = await Svc.overview(u!)
    Object.assign(jiraEnv, { defaultBoardId: undefined })
    expect(o.jira.boardName).toBeNull()
    expect(calls.length).toBe(before)
  })
})
