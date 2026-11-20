<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpBannerTitle, MpButton, MpFormControl, MpFormLabel, MpInput, MpSelect,
  MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import XlsxImport from '@/components/XlsxImport.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { ui } from '@/lib/ui'
import type { XlsxLoader } from '@/lib/xlsx-import'

const router = useRouter()

type Preview = NonNullable<Awaited<ReturnType<typeof api.initiatives.import.xlsx.preview.post>>['data']>
type Report = NonNullable<Awaited<ReturnType<typeof api.initiatives.import.xlsx.post>>['data']>

const loadPreview: XlsxLoader<Preview> = (file, tab) => unwrap(api.initiatives.import.xlsx.preview.post({ file, tab }))

const preview = ref<Preview | null>(null)
const report = ref<Report | null>(null)
const year = ref('')
const quarter = ref('')
const checking = ref(false)
const saving = ref(false)

const yearOk = computed(() => /^20\d{2}$/.test(year.value))
const period = computed(() => (yearOk.value && quarter.value ? { year: Number(year.value), quarter: Number(quarter.value) } : null))
const canSave = computed(() => Boolean(preview.value && period.value && report.value && report.value.new + report.value.changed > 0))

function onLoaded(p: Preview) {
  preview.value = p
  report.value = null
  // Only a period that the sheet or file name states is prefilled. Otherwise the admin has to choose it.
  year.value = p.suggestedPeriod ? String(p.suggestedPeriod.year) : ''
  quarter.value = p.suggestedPeriod ? String(p.suggestedPeriod.quarter) : ''
}
function onCleared() {
  preview.value = null
  report.value = null
}

const body = (dryRun: boolean) => ({
  year: period.value!.year, quarter: period.value!.quarter, sourceRef: preview.value!.sourceRef, items: preview.value!.items, dryRun,
})

/** Dry run: shows what the import would do for the chosen quarter. Nothing is saved. */
let token = 0
watch([preview, period], async () => {
  report.value = null
  if (!preview.value || !period.value) return
  const mine = ++token
  checking.value = true
  try {
    const r = await unwrap(api.initiatives.import.xlsx.post(body(true)))
    if (mine === token) report.value = r
  } catch (e) { if (mine === token) notifyError(e) } finally { if (mine === token) checking.value = false }
})

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const r = await unwrap(api.initiatives.import.xlsx.post(body(false)))
    notifySuccess(`Imported ${r.new} new and ${r.changed} changed initiatives for ${r.year} Q${r.quarter}`)
    await router.push('/timelines')
  } catch (e) { notifyError(e) } finally { saving.value = false }
}

const ACTION = {
  new: { label: 'New', color: 'green' },
  changed: { label: 'Changed', color: 'orange' },
  unchanged: { label: 'Unchanged', color: 'gray' },
} as const
const FIELD: Record<string, string> = {
  squad: 'Squad', title: 'Title', criticality: 'Criticality', epicStatus: 'Epic status', projectStatus: 'Project status', ownerName: 'Owner',
  estDeliveryDate: 'Est. delivery', actualDeliveryDate: 'Actual delivery', doneItems: 'Done items', totalItems: 'Total items', prdUrl: 'PRD',
  rfcUrl: 'RFC', remark: 'Remark', remarkProposed: 'Remark (proposed)', needsReview: 'Needs review', milestones: 'Release / self test',
}
const changesText = (changes: string[]) => changes.map((c) => FIELD[c] ?? c).join(', ')

