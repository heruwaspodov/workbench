<script setup lang="ts">
/** What a Sync from Jira did: counts, the rows that changed (with the columns), and what could not be checked. */
import {
  MpBadge, MpButton, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpText, css,
} from '@mekari/pixel3'
import type { api } from '@/lib/api'

export type SyncResult = NonNullable<Awaited<ReturnType<typeof api.initiatives.sync.post>>['data']>

defineProps<{ result: SyncResult | null }>()
const emit = defineEmits<{ close: [] }>()

const LABEL: Record<string, string> = {
  epicStatus: 'Epic status', projectStatus: 'Project status', ownerName: 'Owner', estDeliveryDate: 'Est. delivery', actualDeliveryDate: 'Actual delivery',
  criticality: 'Criticality', progress: 'Progress', ownerEmail: 'Owner email',
}
const names = (changes: string[]) => changes.map((c) => LABEL[c] ?? c).join(', ')

const counts = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap', mb: '4' })
const list = css({ display: 'flex', flexDirection: 'column', gap: '2', maxHeight: '260px', overflowY: 'auto', mb: '4' })
const row = css({ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '3' })
const note = css({ display: 'block', mb: '2' })
</script>

<template>
  <MpModal :is-open="result != null" size="lg" @close="emit('close')">
    <MpModalOverlay />
    <MpModalContent>
      <MpModalHeader>Synced from Jira<MpModalCloseButton /></MpModalHeader>
      <MpModalBody v-if="result" data-test="sync-result">
        <div :class="counts">
          <MpBadge variant="subtle" variant-color="green" data-test="sync-updated">{{ result.updated }} updated</MpBadge>
          <MpBadge variant="subtle" variant-color="gray" data-test="sync-unchanged">{{ result.unchanged }} unchanged</MpBadge>
          <MpBadge v-if="result.missing.length" variant="subtle" variant-color="orange" data-test="sync-missing">{{ result.missing.length }} not found in Jira</MpBadge>
          <MpBadge v-if="result.skipped.length" variant="subtle" variant-color="orange" data-test="sync-skipped">{{ result.skipped.length }} progress not counted</MpBadge>
        </div>

        <template v-if="result.rows.length">
          <MpText weight="semiBold" :class="note">What changed</MpText>
          <div :class="list" data-test="sync-changes">
            <div v-for="r in result.rows" :key="r.jiraKey" :class="row">
              <MpText size="label" weight="semiBold">{{ r.jiraKey }}</MpText>
              <MpText size="label" color="text.secondary">{{ names(r.changes) }}</MpText>
            </div>
          </div>
        </template>
        <MpText v-else size="label" color="text.secondary" :class="note">Everything was already up to date.</MpText>

        <MpText v-if="result.missing.length" size="label" :class="note">
          Not found in Jira (left as they are): {{ result.missing.join(', ') }}.
        </MpText>
        <MpText v-if="result.skipped.length" size="label" :class="note">
          Too many child items to count, progress left as it was: {{ result.skipped.join(', ') }}.
        </MpText>
        <MpText size="label-small" color="text.secondary">
          Remarks, the sheet's anomalies and resolution, squad and title are not changed by a sync.
        </MpText>
      </MpModalBody>
      <MpModalFooter>
        <MpButton @click="emit('close')">Close</MpButton>
      </MpModalFooter>
    </MpModalContent>
  </MpModal>
</template>
