<script setup lang="ts">
import { MpAvatar, MpIcon, MpText, MpButton, css } from '@mekari/pixel3'
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const route = useRoute()

const nav = computed(() => [
  { to: '/pgp', label: 'Personal Growth Plan', icon: 'goal' as const },
  ...((auth.me?.reportCount ?? 0) > 0 ? [{ to: '/team', label: 'Tim Saya', icon: 'team' as const }] : []),
  { to: '/kanban', label: 'My Kanban', icon: 'table-view-column' as const },
  { to: '/pull-requests', label: 'Pull Requests', icon: 'file-code' as const },
  ...(auth.me?.role === 'admin' ? [{ to: '/pgp/templates', label: 'PGP Templates', icon: 'plans' as const }] : []),
  { to: '/connections', label: 'Connections', icon: 'connected_apps' as const },
])

const isActive = (to: string) =>
  to === '/pgp' ? route.path === '/pgp' || route.path.startsWith('/pgp/plans') : route.path.startsWith(to)

const shell = css({ display: 'flex', minHeight: '100vh', bg: 'background.stage' })
const sidebar = css({
  width: '240px', flexShrink: 0, bg: 'background.surface', borderRightWidth: '1px', borderColor: 'border.default',
  display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh',
})
const brand = css({ display: 'flex', alignItems: 'center', gap: '2', px: '4', py: '4', borderBottomWidth: '1px', borderColor: 'border.default' })
const logo = css({ width: '8', height: '8', rounded: 'md', bg: 'background.brand.bold', display: 'grid', placeItems: 'center' })
const navList = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '3', flex: 1 })
const navItem = css({
  display: 'flex', alignItems: 'center', gap: '3', px: '3', py: '2', rounded: 'md', color: 'text.secondary', textDecoration: 'none',
  _hover: { bg: 'background.neutral' },
})
const navActive = css({ bg: 'background.information', color: 'text.link', fontWeight: 'semiBold', _hover: { bg: 'background.information' } })
const userBox = css({ display: 'flex', alignItems: 'center', gap: '2', p: '3', borderTopWidth: '1px', borderColor: 'border.default' })
const main = css({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' })
const content = css({ p: '6', flex: 1, minWidth: 0 })
</script>

<template>
  <div :class="shell">
    <aside :class="sidebar">
      <div :class="brand">
        <div :class="logo"><MpIcon name="sign-outline" color="icon.inverse" size="sm" /></div>
        <div>
          <MpText size="label" weight="semiBold">One Desk</MpText>
          <MpText size="label-small" color="text.secondary">Mekari Sign Engineering</MpText>
        </div>
      </div>

      <nav :class="navList">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" :class="[navItem, isActive(item.to) && navActive]">
          <MpIcon :name="item.icon" size="sm" />
          <MpText size="label" color="inherit">{{ item.label }}</MpText>
        </RouterLink>
      </nav>

      <div v-if="auth.me" :class="userBox">
        <MpAvatar :name="auth.me.name" :src="auth.me.avatarUrl ?? undefined" size="sm" />
        <div :class="css({ flex: 1, minWidth: 0 })">
          <MpText size="label" weight="semiBold" is-truncated>{{ auth.me.name }}</MpText>
          <MpText size="label-small" color="text.secondary" is-truncated>{{ auth.me.email }}</MpText>
        </div>
        <MpButton v-tooltip="'Sign out'" variant="ghost" size="sm" left-icon="sign-out" aria-label="Sign out" @click="auth.logout()" />
      </div>
    </aside>

    <main :class="main">
      <div :class="content">
        <RouterView />
      </div>
    </main>
  </div>
</template>
