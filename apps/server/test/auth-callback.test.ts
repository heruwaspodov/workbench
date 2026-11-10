import { beforeAll, describe, expect, test } from 'bun:test'
import { setupTestDb } from './db'

describe('OAuth callback route', () => {
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let redirectUri = ''
  let path = ''

  beforeAll(async () => {
    await setupTestDb()
    handler = (await import('../src/app')).app
    redirectUri = (await import('../src/config/env')).env.oauth.redirectUri
    path = new URL(redirectUri).pathname
  })

  const get = (target: string, headers: Record<string, string> = {}) =>
    handler.handle(new Request(`http://localhost${target}`, { headers, redirect: 'manual' }))

  test('redirect URI defaults to /sso-callback on APP_URL', () => {
    if (!process.env.MEKARI_OAUTH_REDIRECT_URI) expect(redirectUri.endsWith('/sso-callback')).toBe(true)
    expect(path.startsWith('/')).toBe(true)
  })

  test('callback is served at the redirect URI path', async () => {
    const res = await get(`${path}?code=abc&state=wrong`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login?error=invalid_state')
  })

  test('state must match the cookie', async () => {
    const res = await get(`${path}?code=abc&state=s1`, { cookie: 'od_oauth_state=s2' })
    expect(res.headers.get('location')).toBe('/login?error=invalid_state')
  })

  test('provider errors are surfaced on the login page', async () => {
    const res = await get(`${path}?error=access_denied&error_description=${encodeURIComponent('Akses ditolak')}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/login?error=${encodeURIComponent('Akses ditolak')}`)
  })

  test('the old /auth/callback path is gone', async () => {
    if (path === '/auth/callback') return
    const res = await get('/auth/callback?code=abc&state=x')
    expect(res.status).toBe(404)
  })
})
