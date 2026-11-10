import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { setupTestDb } from './db'

describe('OAuth token exchange', () => {
  let AuthService: typeof import('../src/modules/auth/service').AuthService
  let oauth: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let received: { contentType: string | null; body: Record<string, unknown> } | null = null
  let reply: { status: number; json: unknown } = { status: 200, json: {} }

  beforeAll(async () => {
    await setupTestDb()
    AuthService = (await import('../src/modules/auth/service')).AuthService
    oauth = (await import('../src/config/env')).env.oauth as unknown as Record<string, unknown>
    saved = { ...oauth }
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        received = { contentType: req.headers.get('content-type'), body: await req.json() }
        return Response.json(reply.json, { status: reply.status })
      },
    })
    Object.assign(oauth, {
      tokenUrl: `http://localhost:${server.port}/auth/oauth2/token`,
      clientId: 'test-client', clientSecret: 'test-secret', scope: 'esign',
    })
  })
  afterAll(() => { Object.assign(oauth, saved); server.stop(true) })

  test('posts a JSON body with the documented fields', async () => {
    reply = { status: 200, json: { access_token: 'tok', token_type: 'bearer', expires_in: 3600, refresh_token: 'r' } }
    expect(await AuthService.exchangeCode('code-1')).toBe('tok')
    expect(received?.contentType).toContain('application/json')
    expect(received?.body).toMatchObject({
      grant_type: 'authorization_code', code: 'code-1', client_id: 'test-client', client_secret: 'test-secret', scope: 'esign',
      redirect_uri: AuthService.redirectUri,
    })
    expect(received?.body).not.toHaveProperty('code_verifier')
  })

  test('sends the PKCE verifier only when there is one', async () => {
    await AuthService.exchangeCode('code-2', 'verifier-1')
    expect(received?.body.code_verifier).toBe('verifier-1')
  })

  test('rejects an error response without leaking the secret', async () => {
    reply = { status: 400, json: { error: 'invalid_grant' } }
    const err = await AuthService.exchangeCode('bad').catch((e) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('400')
    expect((err as Error).message).not.toContain('test-secret')
  })

  test('rejects a 200 without an access token', async () => {
    reply = { status: 200, json: { token_type: 'bearer' } }
    await expect(AuthService.exchangeCode('x')).rejects.toThrow('token exchange failed')
  })
})
