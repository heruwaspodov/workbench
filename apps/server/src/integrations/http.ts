import { IntegrationError } from '../shared/errors'

export const basicAuth = (user: string, secret: string) =>
  `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`

export interface HttpClientOptions {
  service: string
  /** A function lets tests (and config reloads) change the target after the client is created. */
  baseUrl: string | (() => string)
  authorization: () => string
}

/** Minimal JSON client with consistent error mapping (secrets never logged). */
export function createHttpClient({ service, baseUrl, authorization }: HttpClientOptions) {
  return async function request<T>(path: string, init: RequestInit & { query?: Record<string, string | number | string[] | undefined> } = {}): Promise<T> {
    const auth = authorization() // throws a 503 AppError when the integration isn't configured
    const base = typeof baseUrl === 'function' ? baseUrl() : baseUrl
    const url = new URL(path.startsWith('http') ? path : `${base}${path}`)
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v === undefined) continue
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item))
    }
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          authorization: auth,
          ...init.headers,
        },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (e) {
      throw new IntegrationError(service, 0, (e as Error).message)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new IntegrationError(service, res.status, text.slice(0, 300) || res.statusText)
    }
    if (res.status === 204) return undefined as T
    const type = res.headers.get('content-type') ?? ''
    return (type.includes('json') ? await res.json() : await res.text()) as T
  }
}
