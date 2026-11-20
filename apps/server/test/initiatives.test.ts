import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { anomaliesFor, statusCategory } from '../src/modules/initiatives/anomalies'
import { setupTestDb } from './db'

// Synthetic data only. Year 2100 is reserved for this file so it never meets real rows in a shared test database.
const YEAR = 2100
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TODAY = '2026-11-20'

const base = {
  epicStatus: 'In Progress', ownerName: 'Synthetic Owner', estDeliveryDate: '2026-12-31', actualDeliveryDate: null,
  doneItems: 3, totalItems: 10, criticality: 'Strategic', needsReview: false,
}

describe('anomaly rules', () => {
  test('a healthy open epic has nothing to act on', () => {
    expect(anomaliesFor(base, TODAY)).toEqual([])
  })

  test('status categories', () => {
    expect(statusCategory('Done')).toBe('done')
    expect(statusCategory(' done ')).toBe('done')
    expect(statusCategory('To Do')).toBe('todo')
    expect(statusCategory('Backlog')).toBe('todo')
    expect(statusCategory('In Testing')).toBe('active')
    expect(statusCategory('Development')).toBe('active')
  })

  test('no task breakdown', () => {
    expect(anomaliesFor({ ...base, totalItems: null, doneItems: null }, TODAY).join(' ')).toContain('No task breakdown')
    expect(anomaliesFor({ ...base, totalItems: 0, doneItems: 0 }, TODAY).join(' ')).toContain('No task breakdown')
  })

  test('epic status contradicting its children', () => {
    expect(anomaliesFor({ ...base, epicStatus: 'Done', actualDeliveryDate: '2026-11-01', doneItems: 7, totalItems: 10 }, TODAY).join(' ')).toContain('3 child item(s) are still open')
    expect(anomaliesFor({ ...base, doneItems: 10, totalItems: 10 }, TODAY).join(' ')).toContain('All child items are done')
    expect(anomaliesFor({ ...base, epicStatus: 'To Do', doneItems: 2 }, TODAY).join(' ')).toContain('not started')
  })

  test('missing owner counts only while the epic is open', () => {
    expect(anomaliesFor({ ...base, ownerName: null }, TODAY)).toContain('No epic owner (assignee).')
    const done = { ...base, epicStatus: 'Done', ownerName: null, doneItems: 10, totalItems: 10, actualDeliveryDate: '2026-11-01' }
    expect(anomaliesFor(done, TODAY)).toEqual([])
  })

  test('delivery dates', () => {
    expect(anomaliesFor({ ...base, estDeliveryDate: null }, TODAY)).toContain('No Est. Delivery Date on the epic.')
    expect(anomaliesFor({ ...base, estDeliveryDate: '2026-11-19' }, TODAY).join(' ')).toContain('has passed')
    expect(anomaliesFor({ ...base, estDeliveryDate: TODAY }, TODAY)).toEqual([]) // due today is not late yet
    expect(anomaliesFor({ ...base, actualDeliveryDate: '2026-11-01' }, TODAY)).toContain('Actual Delivery Date is set on an open epic.')
    const done = { ...base, epicStatus: 'Done', doneItems: 10, totalItems: 10, actualDeliveryDate: null }
    expect(anomaliesFor(done, TODAY)).toContain('Epic is Done but has no Actual Delivery Date.')
  })

  test('criticality and review flag', () => {
    expect(anomaliesFor({ ...base, criticality: '  ' }, TODAY)).toContain('No criticality set.')
    expect(anomaliesFor({ ...base, needsReview: true }, TODAY).join(' ')).toContain('Marked for review')
  })
})

