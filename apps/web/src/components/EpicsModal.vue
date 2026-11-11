<script setup lang="ts">
/** Confirm which of the user's Jira epics become new initiatives, and under which objective and key result. */
import { MpBadge, MpButton, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpSelect, MpText, css } from '@mekari/pixel3'
import { computed, ref, watch } from 'vue'
import type { EditableItem } from '@/lib/pgp'

export interface EpicSuggestion { key: string; summary: string; status: string; statusCategory: string; url: string }

const props = defineProps<{ open: boolean; epics: EpicSuggestion[]; items: EditableItem[] }>()
const emit = defineEmits<{ close: []; add: [groupKey: string | null, epics: EpicSuggestion[]] }>()

/** An epic is already in the plan when any initiative has its URL in Evidence. */
const present = computed(() => new Set(props.items.flatMap((i) => i.evidenceLinks ?? [])))
const fresh = computed(() => props.epics.filter((e) => !present.value.has(e.url)))
const picked = ref<string[]>([])
const groupKey = ref('')

const groups = computed(() => {
  const out: { key: string; label: string }[] = []
  let prev = ''
  for (const it of props.items) {
    const id = `${it.objective}\u0000${it.keyResult}`
    if (id !== prev) out.push({ key: it._key, label: `${it.objective || 'Untitled objective'}${it.keyResult ? ` / ${it.keyResult}` : ''}`.slice(0, 120) })
    prev = id
  }
  return out
})
watch(() => props.open, (o) => {
  if (!o) return
  picked.value = fresh.value.map((e) => e.key)
  groupKey.value = groups.value[groups.value.length - 1]?.key ?? ''
})
const chosen = computed(() => fresh.value.filter((e) => picked.value.includes(e.key)))
const option = css({ display: 'flex', gap: '2', alignItems: 'flex-start', py: '1', cursor: 'pointer' })
</script>

<template>
  <MpModal :is-open="open" size="lg" @close="emit('close')">
    <MpModalOverlay />
    <MpModalContent>
      <MpModalHeader>Add initiatives from my Jira epics<MpModalCloseButton /></MpModalHeader>
      <MpModalBody>
        <MpText v-if="!fresh.length" color="text.secondary">Every suggested epic is already linked in this plan.</MpText>
        <template v-else>
          <label :class="css({ display: 'block', mb: '4' })">
            <MpText size="label" color="text.secondary">Add under</MpText>
            <MpSelect v-if="groups.length" v-model="groupKey">
              <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }}</option>
            </MpSelect>
            <MpText v-else size="label">A new objective "Delivery" will be created.</MpText>
          </label>
          <label v-for="e in fresh" :key="e.key" :class="option">
            <input v-model="picked" type="checkbox" :value="e.key" :class="css({ mt: '1' })" />
            <span :class="css({ minWidth: 0 })">
              <MpText size="label">{{ e.summary }}</MpText>
              <span :class="css({ display: 'flex', gap: '2', alignItems: 'center' })">
                <MpText size="label-small" color="text.secondary">{{ e.key }}</MpText>
                <MpBadge size="sm" variant="subtle" :variant-color="e.statusCategory === 'done' ? 'green' : e.statusCategory === 'indeterminate' ? 'blue' : 'gray'">{{ e.status }}</MpBadge>
              </span>
            </span>
          </label>
          <MpText size="label-small" color="text.secondary" :class="css({ mt: '3' })">New initiatives start at weight 0%. Set the weights, then Save.</MpText>
        </template>
      </MpModalBody>
      <MpModalFooter>
        <MpButton variant="ghost" @click="emit('close')">Cancel</MpButton>
        <MpButton :is-disabled="!chosen.length" data-test="confirm-epics" @click="emit('add', groupKey || null, chosen)">
          Add {{ chosen.length }} {{ chosen.length === 1 ? 'initiative' : 'initiatives' }}
        </MpButton>
      </MpModalFooter>
    </MpModalContent>
  </MpModal>
</template>
