<script setup lang="ts">
/** Read-only detail of one initiative, for everyone. Admins get an Edit button that opens the form. */
import {
  MpBadge, MpButton, MpDrawer, MpDrawerBody, MpDrawerCloseButton, MpDrawerContent, MpDrawerFooter, MpDrawerHeader, MpDrawerOverlay, MpText, css,
} from '@mekari/pixel3'
import { isHttpUrl } from '@/lib/clipboard'
import { formatDate, isoDay } from '@/lib/format'
import { type Initiative, STATUS_COLOR, progressText, resolutionColor, statusText } from './types'

defineProps<{ row: Initiative | null; canEdit: boolean }>()
const emit = defineEmits<{ close: []; edit: [row: Initiative] }>()

const meta = css({ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', rowGap: '2', columnGap: '3', mb: '5' })
const block = css({ mb: '5' })
const pre = css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const badges = css({ display: 'flex', gap: '2', flexWrap: 'wrap', mb: '4', alignItems: 'center' })
const list = css({ listStyle: 'disc', pl: '5', display: 'flex', flexDirection: 'column', gap: '1' })
const sub = css({ mb: '1', display: 'block' })
const links = css({ display: 'flex', gap: '3' })
</script>

<template>
  <MpDrawer :is-open="row != null" placement="right" size="lg" @close="emit('close')">
    <MpDrawerOverlay />
    <MpDrawerContent>
      <MpDrawerHeader>
        <MpText weight="semiBold">{{ row?.jiraKey }}</MpText>
        <MpDrawerCloseButton />
      </MpDrawerHeader>
      <MpDrawerBody v-if="row" data-test="initiative-detail">
        <MpText size="h3" weight="semiBold" :class="css({ mb: '3' })">{{ row.title }}</MpText>
        <div :class="badges">
          <MpBadge variant="subtle" :variant-color="STATUS_COLOR[row.statusCategory]">{{ statusText(row) }}</MpBadge>
          <MpBadge v-if="row.criticality" variant="subtle" :variant-color="row.criticality === 'Strategic' ? 'blue' : 'gray'">{{ row.criticality }}</MpBadge>
          <MpBadge v-if="row.needsReview" variant="subtle" variant-color="orange">Needs review</MpBadge>
        </div>

        <div :class="meta">
          <MpText size="label" color="text.secondary">Squad</MpText><MpText size="label">{{ row.squad ?? 'Unassigned' }}</MpText>
          <MpText size="label" color="text.secondary">Owner</MpText><MpText size="label">{{ row.ownerName ?? '-' }}</MpText>
          <MpText size="label" color="text.secondary">Epic status</MpText><MpText size="label">{{ row.epicStatus }}</MpText>
          <MpText size="label" color="text.secondary">Project status</MpText><MpText size="label">{{ row.projectStatus ?? '-' }}</MpText>
          <MpText size="label" color="text.secondary">Progress</MpText><MpText size="label">{{ progressText(row) }}</MpText>
          <MpText size="label" color="text.secondary">Est. delivery</MpText><MpText size="label">{{ row.estDeliveryDate ? formatDate(row.estDeliveryDate) : '-' }}</MpText>
          <MpText size="label" color="text.secondary">Actual delivery</MpText><MpText size="label">{{ row.actualDeliveryDate ? formatDate(row.actualDeliveryDate) : '-' }}</MpText>
          <MpText size="label" color="text.secondary">Repo note</MpText><MpText size="label" :class="pre" data-test="detail-repo-note">{{ row.repoNote ?? '-' }}</MpText>
          <MpText size="label" color="text.secondary">Links</MpText>
          <div :class="links">
            <a v-if="row.prdUrl && isHttpUrl(row.prdUrl)" :href="row.prdUrl" target="_blank" rel="noopener noreferrer">PRD</a>
            <a v-if="row.rfcUrl && isHttpUrl(row.rfcUrl)" :href="row.rfcUrl" target="_blank" rel="noopener noreferrer">RFC</a>
            <span v-if="!row.prdUrl && !row.rfcUrl">-</span>
          </div>
        </div>

        <div v-if="row.milestones.length" :class="block">
          <MpText weight="semiBold" :class="sub">Release and self test</MpText>
          <div v-for="m in row.milestones" :key="m.id">
            <MpText size="label">{{ m.kind === 'release' ? 'Release' : 'Self test' }} · {{ formatDate(isoDay(m.date)) }}</MpText>
          </div>
        </div>

        <div :class="block">
          <MpText weight="semiBold" :class="sub">Key info / remark</MpText>
          <MpText size="label" :class="pre" data-test="detail-remark">{{ row.remark || 'None.' }}</MpText>
        </div>
        <div :class="block">
          <MpText weight="semiBold" :class="sub">Key info / remark (proposed)</MpText>
          <MpText size="label" :class="pre" data-test="detail-remark-proposed">{{ row.remarkProposed || 'None.' }}</MpText>
        </div>

        <div :class="block">
          <div :class="css({ display: 'flex', alignItems: 'center', gap: '2', mb: '2' })">
            <MpText weight="semiBold">To resolve</MpText>
            <MpBadge v-if="row.sheetResolution" size="sm" variant="subtle" :variant-color="resolutionColor(row.sheetResolution)" data-test="detail-sheet-resolution">
              Sheet: {{ row.sheetResolution }}
            </MpBadge>
            <MpBadge size="sm" variant="subtle" :variant-color="row.resolution === 'Open' ? 'orange' : 'green'" data-test="detail-app-resolution">
              Workbench: {{ row.resolution === 'Open' ? 'Open' : 'Nothing to resolve' }}
            </MpBadge>
          </div>
          <MpText size="label" color="text.secondary" :class="sub">From the sheet</MpText>
          <MpText size="label" :class="[pre, css({ mb: '3', display: 'block' })]" data-test="detail-sheet-anomalies">{{ row.sheetAnomalies || 'Nothing written in the sheet.' }}</MpText>
          <MpText size="label" color="text.secondary" :class="sub">Worked out by Workbench</MpText>
          <ul v-if="row.anomalies.length" :class="list" data-test="detail-app-anomalies">
            <li v-for="a in row.anomalies" :key="a"><MpText size="label">{{ a }}</MpText></li>
          </ul>
          <MpText v-else size="label">Nothing to resolve.</MpText>
        </div>
      </MpDrawerBody>
      <MpDrawerFooter>
        <MpButton variant="ghost" @click="emit('close')">Close</MpButton>
        <MpButton v-if="canEdit && row" variant="secondary" left-icon="edit" data-test="detail-edit" @click="emit('edit', row)">Edit</MpButton>
      </MpDrawerFooter>
    </MpDrawerContent>
  </MpDrawer>
</template>
