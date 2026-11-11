import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

// Jira returns at most 100 issues per page and hands back nextPageToken; a fake site pages the same way.
describe('jira.search pagination', () => {
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let jira: typeof import('../src/integrations/jira.client').jira
  const bodies: { maxResults: number; nextPageToken?: string }[] = []
  const TOTAL = 230
  const PAGE = 100

  beforeAll(async () => {
    jiraEnv = (await import('../src/config/env')).env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }
    jira = (await import('../src/integrations/jira.client')).jira
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { maxResults: number; nextPageToken?: string }
        bodies.push(body)
        const start = body.nextPageToken ? Number(body.nextPageToken) : 0
        const size = Math.min(body.maxResults, PAGE, TOTAL - start)
        const issues = Array.from({ length: size }, (_, i) => ({ id: String(start + i), key: `X-${start + i}`, fields: {} }))
        return Response.json({ issues, ...(start + size < TOTAL ? { nextPageToken: String(start + size) } : {}) })
      },
    })
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token' })
  })
  afterAll(() => { Object.assign(jiraEnv, saved); server.stop(true) })

  test('collects every page up to the limit', async () => {
    const res = await jira.search('x', [], 500)
    expect(res.issues).toHaveLength(TOTAL)
    expect(res.truncated).toBe(false)
    expect(new Set(res.issues.map((i) => i.key)).size).toBe(TOTAL)
  })

  test('stops at the limit and says the results were cut', async () => {
    const res = await jira.search('x', [], 150)
    expect(res.issues).toHaveLength(150)
    expect(res.truncated).toBe(true)
    expect(bodies.at(-1)!.maxResults).toBe(50) // the second page only asks for what is still missing
  })

  test('a single page needs a single request', async () => {
    const before = bodies.length
    const res = await jira.search('x', [], 40)
    expect(res.issues).toHaveLength(40)
    expect(bodies.length - before).toBe(1)
  })
})
