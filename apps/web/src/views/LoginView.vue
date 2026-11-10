<script setup lang="ts">
import { MpBanner, MpBannerDescription, MpButton, MpIcon, MpText, css } from '@mekari/pixel3'
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, unwrap } from '@/lib/api'

const route = useRoute()
const config = ref<{ oauthConfigured: boolean; devLogin: boolean } | null>(null)
const error = typeof route.query.error === 'string' ? route.query.error : null
const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'

onMounted(async () => { config.value = await unwrap(api.auth.config.get()).catch(() => null) })

const loginUrl = `/auth/login?redirect=${encodeURIComponent(redirect)}`

const page = css({ minHeight: '100vh', display: 'grid', placeItems: 'center', bg: 'background.stage', p: '4' })
const card = css({ width: '100%', maxWidth: '400px', bg: 'background.surface', rounded: 'lg', shadow: 'md', p: '8', display: 'flex', flexDirection: 'column', gap: '5' })
const logo = css({ width: '12', height: '12', rounded: 'lg', bg: 'background.brand.bold', display: 'grid', placeItems: 'center' })
const features = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const feature = css({ display: 'flex', gap: '2', alignItems: 'center' })
</script>

<template>
  <div :class="page">
    <div :class="card">
      <div :class="logo"><MpIcon name="sign-outline" color="icon.inverse" /></div>
      <div>
        <MpText size="h2" weight="semiBold">One Desk</MpText>
        <MpText color="text.secondary">PGP, kanban, dan pull request Mekari Sign dalam satu tab.</MpText>
      </div>

      <div :class="features">
        <div :class="feature"><MpIcon name="goal" size="sm" /><MpText size="label">Isi & pantau Personal Growth Plan</MpText></div>
        <div :class="feature"><MpIcon name="table-view-column" size="sm" /><MpText size="label">Kanban Jira milik kamu</MpText></div>
        <div :class="feature"><MpIcon name="file-code" size="sm" /><MpText size="label">Pull request Bitbucket lintas repo</MpText></div>
      </div>

      <MpBanner v-if="error" variant="danger" is-inline>
        <MpBannerDescription>{{ error }}</MpBannerDescription>
      </MpBanner>

      <a :href="loginUrl">
        <MpButton is-full-width :is-disabled="config ? !config.oauthConfigured : false">Masuk dengan Mekari Account</MpButton>
      </a>
      <MpText v-if="config && !config.oauthConfigured" size="label-small" color="text.secondary">
        Mekari OAuth2 belum dikonfigurasi di server (lihat .env).
      </MpText>
      <a v-if="config?.devLogin" href="/auth/dev-login">
        <MpButton is-full-width variant="ghost">Dev login (local only)</MpButton>
      </a>
    </div>
  </div>
</template>
