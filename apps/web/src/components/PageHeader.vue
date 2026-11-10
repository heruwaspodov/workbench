<script setup lang="ts">
import { MpText, css } from '@mekari/pixel3'

defineProps<{ title: string; subtitle?: string }>()

const wrap = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '6', flexWrap: 'wrap' })
const titles = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0 })
const sub = css({ maxWidth: '640px' })
const actions = css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })
</script>

<template>
  <header :class="wrap">
    <div :class="titles">
      <slot name="before-title" />
      <MpText as="h1" size="h2" weight="semiBold">{{ title }}</MpText>
      <MpText v-if="subtitle" size="body" color="text.secondary" :class="sub">{{ subtitle }}</MpText>
    </div>
    <div :class="actions"><slot /></div>
  </header>
</template>
