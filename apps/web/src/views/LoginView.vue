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

const page = css({ minHeight: '100vh', display: 'grid', placeItems: 'center', bg: 'background.surface', p: '4' })
const card = css({ width: '100%', maxWidth: '400px', bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', shadow: 'md', p: '8', display: 'flex', flexDirection: 'column', gap: '5' })
const logo = css({ width: '12', height: '12', rounded: 'lg', bg: 'background.brand.bold', display: 'grid', placeItems: 'center' })
const whiteIcon = css({ filter: 'brightness(0) invert(1)' })
const features = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const feature = css({ display: 'flex', gap: '2', alignItems: 'center' })
</script>

<template>
  <div :class="page">
    <div :class="card">
      <div :class="logo"><MpIcon name="sign-outline" :class="whiteIcon" /></div>
      <div>
        <MpText size="h2" weight="semiBold">One Desk</MpText>
        <MpText color="text.secondary">PGP, Kanban and pull requests for Mekari Sign, in one tab.</MpText>
      </div>

      <div :class="features">
        <div :class="feature"><MpIcon name="goal" size="sm" /><MpText size="label">Fill in and track your Personal Growth Plan</MpText></div>
        <div :class="feature"><MpIcon name="table-view-column" size="sm" /><MpText size="label">Your Jira Kanban board</MpText></div>
        <div :class="feature"><MpIcon name="file-code" size="sm" /><MpText size="label">Bitbucket pull requests across repositories</MpText></div>
      </div>

      <MpBanner v-if="error" variant="danger" is-inline>
        <MpBannerDescription>{{ error }}</MpBannerDescription>
      </MpBanner>

      <a :href="loginUrl">
        <MpButton is-full-width :is-disabled="config ? !config.oauthConfigured : false">Sign in with Mekari Account</MpButton>
      </a>
      <MpText v-if="config && !config.oauthConfigured" size="label-small" color="text.secondary">
        Mekari OAuth2 is not configured on the server (see .env).
      </MpText>
      <a v-if="config?.devLogin" href="/auth/dev-login">
        <MpButton is-full-width variant="ghost">Dev login (local only)</MpButton>
      </a>
    </div>
  </div>
</template>
