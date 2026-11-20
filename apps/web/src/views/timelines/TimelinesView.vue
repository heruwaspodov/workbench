<script setup lang="ts">
import { MpButton } from '@mekari/pixel3'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
</script>

<template>
  <PageHeader title="Timelines" subtitle="Delivery timeline and releases for Mekari Sign initiatives.">
    <RouterLink v-if="auth.me?.role === 'admin'" to="/timelines/import">
      <MpButton variant="secondary" left-icon="upload">Import initiatives</MpButton>
    </RouterLink>
  </PageHeader>

  <AsyncState empty empty-text="The initiatives dashboard is coming soon." />
</template>
