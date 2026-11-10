<script setup lang="ts">
import { MpText, MpTextarea, css } from '@mekari/pixel3'

const props = defineProps<{ links: string[]; readonly?: boolean }>()
const emit = defineEmits<{ update: [links: string[]] }>()

const onInput = (v: string) => emit('update', v.split(/\n+/).map((s) => s.trim()).filter(Boolean))
const isUrl = (s: string) => /^https?:\/\//i.test(s)

const compactTa = css({ '& textarea': { minHeight: '56px !important' } })
const stack = css({ display: 'flex', flexDirection: 'column', gap: '1' })
const link = css({ color: 'text.link', wordBreak: 'break-all', textDecoration: 'underline', fontSize: 'sm' })
</script>

<template>
  <div v-if="props.readonly" :class="stack">
    <template v-for="(href, i) in props.links" :key="i">
      <a v-if="isUrl(href)" :href="href" target="_blank" rel="noopener noreferrer" :class="link">{{ href }}</a>
      <MpText v-else size="label">{{ href }}</MpText>
    </template>
    <MpText v-if="!props.links.length" size="label" color="text.secondary">-</MpText>
  </div>
  <MpTextarea v-else placeholder="https://jurnal.atlassian.net/…" :class="compactTa" :rows="2" :model-value="props.links.join('\n')" @update:model-value="onInput" />
</template>
