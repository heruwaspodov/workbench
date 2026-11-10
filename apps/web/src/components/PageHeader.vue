<script setup lang="ts">
import { MpText, css } from '@mekari/pixel3'

defineProps<{ title: string; subtitle?: string }>()

const wrap = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '5', flexWrap: 'wrap' })
const actions = css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })
</script>

<template>
  <header :class="wrap">
    <div>
      <slot name="before-title" />
      <MpText as="h1" size="h2" weight="semiBold">{{ title }}</MpText>
      <MpText v-if="subtitle" size="body" color="text.secondary">{{ subtitle }}</MpText>
    </div>
    <div :class="actions"><slot /></div>
  </header>
</template>