const card = `${ui.card} ${css({ mb: '4' })}`
const grid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4', maxWidth: '480px', mb: '2' })
const counts = css({ display: 'flex', alignItems: 'center', gap: '3', flexWrap: 'wrap', mb: '4' })
const foot = css({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3', mt: '4' })
const warn = css({ mb: '4' })
</script>

<template>
  <PageHeader title="Import initiatives" subtitle="Upload the initiatives tab as an Excel file and choose the year and quarter it belongs to.">
    <template #before-title>
      <RouterLink to="/timelines"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">Timelines</MpButton></RouterLink>
    </template>
  </PageHeader>

  <div :class="card"><XlsxImport :load="loadPreview" @loaded="onLoaded" @cleared="onCleared" /></div>

  <template v-if="preview">
    <div :class="card">
      <div :class="grid">
        <MpFormControl is-required>
          <MpFormLabel>Year</MpFormLabel>
          <MpInput v-model="year" inputmode="numeric" placeholder="2026" :is-invalid="year !== '' && !yearOk" />
        </MpFormControl>
        <MpFormControl is-required>
          <MpFormLabel>Quarter</MpFormLabel>
          <MpSelect v-model="quarter">
            <option value="" disabled>Select</option>
            <option v-for="q in ['1', '2', '3', '4']" :key="q" :value="q">Q{{ q }}</option>
          </MpSelect>
        </MpFormControl>
      </div>
      <!-- MpFormHelpText only works inside a MpFormControl, so plain text is used for a note about two fields. -->
      <MpText size="label-small" color="text.secondary">
        {{ preview.suggestedPeriod ? 'Read from the sheet name or file name. Change it if it is wrong.' : 'The file does not say which quarter it is, so choose it yourself.' }}
      </MpText>
    </div>

    <MpBanner v-if="preview.warnings.length" variant="warning" :class="warn">
      <MpBannerTitle>{{ preview.warnings.length }} {{ preview.warnings.length === 1 ? 'note' : 'notes' }} about the file</MpBannerTitle>
      <MpBannerDescription>
        <div v-for="w in preview.warnings" :key="w">• {{ w }}</div>
      </MpBannerDescription>
    </MpBanner>

    <MpText v-if="!period" color="text.secondary">Choose the year and quarter to see what the import would change.</MpText>
    <MpText v-else-if="checking && !report" color="text.secondary">Comparing with what is saved for {{ year }} Q{{ quarter }}…</MpText>

    <template v-if="report">
      <div :class="counts" data-test="import-counts">
        <MpText weight="semiBold">{{ report.year }} Q{{ report.quarter }}</MpText>
        <MpBadge variant="subtle" variant-color="green">{{ report.new }} new</MpBadge>
        <MpBadge variant="subtle" variant-color="orange">{{ report.changed }} changed</MpBadge>
        <MpBadge variant="subtle" variant-color="gray">{{ report.unchanged }} unchanged</MpBadge>
      </div>
      <div :class="ui.panel">
        <MpTableContainer>
          <MpTable :class="ui.table">
            <MpTableHead>
              <MpTableRow>
                <MpTableCell as="th">Jira key</MpTableCell>
                <MpTableCell as="th">Initiative</MpTableCell>
                <MpTableCell as="th">Result</MpTableCell>
                <MpTableCell as="th">What changes</MpTableCell>
              </MpTableRow>
            </MpTableHead>
            <MpTableBody>
              <MpTableRow v-for="r in report.rows" :key="r.jiraKey" data-row>
                <MpTableCell>{{ r.jiraKey }}</MpTableCell>
                <MpTableCell>{{ r.title }}</MpTableCell>
                <MpTableCell><MpBadge size="sm" variant="subtle" :variant-color="ACTION[r.action].color">{{ ACTION[r.action].label }}</MpBadge></MpTableCell>
                <MpTableCell>{{ changesText(r.changes) || '-' }}</MpTableCell>
              </MpTableRow>
            </MpTableBody>
          </MpTable>
        </MpTableContainer>
      </div>
      <MpText size="label-small" color="text.secondary" :class="css({ mt: '3', display: 'block' })">
        Initiatives that are not in the file are kept. A Key Info / Remark that is already filled is never overwritten.
        An upload replaces status, progress, dates and owner with the file's values, so use Sync from Jira on the Timelines page afterwards to bring them up to date.
      </MpText>
      <div :class="foot">
        <RouterLink to="/timelines"><MpButton variant="ghost">Cancel</MpButton></RouterLink>
        <MpButton :is-disabled="!canSave" :is-loading="saving" data-test="import-save" @click="save">
          Import {{ report.new + report.changed }} {{ report.new + report.changed === 1 ? 'initiative' : 'initiatives' }}
        </MpButton>
      </div>
    </template>
  </template>
</template>
