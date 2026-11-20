import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { setupTestDb } from './db'

// Synthetic data only. A fake Jira answers the two searches the sync makes: `key in (...)` for epics and
// `parent in (...)` for their children. Year 2097 is reserved for this file.
const YEAR = 2097
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const F = { est: 'customfield_est', actual: 'customfield_actual', crit: 'customfield_crit', pstatus: 'customfield_pstatus' }

type Issue = { id: string; key: string; fields: Record<string, unknown> }
const epic = (key: string, f: Record<string, unknown> = {}): Issue => ({
  id: key, key,
  fields: {
    summary: `Jira title of ${key}`, status: { name: 'Done', statusCategory: { key: 'done' } }, assignee: { displayName: 'Synthetic Owner' },
    [F.est]: '2099-11-30', [F.actual]: '2099-11-19', [F.crit]: { value: 'BaU' }, [F.pstatus]: { value: 'Done' }, ...f,
  },
})
const child = (parent: string, n: number, category: 'done' | 'indeterminate' | 'new', name = 'Done'): Issue =>
  ({ id: `${parent}-c${n}`, key: `${parent}-c${n}`, fields: { parent: { key: parent }, status: { name, statusCategory: { key: category } } } })

describe('sync from Jira', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let jiraEnv: Record<string, unknown>
  let saved: Record<string, unknown> = {}
  let server: ReturnType<typeof Bun.serve>
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let adminToken = ''
  let memberToken = ''
  let appOrigin = ''
  let delayMs = 0

  let EPICS: Record<string, Issue> = {}
  let CHILDREN: Record<string, Issue[]> = {}
  const hits: string[] = []

  const searchPage = (jql: string, token: string | undefined) => {
    if (jql.startsWith('key in (')) return { issues: Object.values(EPICS).filter((e) => jql.includes(`"${e.key}"`)) }
    if (jql.startsWith('parent in (')) {
      const all = Object.entries(CHILDREN).filter(([k]) => jql.includes(`"${k}"`)).flatMap(([, v]) => v)
      const infinite = jql.includes('"BIG-1"') // a group that never ends, to reach the cap
      const start = Number(token ?? 0)
      const page = infinite ? Array.from({ length: 100 }, (_, i) => child('BIG-1', start + i, 'new', 'To Do')) : all.slice(start, start + 100)
      const more = infinite || start + 100 < all.length
      return { issues: page, ...(more ? { nextPageToken: String(start + 100) } : {}) }
    }
    return { issues: [] }
  }

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = { origin: appOrigin }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.cookie = `od_session=${token}`
    const res = await handler.handle(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }
  const sync = (body: Record<string, unknown> = {}, token: string | null = adminToken) => call('POST', '/api/initiatives/sync', token, { year: YEAR, quarter: 4, ...body })
  const row = async (key: string, quarter = 4) => (await ctx.db.select().from(S.initiatives).where(eq(S.initiatives.jiraKey, key))).find((r) => r.quarter === quarter)!
  const clear = () => ctx.db.delete(S.initiatives).where(eq(S.initiatives.year, YEAR))
  const seed = (jiraKey: string, o: Record<string, unknown> = {}, quarter = 4) => ctx.db.insert(S.initiatives).values({
    year: YEAR, quarter, jiraKey, title: `Sheet title of ${jiraKey}`, squad: 'Escape', epicStatus: 'To Do', ownerName: 'Old Owner', criticality: 'Strategic',
    estDeliveryDate: '2099-01-01', doneItems: 1, totalItems: 3, remark: 'TPM remark', remarkProposed: 'Proposed text', sheetAnomalies: 'Sheet anomaly',
    sheetResolution: 'Open', repoNote: 'repo/note.md', needsReview: true, ...o,
  }).returning()

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    const env = (await import('../src/config/env')).env
    handler = (await import('../src/app')).app
    appOrigin = new URL(env.appUrl).origin
    jiraEnv = env.jira as unknown as Record<string, unknown>
    saved = { ...jiraEnv }
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname !== '/rest/api/3/search/jql') return new Response('not found', { status: 404 })
        const { jql, nextPageToken } = (await req.json()) as { jql: string; nextPageToken?: string }
        hits.push(jql)
        if (delayMs) await Bun.sleep(delayMs)
        return Response.json(searchPage(jql, nextPageToken))
      },
    })
    const { AuthService } = await import('../src/modules/auth/service')
    const mk = async (n: string, admin: boolean) => {
      const user = (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
      if (admin) await ctx.db.insert(S.userAdmin).values({ userId: user.id })
      return (await AuthService.createSession(user.id)).token
    }
    adminToken = await mk('admin', true)
    memberToken = await mk('member', false)
    await clear()
  })

  beforeEach(async () => {
    Object.assign(jiraEnv, saved, {
      baseUrl: `http://localhost:${server.port}`, email: 'svc@example.test', apiToken: 'svc-token',
      estDeliveryField: F.est, deliveryDateField: F.actual, criticalityField: F.crit, projectStatusField: F.pstatus,
    })
    EPICS = {}
    CHILDREN = {}
    hits.length = 0
    delayMs = 0
    await clear()
  })

  afterAll(async () => {
    Object.assign(jiraEnv, saved)
    server.stop(true)
    await clear()
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('refreshes the Jira-owned columns and counts progress from the children (Won\'t Fix counts as done)', async () => {
    await seed('SYN-1')
    EPICS['SYN-1'] = epic('SYN-1')
    CHILDREN['SYN-1'] = [child('SYN-1', 1, 'done'), child('SYN-1', 2, 'done', "Won't Fix"), child('SYN-1', 3, 'indeterminate', 'In Progress'), child('SYN-1', 4, 'new', 'To Do')]
    const res = await sync()
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ checked: 1, updated: 1, unchanged: 0, missing: [], skipped: [] })
    expect(res.json.rows[0].jiraKey).toBe('SYN-1')
    expect(res.json.rows[0].changes.sort()).toEqual(['actualDeliveryDate', 'criticality', 'epicStatus', 'estDeliveryDate', 'ownerName', 'progress', 'projectStatus'])
    expect(await row('SYN-1')).toMatchObject({
      epicStatus: 'Done', projectStatus: 'Done', ownerName: 'Synthetic Owner', criticality: 'BaU', estDeliveryDate: '2099-11-30', actualDeliveryDate: '2099-11-19',
      doneItems: 2, totalItems: 4,
    })
  })

  test('what the sheet or the TPM wrote is left alone', async () => {
    await seed('SYN-2')
    EPICS['SYN-2'] = epic('SYN-2')
    CHILDREN['SYN-2'] = [child('SYN-2', 1, 'done')]
    await ctx.db.insert(S.initiativeMilestones).values({ initiativeId: (await row('SYN-2')).id, kind: 'release', date: '2099-12-01' })
    await sync()
    expect(await row('SYN-2')).toMatchObject({
      title: 'Sheet title of SYN-2', squad: 'Escape', remark: 'TPM remark', remarkProposed: 'Proposed text', sheetAnomalies: 'Sheet anomaly', sheetResolution: 'Open',
      repoNote: 'repo/note.md', needsReview: true,
    })
    expect((await ctx.db.select().from(S.initiativeMilestones).where(eq(S.initiativeMilestones.initiativeId, (await row('SYN-2')).id)))).toHaveLength(1)
  })

  test('syncing again with nothing new in Jira changes nothing, and the time is stamped on the rows that were checked', async () => {
    await seed('SYN-3')
    EPICS['SYN-3'] = epic('SYN-3')
    CHILDREN['SYN-3'] = [child('SYN-3', 1, 'done')]
    expect((await row('SYN-3')).jiraSyncedAt).toBeNull()
    await sync()
    const first = (await row('SYN-3')).jiraSyncedAt
    expect(first).not.toBeNull()
    const again = await sync()
    expect(again.json).toMatchObject({ checked: 1, updated: 0, unchanged: 1 })
    expect(again.json.rows).toEqual([])
    expect((await row('SYN-3')).jiraSyncedAt!.getTime()).toBeGreaterThanOrEqual(first!.getTime())
  })

  test('an epic Jira does not return is reported and its row is untouched', async () => {
    await seed('SYN-4')
    const res = await sync()
    expect(res.json).toMatchObject({ checked: 1, updated: 0, unchanged: 0, missing: ['SYN-4'] })
    expect(await row('SYN-4')).toMatchObject({ epicStatus: 'To Do', ownerName: 'Old Owner', jiraSyncedAt: null })
  })

  test('children are followed across pages, and an epic without children has no progress', async () => {
    await seed('SYN-5')
    await seed('SYN-6')
    EPICS['SYN-5'] = epic('SYN-5')
    EPICS['SYN-6'] = epic('SYN-6')
    CHILDREN['SYN-5'] = Array.from({ length: 230 }, (_, i) => child('SYN-5', i, i < 150 ? 'done' : 'new', i < 150 ? 'Done' : 'To Do'))
    await sync()
    expect(await row('SYN-5')).toMatchObject({ doneItems: 150, totalItems: 230 })
    expect(await row('SYN-6')).toMatchObject({ doneItems: null, totalItems: null })
  })

  test('a children list that is cut off leaves the progress of that group of epics alone and is reported; other groups are fine', async () => {
    // Children are fetched 15 epics at a time. BIG-1 never ends its children list, so its group of 15 is skipped.
    const keys = ['BIG-1', ...Array.from({ length: 14 }, (_, i) => `FIL-${i + 1}`), 'SYN-7']
    for (const k of keys) { await seed(k); EPICS[k] = epic(k) } // Jira returns epics in this order, so SYN-7 is in the second group
    CHILDREN['SYN-7'] = [child('SYN-7', 1, 'done')]
    const res = await sync()
    expect(res.status).toBe(200)
    expect(res.json.skipped).toContain('BIG-1')
    expect(res.json.skipped).toContain('FIL-14')
    expect(res.json.skipped).not.toContain('SYN-7')
    expect(await row('BIG-1')).toMatchObject({ epicStatus: 'Done', doneItems: 1, totalItems: 3 }) // status moved, progress kept
    expect(await row('SYN-7')).toMatchObject({ epicStatus: 'Done', doneItems: 1, totalItems: 1 }) // the next group was counted
  })

  test('a value that is empty in Jira clears the column', async () => {
    await seed('SYN-8')
    EPICS['SYN-8'] = epic('SYN-8', { assignee: null, [F.crit]: null, [F.est]: null })
    CHILDREN['SYN-8'] = [child('SYN-8', 1, 'done')]
    await sync()
    expect(await row('SYN-8')).toMatchObject({ ownerName: null, criticality: null, estDeliveryDate: null })
  })

  test('a field that is not configured is not synced', async () => {
    await seed('SYN-9')
    EPICS['SYN-9'] = epic('SYN-9')
    CHILDREN['SYN-9'] = [child('SYN-9', 1, 'done')]
    Object.assign(jiraEnv, { criticalityField: '', estDeliveryField: '' })
    await sync()
    expect(await row('SYN-9')).toMatchObject({ criticality: 'Strategic', estDeliveryDate: '2099-01-01', epicStatus: 'Done' })
  })

  test('keys limit the sync to those rows, and other quarters are never touched', async () => {
    await seed('SYN-10')
    await seed('SYN-11')
    await seed('SYN-10', {}, 3)
    for (const k of ['SYN-10', 'SYN-11']) { EPICS[k] = epic(k); CHILDREN[k] = [child(k, 1, 'done')] }
    const res = await sync({ keys: ['syn-10'] })
    expect(res.json.checked).toBe(1)
    expect((await row('SYN-10')).epicStatus).toBe('Done')
    expect((await row('SYN-11')).epicStatus).toBe('To Do') // not in keys
    expect((await row('SYN-10', 3)).epicStatus).toBe('To Do') // another quarter
    expect(hits.every((h) => !h.includes('SYN-11'))).toBe(true)
  })

  test('the anomaly "Done but children open" goes away once the counts are fresh', async () => {
    await seed('SYN-12', { epicStatus: 'Done', actualDeliveryDate: '2099-11-19', doneItems: 1, totalItems: 3 })
    const before = (await call('GET', `/api/initiatives?year=${YEAR}&quarter=4&q=SYN-12`, adminToken)).json[0]
    expect(before.anomalies.join(' ')).toContain('child item(s) are still open')
    EPICS['SYN-12'] = epic('SYN-12')
    CHILDREN['SYN-12'] = [child('SYN-12', 1, 'done'), child('SYN-12', 2, 'done'), child('SYN-12', 3, 'done')]
    await sync()
    const after = (await call('GET', `/api/initiatives?year=${YEAR}&quarter=4&q=SYN-12`, adminToken)).json[0]
    expect(after.anomalies.join(' ')).not.toContain('child item(s) are still open')
    expect(after).toMatchObject({ doneItems: 3, totalItems: 3 })
    expect(after.jiraSyncedAt).not.toBeNull()
  })

  test('only admins; Jira must be configured; one sync at a time', async () => {
    await seed('SYN-13')
    EPICS['SYN-13'] = epic('SYN-13')
    expect((await sync({}, memberToken)).status).toBe(403)
    expect((await sync({}, null)).status).toBe(401)
    expect((await sync({ quarter: 5 })).status).toBe(422)

    Object.assign(jiraEnv, { baseUrl: '' })
    const off = await sync()
    expect(off.status).toBe(503)
    expect(off.json.code).toBe('JIRA_NOT_CONFIGURED')
    Object.assign(jiraEnv, { baseUrl: `http://localhost:${server.port}` })

    delayMs = 150
    const [a, b] = await Promise.all([sync(), sync()])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect([a, b].find((r) => r.status === 409)!.json.code).toBe('SYNC_RUNNING')
    expect((await sync()).status).toBe(200) // the lock is released afterwards
  })

  test('an empty quarter is a quiet no-op and does not call Jira', async () => {
    const res = await sync()
    expect(res.json).toMatchObject({ checked: 0, updated: 0, unchanged: 0, missing: [], skipped: [], rows: [] })
    expect(hits).toHaveLength(0)
  })
})
