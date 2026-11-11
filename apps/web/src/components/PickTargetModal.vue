<script setup lang="ts">
/**
 * Asks which initiative a suggestion belongs to, then either appends a link to its Evidence or fills its Current value.
 * Nothing changes until one of the buttons is pressed, and the plan still needs a normal Save afterwards.
 */
import { MpButton, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpText, css } from '@mekari/pixel3'
import { computed, ref, watch } from 'vue'
import type { EditableItem } from '@/lib/pgp'

const props = defineProps<{
  open: boolean
  heading: string
  /** Link to append to Evidence; hides the button when absent. */
  url?: string
  /** Text for Current value; hides the button when absent. */
  currentValue?: string
  items: EditableItem[]
}>()
const emit = defineEmits<{ close: []; link: [rowKey: string, url: string]; current: [rowKey: string, value: string] }>()

const chosen = ref('')
watch(() => props.open, (o) => { if (o) chosen.value = '' })

interface Group { key: string; objective: string; keyResult: string; rows: EditableItem[] }
const groups = computed(() => {
  const out: Group[] = []
  for (const it of props.items) {
    const last = out[out.length - 1]
    if (last && last.objective === it.objective && last.keyResult === it.keyResult) last.rows.push(it)
    else out.push({ key: it._key, objective: it.objective, keyResult: it.keyResult, rows: [it] })
  }
  return out
})
const row = computed(() => props.items.find((i) => i._key === chosen.value))
const hasLink = computed(() => Boolean(props.url && row.value?.evidenceLinks?.includes(props.url)))
const currentTaken = computed(() => Boolean(row.value?.currentValue?.trim()))

const group = css({ mb: '4' })
const option = css({ display: 'flex', gap: '2', alignItems: 'flex-start', py: '1', cursor: 'pointer' })
</script>

<template>
  <MpModal :is-open="open" size="lg" @close="emit('close')">
    <MpModalOverlay />
    <MpModalContent>
      <MpModalHeader>{{ heading }}<MpModalCloseButton /></MpModalHeader>
      <MpModalBody>
        <MpText v-if="!items.length" color="text.secondary">This plan has no initiatives yet. Add one first.</MpText>
        <fieldset v-else :class="css({ border: 'none', p: '0', m: '0' })">
          <legend :class="css({ mb: '3' })"><MpText size="label" color="text.secondary">Choose the initiative this belongs to</MpText></legend>
          <div v-for="g in groups" :key="g.key" :class="group">
            <MpText size="label" weight="semiBold">{{ g.objective || 'Untitled objective' }}</MpText>
            <MpText v-if="g.keyResult" size="label-small" color="text.secondary" :class="css({ mb: '1' })">{{ g.keyResult }}</MpText>
            <label v-for="r in g.rows" :key="r._key" :class="option">
              <input v-model="chosen" type="radio" name="target-initiative" :value="r._key" :class="css({ mt: '1' })" />
              <MpText size="label">{{ r.initiative || 'Untitled initiative' }}</MpText>
            </label>
          </div>
        </fieldset>
        <MpText v-if="hasLink" size="label-small" color="text.secondary">That initiative already has this link.</MpText>
        <MpText v-else-if="currentValue && currentTaken" size="label-small" color="text.secondary">Its Current value is already filled, so it will not be overwritten.</MpText>
      </MpModalBody>
      <MpModalFooter>
        <MpButton variant="ghost" @click="emit('close')">Cancel</MpButton>
        <MpButton v-if="currentValue" variant="secondary" :is-disabled="!row || currentTaken" data-test="use-current" @click="emit('current', chosen, currentValue!)">Use as current value</MpButton>
        <MpButton v-if="url" :is-disabled="!row || hasLink" data-test="add-link" @click="emit('link', chosen, url!)">Add link to evidence</MpButton>
      </MpModalFooter>
    </MpModalContent>
  </MpModal>
</template>
