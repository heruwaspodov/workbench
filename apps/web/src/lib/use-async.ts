import { ref, shallowRef } from 'vue'

/** Small helper for load-on-demand data with loading / error state. */
export function useAsync<T, A extends unknown[]>(fn: (...args: A) => Promise<T>) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)
  let seq = 0

  async function run(...args: A) {
    const id = ++seq
    loading.value = true
    error.value = null
    try {
      const result = await fn(...args)
      if (id === seq) data.value = result
      return result
    } catch (e) {
      if (id === seq) error.value = e
    } finally {
      if (id === seq) loading.value = false
    }
  }
  return { data, loading, error, run }
}
