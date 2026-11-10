/** Tiny in-memory TTL cache — enough for a single-instance internal app. */
const store = new Map<string, { value: unknown; expires: number }>()

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as T
  const value = await load()
  store.set(key, { value, expires: Date.now() + ttlMs })
  return value
}

export const invalidate = (prefix: string) => {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}
