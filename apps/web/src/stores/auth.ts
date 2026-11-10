import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, unwrap } from '@/lib/api'

export type Me = Awaited<ReturnType<typeof fetchMe>>
const fetchMe = () => unwrap(api.auth.me.get())

export const useAuth = defineStore('auth', () => {
  const me = ref<Me | null>(null)
  const loaded = ref(false)

  async function load() {
    try { me.value = await fetchMe() } catch { me.value = null }
    loaded.value = true
    return me.value
  }

  async function logout() {
    await api.auth.logout.post()
    me.value = null
    location.href = '/login'
  }

  return { me, loaded, load, logout }
})
