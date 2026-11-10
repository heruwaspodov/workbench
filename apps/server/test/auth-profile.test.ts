import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { setupTestDb } from './db'

// Synthetic payloads only. The first mirrors the Mekari SSO `GET /v1/users/me` response shape.
describe('OAuth userinfo mapping', () => {
  let AuthService: typeof import('../src/modules/auth/service').AuthService
  let oauth: Record<string, unknown>
  let saved: Record<string, unknown>
  let server: ReturnType<typeof Bun.serve>
  let seenAuth: string | null = null
  let reply: { status: number; json: unknown } = { status: 200, json: {} }

  beforeAll(async () => {
    await setupTestDb()
    AuthService = (await import('../src/modules/auth/service')).AuthService
    oauth = (await import('../src/config/env')).env.oauth as unknown as Record<string, unknown>
    saved = { ...oauth }
    server = Bun.serve({
      port: 0,
      fetch(req) {
        seenAuth = req.headers.get('authorization')
        return Response.json(reply.json, { status: reply.status })
      },
    })
    Object.assign(oauth, { userinfoUrl: `http://localhost:${server.port}/v1/users/me` })
  })
  afterAll(() => { Object.assign(oauth, saved); server.stop(true) })

  test('maps the Mekari SSO users/me shape and sends the bearer token', async () => {
    reply = {
      status: 200,
      json: {
        data: {
          id: 'sso-1', type: 'user',
          attributes: {
            sso_id: 'sso-1', email: 'Jane.Doe@Example.test', first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe',
            avatar: 'https://example.test/avatar.png',
          },
        },
      },
    }
    expect(await AuthService.fetchProfile('token-1')).toEqual({
      subject: 'sso-1', email: 'jane.doe@example.test', name: 'Jane Doe', avatarUrl: 'https://example.test/avatar.png',
    })
    expect(seenAuth).toBe('Bearer token-1')
  })

  test('builds the name from first and last name when full_name is absent', async () => {
    reply = { status: 200, json: { data: { id: 'x', attributes: { email: 'a@example.test', first_name: 'Ana', last_name: 'Lee' } } } }
    expect((await AuthService.fetchProfile('t')).name).toBe('Ana Lee')
  })

  test('still accepts a flat OIDC-style profile', async () => {
    reply = { status: 200, json: { sub: 'abc', email: 'b@example.test', name: 'Bob', picture: 'https://example.test/p.png' } }
    expect(await AuthService.fetchProfile('t')).toMatchObject({ subject: 'abc', email: 'b@example.test', name: 'Bob' })
  })

  test('falls back to the email name part when no name is present', async () => {
    reply = { status: 200, json: { data: { id: 'y', attributes: { email: 'carol@example.test' } } } }
    expect((await AuthService.fetchProfile('t')).name).toBe('carol')
  })

  test('a profile without email lists field names only, never values', async () => {
    reply = { status: 200, json: { data: { id: 'z', attributes: { phone: '0800000', full_name: 'No Email' } } } }
    const err = (await AuthService.fetchProfile('t').catch((e) => e)) as Error
    expect(err.message).toContain('no email')
    expect(err.message).toContain('phone')
    expect(err.message).not.toContain('0800000')
    expect(err.message).not.toContain('No Email')
  })

  test('a failing userinfo call is reported with its status', async () => {
    reply = { status: 401, json: { error: 'invalid_token' } }
    await expect(AuthService.fetchProfile('bad')).rejects.toThrow('userinfo failed (401)')
  })
})
