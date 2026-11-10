import { Elysia } from 'elysia'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const originOf = (value: string | null) => {
  if (!value) return null
  try { return new URL(value).origin } catch { return null }
}

/**
 * CSRF defence for the cookie session: state-changing /api requests must come from APP_URL.
 * The browser always sends Origin on cross-site POST/PUT/PATCH/DELETE; Referer is the fallback.
 * A request with neither header is rejected (fail closed).
 */
export const originGuard = (appUrl: string) => {
  const allowed = new URL(appUrl).origin
  return new Elysia({ name: 'shared.origin-guard' }).onRequest(({ request, set }) => {
    if (SAFE_METHODS.has(request.method)) return
    if (!new URL(request.url).pathname.startsWith('/api/')) return
    const origin = originOf(request.headers.get('origin')) ?? originOf(request.headers.get('referer'))
    if (origin === allowed) return
    set.status = 403
    return { code: 'FORBIDDEN', message: 'Cross-origin request blocked' }
  })
}
