<script setup lang="ts" generic="T extends string">
import { css } from '@mekari/pixel3'

defineProps<{ modelValue: T; options: { value: T; label: string; disabled?: boolean }[]; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const group = css({
  display: 'inline-flex', gap: '1', p: '1', rounded: 'lg', bg: 'background.stage', borderWidth: '1px', borderColor: 'border.default.subtle',
})
const item = css({
  px: '3', py: '1', rounded: 'md', fontSize: 'md', lineHeight: '1.25rem', color: 'text.secondary', cursor: 'pointer', whiteSpace: 'nowrap',
  transition: 'background .15s ease, color .15s ease', _hover: { bg: 'background.neutral.subtle.hovered', color: 'text.primary' },
  _disabled: { opacity: 0.5, cursor: 'not-allowed' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused' },
})
const active = css({ bg: 'background.information', color: 'text.link', fontWeight: 'semiBold', _hover: { bg: 'background.information', color: 'text.link' } })
</script>

<template>
  <div role="group" :aria-label="label" :class="group">
    <button v-for="o in options" :key="o.value" type="button" :disabled="o.disabled" :aria-pressed="o.value === modelValue"
      :class="[item, o.value === modelValue && active]" @click="emit('update:modelValue', o.value)">
      {{ o.label }}
    </button>
  </div>
</template>
