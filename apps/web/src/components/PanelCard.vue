<script setup lang="ts">
/**
 * One collapsible card of the suggestions panel: a header button (title, one-line subtitle, count, chevron)
 * over a body. The open/closed choice is remembered in this browser per card id.
 */
import { MpBadge, MpText, css } from '@mekari/pixel3'
import { onMounted, ref } from 'vue'
import { ui } from '@/lib/ui'

const props = defineProps<{ id: string; title: string; subtitle?: string; count?: number | string | null; defaultOpen?: boolean }>()

const emit = defineEmits<{ toggle: [open: boolean] }>()

const KEY = `workbench:panel:${props.id}`
const read = () => {
  try {
    const v = localStorage.getItem(KEY)
    if (v === '1' || v === '0') return v === '1'
  } catch { /* remembering is a convenience only */ }
  return Boolean(props.defaultOpen)
}
const open = ref(read())
function toggle() {
  open.value = !open.value
  try { localStorage.setItem(KEY, open.value ? '1' : '0') } catch { /* ignore */ }
  emit('toggle', open.value)
}
onMounted(() => emit('toggle', open.value))

const card = `${ui.card} ${css({ p: '0', overflow: 'hidden', flexShrink: 0 })}`
const head = css({
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', columnGap: '3', width: '100%', textAlign: 'left',
  px: '4', py: '3', cursor: 'pointer', _hover: { bg: 'background.neutral.subtle.hovered' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused', outlineOffset: '-2px' },
})
const chevron = css({
  width: '8px', height: '8px', borderRightWidth: '2px', borderBottomWidth: '2px', borderColor: 'text.secondary', transform: 'rotate(45deg)',
  transition: 'transform .15s ease', mb: '2px',
})
const body = css({ display: 'flex', flexDirection: 'column', gap: '3', px: '4', pb: '4', pt: '3', borderTopWidth: '1px', borderColor: 'border.default.subtle' })
</script>

<template>
  <section :class="card" :data-test="id">
    <button type="button" :class="head" :aria-expanded="open" :aria-controls="`${id}-body`" @click="toggle">
      <span :class="css({ display: 'flex', flexDirection: 'column', minWidth: 0 })">
        <MpText weight="semiBold">{{ title }}</MpText>
        <MpText v-if="subtitle" size="label-small" color="text.secondary" :class="css({ truncate: true })">{{ subtitle }}</MpText>
      </span>
      <MpBadge v-if="count !== undefined && count !== null" size="sm" variant="subtle" variant-color="gray">{{ count }}</MpBadge>
      <span :class="chevron" :style="{ transform: open ? 'rotate(-135deg)' : 'rotate(45deg)' }" aria-hidden="true" />
    </button>
    <div v-show="open" :id="`${id}-body`" :class="body"><slot /></div>
  </section>
</template>
