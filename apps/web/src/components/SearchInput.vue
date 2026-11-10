<script setup lang="ts">
import { MpIcon, MpInput, css } from '@mekari/pixel3'

defineProps<{ placeholder?: string }>()
const model = defineModel<string>({ default: '' })
const emit = defineEmits<{ enter: [] }>()

// Pixel inputs have no inner icon slot, so the icon sits over the input and the text is padded to clear it.
const root = css({ position: 'relative', width: '100%', '& input': { paddingLeft: '2.5rem' } })
const icon = css({ position: 'absolute', left: '3', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 1 })
</script>

<template>
  <div :class="root">
    <MpIcon name="search" size="sm" :class="icon" />
    <MpInput v-model="model" :placeholder="placeholder" is-clearable @keyup.enter="emit('enter')" />
  </div>
</template>
