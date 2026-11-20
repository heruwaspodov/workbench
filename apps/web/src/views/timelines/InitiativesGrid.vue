<script setup lang="ts">
import { MpBadge, MpButton, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css } from '@mekari/pixel3'
import { computed, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import { ui } from '@/lib/ui'
import { type Initiative, STATUS_COLOR, progressText, remarkOf, resolutionColor, statusText } from './types'

const props = defineProps<{ rows: Initiative[]; canEdit: boolean }>()
const emit = defineEmits<{ edit: [row: Initiative]; open: [row: Initiative] }>()

const page = ref(1)
const pageSize = ref(20)
watch(() => props.rows, () => { page.value = 1 })
watch(pageSize, () => { page.value = 1 })
const shown = computed(() => props.rows.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const hasNext = computed(() => page.value * pageSize.value < props.rows.length)

const titleCell = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0, maxWidth: '420px' })
const metaRow = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
const remark = css({ lineClamp: 2 })
const links = css({ display: 'flex', gap: '3' })
const flag = css({ cursor: 'help' })
const titleLink = css({ textAlign: 'left', fontWeight: 'semiBold', cursor: 'pointer', whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%', _hover: { textDecoration: 'underline' } })
const resolveCell = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
</script>

<template>
  <AsyncState :empty="rows.length === 0" empty-text="No initiatives match these filters.">
    <div :class="ui.panel" data-test="view-grid">
      <MpTableContainer>
        <MpTable is-hoverable :class="ui.table">
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Initiative</MpTableCell>
              <MpTableCell as="th">Squad</MpTableCell>
              <MpTableCell as="th">Owner</MpTableCell>
              <MpTableCell as="th">Progress</MpTableCell>
              <MpTableCell as="th">Delivery</MpTableCell>
              <MpTableCell as="th">Links</MpTableCell>
              <MpTableCell as="th">To resolve</MpTableCell>
              <MpTableCell v-if="canEdit" as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="r in shown" :key="r.id" data-row>
              <MpTableCell>
                <div :class="titleCell">
                  <button type="button" :class="titleLink" data-test="open-initiative" @click="emit('open', r)">{{ r.title }}</button>
                  <div :class="metaRow">
                    <MpText size="label-small" color="text.secondary">{{ r.jiraKey }}</MpText>
                    <MpBadge size="sm" variant="subtle" :variant-color="STATUS_COLOR[r.statusCategory]">{{ statusText(r) }}</MpBadge>
                    <MpBadge v-if="r.needsReview" size="sm" variant="subtle" variant-color="orange">Needs review</MpBadge>
                  </div>
                  <MpText v-if="remarkOf(r)" size="label-small" color="text.secondary" :class="remark">{{ remarkOf(r) }}</MpText>
                </div>
              </MpTableCell>
              <MpTableCell>
                <div :class="titleCell">
                  <MpText size="label">{{ r.squad ?? 'Unassigned' }}</MpText>
                  <div v-if="r.criticality"><MpBadge size="sm" variant="subtle" :variant-color="r.criticality === 'Strategic' ? 'blue' : 'gray'">{{ r.criticality }}</MpBadge></div>
                </div>
              </MpTableCell>
              <MpTableCell>{{ r.ownerName ?? '-' }}</MpTableCell>
              <MpTableCell>{{ progressText(r) }}</MpTableCell>
              <MpTableCell>
                <div :class="titleCell">
                  <MpText size="label">Est. {{ r.estDeliveryDate ? formatDate(r.estDeliveryDate) : '-' }}</MpText>
                  <MpText v-if="r.actualDeliveryDate" size="label-small" color="text.secondary">Actual {{ formatDate(r.actualDeliveryDate) }}</MpText>
                </div>
              </MpTableCell>
              <MpTableCell>
                <div :class="links">
                  <a v-if="r.prdUrl && isHttpUrl(r.prdUrl)" :href="r.prdUrl" target="_blank" rel="noopener noreferrer" :class="ui.link">PRD</a>
                  <a v-if="r.rfcUrl && isHttpUrl(r.rfcUrl)" :href="r.rfcUrl" target="_blank" rel="noopener noreferrer" :class="ui.link">RFC</a>
                  <span v-if="!r.prdUrl && !r.rfcUrl">-</span>
                </div>
              </MpTableCell>
              <MpTableCell>
                <div v-if="r.sheetResolution || r.anomalies.length" :class="resolveCell">
                  <MpBadge v-if="r.sheetResolution" size="sm" variant="subtle" :variant-color="resolutionColor(r.sheetResolution)" data-test="sheet-resolution">{{ r.sheetResolution }}</MpBadge>
                  <MpBadge v-if="r.anomalies.length" size="sm" variant="subtle" variant-color="orange" :class="flag" :title="r.anomalies.join('\n')" data-test="anomaly-badge">
                    {{ r.anomalies.length }} open
                  </MpBadge>
                </div>
                <span v-else>-</span>
              </MpTableCell>
              <MpTableCell v-if="canEdit">
                <MpButton size="sm" variant="ghost" left-icon="edit" data-test="edit-initiative" @click="emit('edit', r)">Edit</MpButton>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
      <PaginationBar v-model:page="page" v-model:page-size="pageSize" :shown="shown.length" :total="rows.length" :has-next="hasNext" />
    </div>
  </AsyncState>
</template>
