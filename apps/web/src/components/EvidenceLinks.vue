<script setup lang="ts">
/**
 * Evidence links of one initiative: one input per link, a "+ Add link" button, open and remove buttons per row.
 * The model stays a plain string[]: empty rows live only in this component and are never emitted; duplicates are dropped.
 */
import { MpButton, MpText, css } from '@mekari/pixel3'
import { nextTick, ref, watch } from 'vue'
import EvidenceRow from './EvidenceRow.vue'

const props = defineProps<{ links: string[]; readonly?: boolean }>()
const emit = defineEmits<{ update: [links: string[]] }>()

interface Row { id: number; value: string }
let seq = 0
const toRows = (links: string[]): Row[] => links.map((value) => ({ id: seq++, value }))
const clean = (rows: Row[]) => [...new Set(rows.map((r) => r.value.trim()).filter(Boolean))]
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

const rows = ref<Row[]>(toRows(props.links))
// Rebuild only when the list changed from outside (a suggestion was added, the plan was saved); our own edits already match.
watch(() => props.links, (links) => { if (!same(clean(rows.value), links)) rows.value = toRows(links) })

const root = ref<HTMLElement | null>(null)
const push = () => emit('update', clean(rows.value))
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim())

async function focusRow(id: number) {
  await nextTick()
  root.value?.querySelector<HTMLInputElement>(`[data-evrow="${id}"] input`)?.focus()
}
function addAfter(index: number) {
  const row = { id: seq++, value: '' }
  rows.value.splice(index + 1, 0, row)
  focusRow(row.id)
}
function remove(index: number) {
  rows.value.splice(index, 1)
  push()
}
function setValue(index: number, value: string) {
  rows.value[index]!.value = value
  push()
}
/** Several URLs pasted at once become several rows. */
function onPaste(e: ClipboardEvent, index: number) {
  const parts = (e.clipboardData?.getData('text') ?? '').split(/\s+/).filter(Boolean)
  if (parts.length < 2) return
  e.preventDefault()
  rows.value[index]!.value = parts[0]!
  rows.value.splice(index + 1, 0, ...toRows(parts.slice(1)))
  push()
}

const stack = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const link = css({ color: 'text.link', textDecoration: 'underline', fontSize: 'sm', display: 'block', truncate: true })
</script>

<template>
  <div v-if="props.readonly" :class="stack">
    <template v-for="(href, i) in props.links" :key="i">
      <a v-if="isUrl(href)" :href="href" target="_blank" rel="noopener noreferrer" :title="href" :class="link">{{ href }}</a>
      <MpText v-else size="label" :title="href" :class="css({ truncate: true })">{{ href }}</MpText>
    </template>
    <MpText v-if="!props.links.length" size="label" color="text.secondary">-</MpText>
  </div>

  <div v-else ref="root" :class="stack" data-test="evidence">
    <div v-for="(r, i) in rows" :key="r.id" :data-evrow="r.id" @keydown.enter.prevent="addAfter(i)" @paste="onPaste($event, i)">
      <EvidenceRow :value="r.value" :position="i + 1" @change="(v: string) => setValue(i, v)" @remove="remove(i)" />
    </div>
    <div>
      <MpButton size="sm" variant="ghost" left-icon="add" data-test="evidence-add" @click="addAfter(rows.length - 1)">Add link</MpButton>
    </div>
  </div>
</template>
