import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { setupTestDb } from './db'

// Synthetic boards behind a fake Jira. Board ids are unique to this file because board config is cached in-process.
const tag = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const SUB = 'created >= 2026-01-01 AND issuetype != Epic'

const boardDefs: Record<number, { type: string; subQuery?: { query: string } }> = {
  9101: { type: 'kanban', subQuery: { query: SUB } },
  9102: { type: 'kanban' },
  9103: { type: 'scrum', subQuery: { query: `${SUB} ORDER BY created ASC` } },
}

describe('Kanban follows the board sub-filter', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Kanban: typeof import('../src/modules/kanban/service')
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  const jqls: string[] = []

  const userOnBoard = async (boardId: number, n: string) => {
    const [u] = await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning()
    await ctx.db.insert(S.connections).values({ userId: u!.id, jiraAccountId: `acct-${tag}-${n}`, jiraVerifiedEmail: u!.email, jiraBoardId: boardId })
    return u!
  }

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Kanban = await import('../src/modules/kanban/service')
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        const m = u.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)(\/configuration|\/issue)?$/)
        const def = m && boardDefs[Number(m[1])]
        if (!m || !def) return Response.json({ errorMessages: ['not found'] }, { status: 404 })
        if (m[2] === '/configuration') {
          return Response.json({ id: Number(m[1]), name: `Board ${m[1]}`, subQuery: def.subQuery, columnConfig: { columns: [{ name: 'Backlog', statuses: [] }, { name: 'To Do', statuses: [{ id: '1' }] }, { name: 'Done', statuses: [{ id: '3' }] }] } })
        }
        if (m[2] === '/issue') {
          jqls.push(u.searchParams.get('jql')!)
          return Response.json({ issues: [{ id: '1', key: 'X-1', fields: { summary: 'Synthetic', status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } }, issuetype: { name: 'Task' }, updated: '2026-11-01T00:00:00.000Z' } }], total: 1 })
        }
        return Response.json({ id: Number(m[1]), name: `Board ${m[1]}`, type: def.type })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token' })
  })

  afterAll(async () => {
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('the board sub-filter and the done window are part of the JQL, before ORDER BY', async () => {
    const user = await userOnBoard(9101, 'a')
    const res = await Kanban.KanbanService.board(user, 'active')
    expect(res.columns.find((c) => c.name === 'To Do')?.cards).toHaveLength(1)
    expect(jqls.at(-1)).toBe(`assignee = "acct-${tag}-a" AND (statusCategory != Done OR updated >= -7d) AND (${SUB}) ORDER BY Rank ASC`)
  })

  test('the empty Kanban "Backlog" placeholder column is not shown', async () => {
    const user = await userOnBoard(9101, 'd')
    const res = await Kanban.KanbanService.board(user, 'active')
    expect(res.columns.map((c) => c.name)).toEqual(['To Do', 'Done'])
  })

  test('a board without a sub-filter is queried as before', async () => {
    const user = await userOnBoard(9102, 'b')
    await Kanban.KanbanService.board(user, 'active')
    expect(jqls.at(-1)).toBe(`assignee = "acct-${tag}-b" AND (statusCategory != Done OR updated >= -7d) ORDER BY Rank ASC`)
  })

  test('the sprint scope keeps the sub-filter and strips a trailing ORDER BY from it', async () => {
    const user = await userOnBoard(9103, 'c')
    await Kanban.KanbanService.board(user, 'sprint')
    expect(jqls.at(-1)).toBe(`assignee = "acct-${tag}-c" AND sprint in openSprints() AND (${SUB}) ORDER BY Rank ASC`)
  })

  test('withSubQuery ignores empty values and cuts any ORDER BY', () => {
    const { withSubQuery } = Kanban
    expect(withSubQuery('a = 1')).toBe('a = 1')
    expect(withSubQuery('a = 1', '   ')).toBe('a = 1')
    expect(withSubQuery('a = 1', 'b = 2')).toBe('a = 1 AND (b = 2)')
    expect(withSubQuery('a = 1', 'b = 2 order by rank')).toBe('a = 1 AND (b = 2)')
  })
})
