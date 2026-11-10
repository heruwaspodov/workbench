import { Elysia } from 'elysia'
import { env } from '../../config/env'
import { authPlugin } from '../../shared/auth.plugin'
import { AppError } from '../../shared/errors'
import {
  AuthModel, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, SESSION_COOKIE,
} from './model'
import { AuthService } from './service'

/** The callback lives at the path of the redirect URI registered in Mekari SSO (default /sso-callback). */
const callbackPath = new URL(env.oauth.redirectUri).pathname

const shortCookie = { httpOnly: true, sameSite: 'lax' as const, secure: env.isProd, path: '/', maxAge: 600 }

/** Browser-facing OAuth2 routes (/auth/*) + session API (/api/auth/*). */
export const authModule = new Elysia({ name: 'module.auth' })
  .use(authPlugin)
  .get(callbackPath, async ({ cookie, query, redirect }) => {
    const expected = cookie[OAUTH_STATE_COOKIE]?.value
    const verifier = cookie[OAUTH_VERIFIER_COOKIE]?.value
    const back = AuthService.safeRedirect(cookie[OAUTH_REDIRECT_COOKIE]?.value)
    for (const c of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_REDIRECT_COOKIE]) cookie[c]?.remove()

    if (query.error) return redirect(`/login?error=${encodeURIComponent(query.error_description ?? query.error)}`)
    if (!query.code || !query.state || query.state !== expected) {
      return redirect('/login?error=invalid_state')
    }
    try {
      const accessToken = await AuthService.exchangeCode(query.code, typeof verifier === 'string' ? verifier : undefined)
      const profile = await AuthService.fetchProfile(accessToken)
      const user = await AuthService.upsertUser(profile)
      const session = await AuthService.createSession(user.id)
      cookie[SESSION_COOKIE]!.set({
        value: session.token, httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', expires: session.expiresAt,
      })
      return redirect(back)
    } catch (e) {
      const msg = e instanceof AppError ? e.message : 'login_failed'
      return redirect(`/login?error=${encodeURIComponent(msg)}`)
    }
  }, { query: AuthModel.callbackQuery })
  .group('/auth', (app) =>
    app
      .get('/login', async ({ cookie, query, redirect }) => {
        const { url, state, verifier } = await AuthService.buildAuthorizeUrl()
        cookie[OAUTH_STATE_COOKIE]!.set({ value: state, ...shortCookie })
        if (verifier) cookie[OAUTH_VERIFIER_COOKIE]!.set({ value: verifier, ...shortCookie })
        cookie[OAUTH_REDIRECT_COOKIE]!.set({ value: AuthService.safeRedirect(query.redirect), ...shortCookie })
        return redirect(url)
      }, { query: AuthModel.loginQuery })
      .get('/dev-login', async ({ cookie, redirect }) => {
        if (env.isProd || !env.devLoginEmail) throw new AppError(404, 'Not found', 'NOT_FOUND')
        const user = await AuthService.upsertUser({ subject: 'dev', email: env.devLoginEmail.toLowerCase(), name: env.devLoginEmail.split('@')[0]! })
        const session = await AuthService.createSession(user.id)
        cookie[SESSION_COOKIE]!.set({ value: session.token, httpOnly: true, sameSite: 'lax', path: '/', expires: session.expiresAt })
        return redirect('/')
      }),
  )
  .group('/api/auth', (app) =>
    app
      .get('/config', () => ({
        oauthConfigured: AuthService.oauthConfigured,
        devLogin: !env.isProd && Boolean(env.devLoginEmail),
      }))
      .get('/me', async ({ user }) => ({
        id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role,
        reportCount: await AuthService.reportCount(user.id),
      }), { auth: true })
      .post('/logout', async ({ cookie }) => {
        await AuthService.destroySession(cookie[SESSION_COOKIE]?.value)
        cookie[SESSION_COOKIE]?.remove()
        return { ok: true }
      }),
  )
