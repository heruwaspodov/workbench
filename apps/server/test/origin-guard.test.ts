import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { originGuard } from '../src/shared/origin-guard'
import { setupTestDb } from './db'

const APP = 'https://desk.example.test'
const unit = new Elysia()
  .use(originGuard(APP))
  .get('/api/ping', () => ({ ok: true }))
  .post('/api/act', () => ({ ok: true }))
  .put('/api/act', () => ({ ok: true }))
  .patch('/api/act', () => ({ ok: true }))
  .delete('/api/act', () => ({ ok: true }))
  .post('/auth/other', () => ({ ok: true }))

const call = (handler: { handle: (r: Request) => Response | Promise<Response> }, method: string, path: string, headers: Record<string, string> = {}) =>
  handler.handle(new Request(`http://localhost${path}`, { method, headers }))

describe('originGuard', () => {
  test('allows safe methods from any origin', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await call(unit, method, '/api/ping', { origin: 'https://evil.example' })
      expect(res.status).not.toBe(403)
    }
  })

  test('allows state-changing requests from APP_URL', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await call(unit, method, '/api/act', { origin: APP })).status).toBe(200)
    }
  })

  test('blocks state-changing requests from another origin', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await call(unit, method, '/api/act', { origin: 'https://evil.example' })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  test('blocks look-alike origins, other ports/schemes and the null origin', async () => {
    for (const origin of [`${APP}.evil.example`, 'https://desk.example.test:8443', 'http://desk.example.test', 'null']) {
      expect((await call(unit, 'POST', '/api/act', { origin })).status).toBe(403)
    }
  })

  test('falls back to Referer when Origin is absent', async () => {
    expect((await call(unit, 'POST', '/api/act', { referer: `${APP}/pgp/plans/1` })).status).toBe(200)
    expect((await call(unit, 'POST', '/api/act', { referer: 'https://evil.example/page' })).status).toBe(403)
  })

  test('fails closed when neither header is present', async () => {
    expect((await call(unit, 'POST', '/api/act')).status).toBe(403)
  })

  test('only guards /api paths', async () => {
    expect((await call(unit, 'POST', '/auth/other', { origin: 'https://evil.example' })).status).toBe(200)
  })

  test('tolerates a trailing slash in APP_URL', async () => {
    const slash = new Elysia().use(originGuard(`${APP}/`)).post('/api/act', () => ({ ok: true }))
    expect((await call(slash, 'POST', '/api/act', { origin: APP })).status).toBe(200)
  })
})

describe('originGuard in the real app', () => {
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let appOrigin = ''

  beforeAll(async () => {
    await setupTestDb()
    handler = (await import('../src/app')).app
    appOrigin = new URL((await import('../src/config/env')).env.appUrl).origin
  })

  test('cross-origin logout is blocked before auth', async () => {
    const res = await call(handler, 'POST', '/api/auth/logout', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  test('same-origin request reaches the handler (logout is public, 200)', async () => {
    const res = await call(handler, 'POST', '/api/auth/logout', { origin: appOrigin })
    expect(res.status).toBe(200)
  })

  test('GET /api/health is unaffected', async () => {
    const res = await call(handler, 'GET', '/api/health', { origin: 'https://evil.example' })
    expect(res.status).toBe(200)
  })
})
