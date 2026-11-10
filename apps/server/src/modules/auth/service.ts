import { and, count, eq, gt, lt } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { sessions, users, type User } from '../../db/schema'
import { AppError, ForbiddenError } from '../../shared/errors'
import type { OAuthProfile } from './model'

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url')
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
const sha256 = async (value: string) =>
  b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

/** Pick the first non-empty string at any of the given dotted paths. */
const pick = (obj: unknown, paths: string[]): string | undefined => {
  for (const p of paths) {
    const v = p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

export abstract class AuthService {
  static get oauthConfigured() {
    const o = env.oauth
    return Boolean(o.authorizeUrl && o.tokenUrl && o.userinfoUrl && o.clientId && o.clientSecret)
  }

  static get redirectUri() {
    return env.oauth.redirectUri
  }

  static async buildAuthorizeUrl() {
    if (!this.oauthConfigured) throw new AppError(503, 'Mekari OAuth2 is not configured on the server', 'OAUTH_NOT_CONFIGURED')
    const state = randomToken(16)
    const url = new URL(env.oauth.authorizeUrl!)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', env.oauth.clientId!)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('scope', env.oauth.scope)
    url.searchParams.set('state', state)
    let verifier: string | undefined
    if (env.oauth.usePkce) {
      verifier = randomToken(48)
      url.searchParams.set('code_challenge', await sha256(verifier))
      url.searchParams.set('code_challenge_method', 'S256')
    }
    return { url: url.toString(), state, verifier }
  }

  static async exchangeCode(code: string, verifier?: string): Promise<string> {
    // Mekari Account takes a JSON body (not form-urlencoded) with the client secret inside it.
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: env.oauth.clientId!,
      client_secret: env.oauth.clientSecret!,
      scope: env.oauth.scope,
    }
    if (verifier) body.code_verifier = verifier
    const res = await fetch(env.oauth.tokenUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const token = pick(json, ['access_token', 'data.access_token'])
    if (!res.ok || !token) throw new AppError(401, `OAuth token exchange failed (${res.status})`, 'OAUTH_FAILED')
    return token
  }

  /** ASSUMPTION: userinfo shape is OIDC-like; we also accept a `{ data: {...} }` envelope. */
  static async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const res = await fetch(env.oauth.userinfoUrl!, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })
    if (!res.ok) throw new AppError(401, `OAuth userinfo failed (${res.status})`, 'OAUTH_FAILED')
    const json = await res.json()
    const email = pick(json, ['email', 'data.email', 'data.attributes.email'])
    if (!email) throw new AppError(401, 'OAuth profile has no email', 'OAUTH_FAILED')
    return {
      subject: pick(json, ['sub', 'id', 'data.sub', 'data.id']) ?? email,
      email: email.toLowerCase(),
      name: pick(json, ['name', 'full_name', 'data.name', 'data.full_name', 'data.attributes.name']) ?? email.split('@')[0]!,
      avatarUrl: pick(json, ['picture', 'avatar', 'data.picture', 'data.avatar']),
    }
  }

  static async upsertUser(profile: OAuthProfile): Promise<User> {
    const domain = profile.email.split('@')[1] ?? ''
    if (env.allowedDomains.length && !env.allowedDomains.includes(domain)) {
      throw new ForbiddenError(`Email domain "${domain}" is not allowed`)
    }
    const isAdmin = env.adminEmails.includes(profile.email)
    const [user] = await db
      .insert(users)
      .values({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        oauthSubject: profile.subject,
        role: isAdmin ? 'admin' : 'member',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          oauthSubject: profile.subject,
          lastLoginAt: new Date(),
          ...(isAdmin ? { role: 'admin' as const } : {}),
        },
      })
      .returning()
    return user!
  }

  static async createSession(userId: string) {
    const token = randomToken()
    const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86_400_000)
    await db.insert(sessions).values({ id: await sha256(token), userId, expiresAt })
    // opportunistic cleanup of expired sessions
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
    return { token, expiresAt }
  }

  static async reportCount(userId: string) {
    const [row] = await db.select({ n: count() }).from(users).where(eq(users.managerId, userId))
    return row?.n ?? 0
  }

  static async userFromSession(token: unknown): Promise<User | null> {
    if (typeof token !== 'string' || !token) return null
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, await sha256(token)), gt(sessions.expiresAt, new Date())))
      .limit(1)
    return row?.user ?? null
  }

  static async destroySession(token: unknown) {
    if (typeof token !== 'string' || !token) return
    await db.delete(sessions).where(eq(sessions.id, await sha256(token)))
  }

  /** Only same-origin relative paths are allowed as post-login redirects. */
  static safeRedirect(path: unknown) {
    return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/'
  }
}
