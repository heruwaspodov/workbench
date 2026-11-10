import { treaty } from '@elysiajs/eden'
import { toast } from '@mekari/pixel3'
import type { App } from '@one-desk/server'

/** End-to-end typed client generated from the Elysia route tree (no codegen). */
export const client = treaty<App>(window.location.origin, { fetch: { credentials: 'include' } })
export const api = client.api

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

type EdenResult<T> = { data: T; error: null } | { data: null; error: { status: unknown; value: unknown } }

/** Unwraps an Eden response, throwing an ApiError (and redirecting to /login on 401). */
export async function unwrap<T>(promise: Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  const res = await promise
  if (res.error) {
    const status = Number(res.error.status) || 0
    const v = res.error.value as { code?: string; message?: string } | string | undefined
    const message = typeof v === 'string' ? v : v?.message ?? 'Request failed'
    const code = typeof v === 'object' && v?.code ? v.code : 'ERROR'
    if (status === 401 && !location.pathname.startsWith('/login')) {
      location.href = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`
    }
    throw new ApiError(status, code, message)
  }
  return res.data as NonNullable<T>
}

export function notifyError(e: unknown) {
  const message = e instanceof Error ? e.message : 'Something went wrong'
  toast.notify({ variant: 'error', title: message, position: 'top-center' })
}

export function notifySuccess(title: string) {
  toast.notify({ variant: 'success', title, position: 'top-center' })
}
