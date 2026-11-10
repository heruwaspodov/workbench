<script setup lang="ts">
import { MpAvatar, MpButton, MpInput, MpText, css } from '@mekari/pixel3'
import { ref } from 'vue'
import { api, notifyError, unwrap } from '@/lib/api'

defineProps<{ placeholder: string; actionLabel: string; busyId?: string | null }>()
const emit = defineEmits<{ pick: [userId: string] }>()

const query = ref('')
const searched = ref(false)
const results = ref<{ id: string; name: string; email: string; avatarUrl: string | null }[]>([])

async function search() {
  try {
    results.value = await unwrap(api.org.users.get({ query: { q: query.value } }))
    searched.value = true
  } catch (e) { notifyError(e) }
}

const row = css({ display: 'flex', alignItems: 'center', gap: '3' })
const list = css({ display: 'flex', flexDirection: 'column', gap: '1', maxHeight: '220px', overflowY: 'auto' })
const item = css({ display: 'flex', alignItems: 'center', gap: '3', p: '2', rounded: 'md', _hover: { bg: 'background.neutral' } })
</script>

<template>
  <div :class="css({ display: 'flex', flexDirection: 'column', gap: '2' })">
    <div :class="row">
      <MpInput v-model="query" :placeholder="placeholder" @keyup.enter="search" />
      <MpButton variant="secondary" @click="search">Cari</MpButton>
    </div>
    <MpText v-if="searched && !results.length" size="label-small" color="text.secondary">Tidak ada user yang cocok. Hanya user yang sudah pernah login yang bisa dicari.</MpText>
    <div v-if="results.length" :class="list">
      <div v-for="u in results" :key="u.id" :class="item">
        <MpAvatar :name="u.name" :src="u.avatarUrl ?? undefined" size="sm" />
        <div :class="css({ flex: 1 })">
          <MpText>{{ u.name }}</MpText>
          <MpText size="label-small" color="text.secondary">{{ u.email }}</MpText>
        </div>
        <MpButton size="sm" variant="secondary" :is-loading="busyId === u.id" @click="emit('pick', u.id)">{{ actionLabel }}</MpButton>
      </div>
    </div>
  </div>
</template>
