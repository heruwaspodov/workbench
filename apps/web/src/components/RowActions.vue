<script setup lang="ts">
import { MpButton, css } from '@mekari/pixel3'

defineProps<{ index: number; count: number }>()
defineEmits<{ move: [index: number, dir: -1 | 1]; remove: [index: number] }>()

const actions = css({ display: 'flex', gap: '0.5', justifyContent: 'flex-end' })
</script>

<template>
  <div :class="actions">
    <MpButton title="Move up" size="sm" variant="ghost" left-icon="arrows-up" aria-label="Move up" :is-disabled="index === 0" @click="$emit('move', index, -1)" />
    <MpButton title="Move down" size="sm" variant="ghost" left-icon="arrows-down" aria-label="Move down" :is-disabled="index === count - 1" @click="$emit('move', index, 1)" />
    <MpButton title="Delete" size="sm" variant="ghost" left-icon="delete" aria-label="Delete" @click="$emit('remove', index)" />
  </div>
</template>
