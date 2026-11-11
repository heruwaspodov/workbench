<script setup lang="ts">
/** One evidence link: input, open button (http/https only) and remove button. Kept apart so EvidenceLinks stays simple. */
import { MpButton, MpInput, MpText, css } from '@mekari/pixel3'
import { computed } from 'vue'

const props = defineProps<{ value: string; position: number }>()
const emit = defineEmits<{ change: [value: string]; remove: [] }>()

const url = computed(() => (/^https?:\/\//i.test(props.value.trim()) ? props.value.trim() : ''))
const notUrl = computed(() => Boolean(props.value.trim()) && !url.value)

const line = css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', columnGap: '1', alignItems: 'center' })
const openSlot = css({ display: 'inline-flex', minWidth: '8' })
const hint = css({ gridColumn: '1 / -1' })
</script>

<template>
  <div :class="line">
    <MpInput size="sm" :model-value="value" placeholder="https://jurnal.atlassian.net/…" :title="value" :aria-label="`Evidence link ${position}`"
      @update:model-value="(v: string) => emit('change', v)" />
    <span :class="openSlot">
      <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" aria-label="Open link" title="Open link">
        <MpButton size="sm" variant="ghost" left-icon="newtab" tabindex="-1" />
      </a>
    </span>
    <MpButton size="sm" variant="ghost" left-icon="delete" :aria-label="`Remove evidence link ${position}`" title="Remove" data-test="evidence-remove" @click="emit('remove')" />
    <MpText v-if="notUrl" size="label-small" color="text.secondary" :class="hint">Links should start with http:// or https://</MpText>
  </div>
</template>
