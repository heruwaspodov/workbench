<script setup lang="ts">
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
</script>

<template>
  <PageHeader title="Timelines" subtitle="Delivery timeline and releases for Mekari Sign initiatives." />

  <AsyncState empty empty-text="The initiatives dashboard is coming soon." />
</template>
