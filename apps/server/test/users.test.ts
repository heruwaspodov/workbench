import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { setupTestDb } from './db'

// Synthetic users only. user_admin is global, so this file clears it first and restores ADMIN_EMAILS when done.
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const mail = (n: string) => `${tag}-${n}@test.local`

describe('admin management', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let env: typeof import('../src/config/env').env
  let Auth: typeof import('../src/modules/auth/service').AuthService
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let origin = ''
  // env is read-only in the types but a plain object at runtime; tests swap these two lists and restore them.
  const setEnv = (key: 'adminEmails' | 'allowedDomains', value: string[]) => { (env as unknown as Record<string, unknown>)[key] = value }
  let savedEmails: string[] = []
  const users: Record<string, typeof import('../src/db/schema').users.$inferSelect> = {}
  const tokens: Record<string, string> = {}

  const call = async (method: string, path: string, who: string | null, body?: unknown) => {
    const headers: Record<string, string> = { origin }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (who) headers.cookie = `od_session=${tokens[who]}`
    const res = await handler.handle(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }
  const setAdmin = (who: string | null, target: string, admin: boolean) => call('PUT', `/api/users/${users[target]!.id}/admin`, who, { admin })
  const rows = () => ctx.db.select().from(S.userAdmin)
  const roleOf = async (who: string) => (await Auth.userFromSession(tokens[who]))!.role

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    env = (await import('../src/config/env')).env
    Auth = (await import('../src/modules/auth/service')).AuthService
    handler = (await import('../src/app')).app
    origin = new URL(env.appUrl).origin
    savedEmails = env.adminEmails
    for (const n of ['boss', 'ana', 'bo', 'cy', 'envadmin']) {
      users[n] = (await ctx.db.insert(S.users).values({ email: mail(n), name: `User ${n}` }).returning())[0]!
      tokens[n] = (await Auth.createSession(users[n]!.id)).token
    }
  })

  beforeEach(async () => {
    await ctx.db.delete(S.userAdmin) // the test database only; an empty table means "fallback to ADMIN_EMAILS"
    setEnv('adminEmails', [])
  })

  afterAll(async () => {
    setEnv('adminEmails', savedEmails)
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('effective role: a user_admin row wins; ADMIN_EMAILS counts only while the table is empty', async () => {
    expect(await roleOf('ana')).toBe('member')
    await ctx.db.insert(S.userAdmin).values({ userId: users.ana!.id })
    expect(await roleOf('ana')).toBe('admin')

    await ctx.db.delete(S.userAdmin)
    setEnv('adminEmails', [mail('envadmin')])
    expect(await roleOf('envadmin')).toBe('admin') // table empty, listed
    expect(await roleOf('ana')).toBe('member') // table empty, not listed

    await ctx.db.insert(S.userAdmin).values({ userId: users.ana!.id })
    expect(await roleOf('envadmin')).toBe('member') // table has a row now: the list no longer applies
    expect(await roleOf('ana')).toBe('admin')
  })

  test('the role is read on every request, so a change applies without logging in again', async () => {
    await ctx.db.insert(S.userAdmin).values({ userId: users.boss!.id })
    expect((await call('GET', '/api/users', 'bo')).status).toBe(403)
    expect((await setAdmin('boss', 'bo', true)).status).toBe(200)
    expect((await call('GET', '/api/users', 'bo')).status).toBe(200) // same token, no new login
    expect((await setAdmin('boss', 'bo', false)).status).toBe(200)
    expect((await call('GET', '/api/users', 'bo')).status).toBe(403)
  })

  test('only admins can list or change; no session is 401', async () => {
    expect((await call('GET', '/api/users', null)).status).toBe(401)
    expect((await call('GET', '/api/users', 'ana')).status).toBe(403)
    expect((await setAdmin('ana', 'bo', true)).status).toBe(403)
    expect((await setAdmin(null, 'bo', true)).status).toBe(401)
    expect(await rows()).toHaveLength(0)
  })

  test('granting records who granted it and is idempotent', async () => {
    await ctx.db.insert(S.userAdmin).values({ userId: users.boss!.id })
    const res = await setAdmin('boss', 'ana', true)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ isAdmin: true, adminSource: 'table', grantedBy: 'User boss' })
    expect((await setAdmin('boss', 'ana', true)).status).toBe(200)
    expect((await rows()).filter((r) => r.userId === users.ana!.id)).toHaveLength(1)
    expect((await rows()).find((r) => r.userId === users.ana!.id)!.grantedBy).toBe(users.boss!.id)
  })

  test('the first grant moves admins from ADMIN_EMAILS into the table so nobody loses access', async () => {
    setEnv('adminEmails', [mail('envadmin'), mail('boss')])
    expect(await roleOf('boss')).toBe('admin') // through the fallback
    expect((await setAdmin('boss', 'ana', true)).status).toBe(200)
    const ids = (await rows()).map((r) => r.userId).sort()
    expect(ids).toEqual([users.boss!.id, users.envadmin!.id, users.ana!.id].sort())
    expect(await roleOf('boss')).toBe('admin')
    expect(await roleOf('envadmin')).toBe('admin') // still admin, now through the table
    expect(await roleOf('ana')).toBe('admin')
    expect((await rows()).find((r) => r.userId === users.envadmin!.id)!.grantedBy).toBeNull()
  })

  test('safeguards: you cannot remove yourself, and removing a non-admin changes nothing', async () => {
    await ctx.db.insert(S.userAdmin).values([{ userId: users.boss!.id }, { userId: users.ana!.id }])
    const self = await setAdmin('boss', 'boss', false)
    expect(self.status).toBe(400)
    expect(self.json.message).toContain('your own')
    expect(await rows()).toHaveLength(2)

    expect((await setAdmin('boss', 'bo', false)).status).toBe(200) // bo was never an admin
    expect(await rows()).toHaveLength(2)
  })

  test('there is always an admin left: the last one cannot remove themselves, and a removed admin is locked out at once', async () => {
    await ctx.db.insert(S.userAdmin).values([{ userId: users.boss!.id }, { userId: users.ana!.id }])
    expect((await setAdmin('boss', 'ana', false)).status).toBe(200)
    expect((await setAdmin('ana', 'boss', false)).status).toBe(403) // ana's old session is no longer an admin
    expect((await setAdmin('boss', 'boss', false)).status).toBe(400) // boss is the last admin and cannot remove themselves
    expect((await rows()).map((r) => r.userId)).toEqual([users.boss!.id])
  })

  test('an admin who exists only in ADMIN_EMAILS cannot be removed here', async () => {
    setEnv('adminEmails', [mail('boss'), mail('envadmin')])
    const res = await setAdmin('boss', 'envadmin', false)
    expect(res.status).toBe(409)
    expect(res.json.code).toBe('ADMIN_FROM_ENV')
    expect(await rows()).toHaveLength(0)
  })

  test('unknown user is 404 and a bad id is rejected', async () => {
    await ctx.db.insert(S.userAdmin).values({ userId: users.boss!.id })
    expect((await call('PUT', '/api/users/00000000-0000-0000-0000-000000000000/admin', 'boss', { admin: true })).status).toBe(404)
    expect((await call('PUT', '/api/users/not-an-id/admin', 'boss', { admin: true })).status).toBe(422)
    expect((await call('PUT', `/api/users/${users.ana!.id}/admin`, 'boss', { admin: 'yes' })).status).toBe(422)
  })

  test('list: admins first, search by name or email, paging, and the fallback flag', async () => {
    await ctx.db.insert(S.userAdmin).values({ userId: users.cy!.id })
    const all = await call('GET', `/api/users?q=${tag}&pagelen=50`, 'cy')
    expect(all.status).toBe(200)
    expect(all.json.total).toBe(5)
    expect(all.json.items[0]).toMatchObject({ id: users.cy!.id, isAdmin: true, adminSource: 'table' })
    expect(all.json.fallback).toBe(false)

    const byName = await call('GET', `/api/users?q=${encodeURIComponent('User ana')}`, 'cy')
    expect(byName.json.items.map((u: { name: string }) => u.name)).toEqual(['User ana'])
    expect((await call('GET', `/api/users?q=${tag}-bo%40`, 'cy')).json.total).toBe(1)
    expect((await call('GET', '/api/users?q=%25', 'cy')).json.total).toBe(0) // a literal percent sign, not a wildcard

    const p1 = await call('GET', `/api/users?q=${tag}&pagelen=2&page=1`, 'cy')
    const p3 = await call('GET', `/api/users?q=${tag}&pagelen=2&page=3`, 'cy')
    expect(p1.json.items).toHaveLength(2)
    expect(p1.json.hasNext).toBe(true)
    expect(p3.json.items).toHaveLength(1)
    expect(p3.json.hasNext).toBe(false)

    await ctx.db.delete(S.userAdmin)
    setEnv('adminEmails', [mail('envadmin')])
    const fb = await call('GET', `/api/users?q=${tag}-envadmin`, 'envadmin')
    expect(fb.json.fallback).toBe(true)
    expect(fb.json.items[0]).toMatchObject({ isAdmin: true, adminSource: 'env', adminSince: null })
  })

  test('login no longer writes users.role', async () => {
    const savedDomains = env.allowedDomains
    setEnv('allowedDomains', []) // the dev .env restricts domains and these users are @test.local
    setEnv('adminEmails', [mail('fresh')])
    const user = await Auth.upsertUser({ subject: `s-${tag}`, email: mail('fresh'), name: 'Fresh User' })
    expect(user.role).toBe('member') // the column keeps its default; the effective role comes from user_admin / the fallback
    const token = (await Auth.createSession(user.id)).token
    expect((await Auth.userFromSession(token))!.role).toBe('admin') // fallback while the table is empty
    setEnv('allowedDomains', savedDomains)
  })
})
