<script setup lang="ts">
/** Standard loading / error / empty states, incl. a "connect your account" prompt. */
import { MpBanner, MpBannerDescription, MpBannerTitle, MpButton, MpSpinner, MpText, css } from '@mekari/pixel3'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiError } from '@/lib/api'

const props = defineProps<{ loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }>()
defineEmits<{ retry: [] }>()

const needsConnection = computed(() => props.error instanceof ApiError && props.error.code === 'NOT_CONNECTED')
const notConfigured = computed(() => props.error instanceof ApiError && props.error.code.endsWith('_NOT_CONFIGURED'))
const message = computed(() => (props.error instanceof Error ? props.error.message : 'Something went wrong'))

const center = css({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3', py: '16', textAlign: 'center' })
</script>

<template>
  <div v-if="loading" :class="center"><MpSpinner /></div>
  <MpBanner v-else-if="needsConnection" variant="warning">
    <MpBannerTitle>Akun belum terhubung</MpBannerTitle>
    <MpBannerDescription>
      {{ message }}
      <RouterLink to="/connections"><MpButton size="sm" variant="secondary" :class="css({ mt: '2' })">Buka Connections</MpButton></RouterLink>
    </MpBannerDescription>
  </MpBanner>
  <MpBanner v-else-if="notConfigured" variant="info">
    <MpBannerTitle>Integrasi belum dikonfigurasi</MpBannerTitle>
    <MpBannerDescription>{{ message }}. Hubungi admin One Desk.</MpBannerDescription>
  </MpBanner>
  <MpBanner v-else-if="error" variant="danger">
    <MpBannerTitle>Gagal memuat data</MpBannerTitle>
    <MpBannerDescription>
      {{ message }}
      <MpButton size="sm" variant="secondary" :class="css({ mt: '2' })" @click="$emit('retry')">Coba lagi</MpButton>
    </MpBannerDescription>
  </MpBanner>
  <div v-else-if="empty" :class="center">
    <MpText color="text.secondary">{{ emptyText ?? 'Belum ada data' }}</MpText>
    <slot name="empty" />
  </div>
  <slot v-else />
</template>