describe('initiatives API', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let adminToken = ''
  let memberToken = ''
  let appOrigin = ''

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = { origin: appOrigin } // the CSRF guard only accepts APP_URL
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.cookie = `od_session=${token}`
    const res = await handler.handle(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }
  const create = (token: string | null, o: Record<string, unknown>) => call('POST', '/api/initiatives', token, { year: YEAR, quarter: 4, title: 'Synthetic initiative', ...o })
  const clear = () => ctx.db.delete(S.initiatives).where(eq(S.initiatives.year, YEAR))

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    handler = (await import('../src/app')).app
    appOrigin = new URL((await import('../src/config/env')).env.appUrl).origin
    const { AuthService } = await import('../src/modules/auth/service')
    // Admin means a row in user_admin (the users.role column is no longer read). Deleting the user in afterAll removes the row.
    const mk = async (n: string, role: 'admin' | 'member') => {
      const user = (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
      if (role === 'admin') await ctx.db.insert(S.userAdmin).values({ userId: user.id })
      return user
    }
    adminToken = (await AuthService.createSession((await mk('admin', 'admin')).id)).token
    memberToken = (await AuthService.createSession((await mk('member', 'member')).id)).token
    await clear()
  })

  afterAll(async () => {
    await clear()
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('reading needs a session; writing needs an admin', async () => {
    expect((await call('GET', `/api/initiatives?year=${YEAR}&quarter=4`, null)).status).toBe(401)
    expect((await call('GET', `/api/initiatives?year=${YEAR}&quarter=4`, memberToken)).status).toBe(200)
    expect((await create(memberToken, { jiraKey: 'TST-1' })).status).toBe(403)
    expect((await create(null, { jiraKey: 'TST-1' })).status).toBe(401)
    const made = await create(adminToken, { jiraKey: 'TST-1' })
    expect(made.status).toBe(200)
    expect((await call('PATCH', `/api/initiatives/${made.json.id}`, memberToken, { title: 'x' })).status).toBe(403)
    expect((await call('DELETE', `/api/initiatives/${made.json.id}`, memberToken)).status).toBe(403)
    expect((await call('GET', '/api/initiatives/periods', null)).status).toBe(401)
  })

  test('create normalises the key and returns derived anomalies', async () => {
    const res = await create(adminToken, { jiraKey: ' tst-2 ', squad: ' Escape ', ownerName: '', criticality: 'BaU', estDeliveryDate: '2026-12-31', totalItems: 4, doneItems: 1 })
    expect(res.status).toBe(200)
    expect(res.json.jiraKey).toBe('TST-2')
    expect(res.json.squad).toBe('Escape')
    expect(res.json.epicStatus).toBe('To Do')
    expect(res.json.anomalies).toContain('No epic owner (assignee).')
    expect(res.json.resolution).toBe('Open')
  })

  test('the same epic is unique per quarter but may appear in another quarter', async () => {
    expect((await create(adminToken, { jiraKey: 'TST-3' })).status).toBe(200)
    const dup = await create(adminToken, { jiraKey: 'TST-3' })
    expect(dup.status).toBe(409)
    expect(dup.json.code).toBe('INITIATIVE_EXISTS')
    expect((await create(adminToken, { jiraKey: 'TST-3', quarter: 3 })).status).toBe(200)
  })

  test('rejects bad input', async () => {
    expect((await create(adminToken, { jiraKey: 'not a key' })).status).toBe(400)
    expect((await create(adminToken, { jiraKey: 'TST-4', doneItems: 5, totalItems: 2 })).status).toBe(400)
    expect((await create(adminToken, { jiraKey: 'TST-4', doneItems: 5 })).status).toBe(400)
    expect((await create(adminToken, { jiraKey: 'TST-4', prdUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await create(adminToken, { jiraKey: 'TST-4', estDeliveryDate: '2026-02-30' })).status).toBe(400)
    expect((await create(adminToken, { jiraKey: 'TST-4', quarter: 5 })).status).toBe(422)
    expect((await create(adminToken, { jiraKey: 'TST-4', title: '' })).status).toBe(422)
    expect((await create(adminToken, { jiraKey: 'TST-4', milestones: [{ kind: 'release', date: '2026-13-01' }] })).status).toBe(400)
  })

  test('milestones are stored, ordered by date, and replaced on update', async () => {
    const made = await create(adminToken, {
      jiraKey: 'TST-5', milestones: [{ kind: 'release', date: '2100-11-30', label: 'Release' }, { kind: 'self_test', date: '2100-11-20' }],
    })
    expect(made.json.milestones.map((m: { kind: string }) => m.kind)).toEqual(['self_test', 'release'])
    const upd = await call('PATCH', `/api/initiatives/${made.json.id}`, adminToken, { milestones: [{ kind: 'release', date: '2100-12-11' }] })
    expect(upd.status).toBe(200)
    expect(upd.json.milestones).toHaveLength(1)
    expect(upd.json.milestones[0].date).toBe('2100-12-11')
  })

  test('update changes only the fields sent, keeps identity, and re-checks item counts', async () => {
    const made = await create(adminToken, { jiraKey: 'TST-6', title: 'Before', ownerName: 'Synthetic Owner', totalItems: 10, doneItems: 2 })
    const upd = await call('PATCH', `/api/initiatives/${made.json.id}`, adminToken, { title: ' After ', epicStatus: 'Done' })
    expect(upd.status).toBe(200)
    expect(upd.json.title).toBe('After')
    expect(upd.json.epicStatus).toBe('Done')
    expect(upd.json.ownerName).toBe('Synthetic Owner')
    expect(upd.json.jiraKey).toBe('TST-6')
    expect((await call('PATCH', `/api/initiatives/${made.json.id}`, adminToken, { doneItems: 11 })).status).toBe(400) // 11 > 10 already stored
    expect((await call('PATCH', `/api/initiatives/${made.json.id}`, adminToken, {})).status).toBe(400)
    const cleared = await call('PATCH', `/api/initiatives/${made.json.id}`, adminToken, { ownerName: null })
    expect(cleared.json.ownerName).toBeNull()
    expect((await call('PATCH', '/api/initiatives/00000000-0000-0000-0000-000000000000', adminToken, { title: 'x' })).status).toBe(404)
  })

  test('delete removes the row and its milestones', async () => {
    const made = await create(adminToken, { jiraKey: 'TST-7', milestones: [{ kind: 'release', date: '2100-12-11' }] })
    expect((await call('DELETE', `/api/initiatives/${made.json.id}`, adminToken)).status).toBe(200)
    expect((await call('DELETE', `/api/initiatives/${made.json.id}`, adminToken)).status).toBe(404)
    expect(await ctx.db.select().from(S.initiativeMilestones).where(eq(S.initiativeMilestones.initiativeId, made.json.id))).toHaveLength(0)
  })

  describe('filters, periods and summary', () => {
    const Q = 2 // a quarter nothing else in this file touches
    beforeAll(async () => {
      const row = (o: Record<string, unknown>) => create(adminToken, { quarter: Q, ...o })
      await row({ jiraKey: 'FLT-1', squad: 'Escape', title: 'Alpha 100% onboarding', epicStatus: 'Done', criticality: 'Strategic', ownerName: 'Ana Synth', estDeliveryDate: '2100-05-10', actualDeliveryDate: '2100-05-09', totalItems: 4, doneItems: 4 })
      await row({ jiraKey: 'FLT-2', squad: 'Escape', title: 'Beta', epicStatus: 'In Progress', criticality: 'BaU', ownerName: 'Bo Synth', estDeliveryDate: '2100-06-20', totalItems: 10, doneItems: 3 })
      await row({ jiraKey: 'FLT-3', squad: 'Utmost', title: 'Gamma', epicStatus: 'In Testing', criticality: 'Strategic', ownerName: 'Cy Synth', estDeliveryDate: '2100-06-30', totalItems: 6, doneItems: 5, needsReview: true })
      await row({ jiraKey: 'FLT-4', title: 'Delta', epicStatus: 'To Do', remark: 'blocked by vendor' })
    })

    const list = async (qs: string) => (await call('GET', `/api/initiatives?year=${YEAR}&quarter=${Q}${qs}`, memberToken)).json.map((r: { jiraKey: string }) => r.jiraKey)

    test('each filter narrows the list; a quarter never leaks into another', async () => {
      expect((await list('')).sort()).toEqual(['FLT-1', 'FLT-2', 'FLT-3', 'FLT-4'])
      expect((await list('&squad=Escape')).sort()).toEqual(['FLT-1', 'FLT-2'])
      expect(await list('&status=in%20testing')).toEqual(['FLT-3'])
      expect((await list('&criticality=Strategic')).sort()).toEqual(['FLT-1', 'FLT-3'])
      expect(await list('&month=2100-06')).toHaveLength(2)
      expect(await list('&q=synth')).toHaveLength(3) // owner names
      expect(await list('&q=vendor')).toEqual(['FLT-4']) // remark text
      expect(await list('&q=flt-3')).toEqual(['FLT-3']) // Jira key, case-insensitive
      expect(await list('&q=100%25')).toEqual(['FLT-1']) // a literal percent sign, not a wildcard
      expect(await list('&q=%25')).toEqual(['FLT-1'])
      const other = await call('GET', `/api/initiatives?year=${YEAR}&quarter=1`, memberToken)
      expect(other.json).toEqual([])
    })

    test('periods lists only quarters with data, newest first', async () => {
      const res = await call('GET', '/api/initiatives/periods', memberToken)
      const mine = res.json.filter((p: { year: number }) => p.year === YEAR)
      expect(mine.map((p: { quarter: number }) => p.quarter)).toEqual([4, 3, 2])
      expect(mine.find((p: { quarter: number }) => p.quarter === 2).count).toBe(4)
    })

    test('summary counts statuses, reviews, anomalies and squads', async () => {
      const res = await call('GET', `/api/initiatives/summary?year=${YEAR}&quarter=${Q}`, memberToken)
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ total: 4, done: 1, donePercent: 25, active: 2, notStarted: 1, needsReview: 1 })
      expect(res.json.withAnomalies).toBeGreaterThanOrEqual(2) // FLT-3 (review) and FLT-4 (no owner, no breakdown, ...)
      expect(res.json.squads).toEqual([{ squad: 'Escape', total: 2, done: 1 }, { squad: 'Unassigned', total: 1, done: 0 }, { squad: 'Utmost', total: 1, done: 0 }])
    })

    test('a Done epic without an owner is not flagged for it', async () => {
      await create(adminToken, { quarter: Q, jiraKey: 'FLT-5', epicStatus: 'Done', criticality: 'BaU', actualDeliveryDate: '2100-05-09', totalItems: 2, doneItems: 2 })
      const res = await call('GET', `/api/initiatives?year=${YEAR}&quarter=${Q}&q=FLT-5`, memberToken)
      expect(res.json[0].ownerName).toBeNull()
      expect(res.json[0].anomalies).toEqual([])
      expect(res.json[0].resolution).toBeNull()
    })
  })
})
