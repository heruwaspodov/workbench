<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpBannerTitle, MpButton, MpFormControl, MpFormLabel, MpIcon, MpInput, MpSelect, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import ItemsEditor from '@/components/ItemsEditor.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import XlsxImport from '@/components/XlsxImport.vue'
import { ApiError, api, notifyError, unwrap } from '@/lib/api'
import { type EditableItem, newKey, stripKeys, totals } from '@/lib/pgp'
import type { XlsxLoader, XlsxPreview } from '@/lib/xlsx-import'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

const router = useRouter()
const path = ref<'template' | 'upload'>('template')
const pathOptions = [
  { value: 'template' as const, label: 'From a template' },
  { value: 'upload' as const, label: 'Upload Excel' },
]

/** Set when Create hits a quarter the user already has a PGP for. */
const taken = ref<{ planId: string; message: string } | null>(null)
function onCreateError(e: unknown) {
  if (e instanceof ApiError && e.code === 'PERIOD_EXISTS' && e.existingPlanId) taken.value = { planId: e.existingPlanId, message: e.message }
  else notifyError(e)
}

// ----- from a template -----
const { data, loading, error, run } = useAsync(async () => {
  const [plans, templates] = await Promise.all([unwrap(api.pgp.plans.get()), unwrap(api.pgp.templates.get())])
  return { plans, templates }
})
onMounted(run)
const available = computed(() => {
  if (!data.value) return []
  const have = new Set(data.value.plans.map((p) => p.period))
  return data.value.templates.filter((t) => t.status === 'published' && !have.has(t.period))
})
const creating = ref<string | null>(null)
async function start(templateId: string) {
  creating.value = templateId
  taken.value = null
  try {
    const plan = await unwrap(api.pgp.plans.post({ templateId }))
    await router.push(`/pgp/plans/${plan.id}`)
  } catch (e) { onCreateError(e) } finally { creating.value = null }
}

// ----- from an Excel upload -----
const loadPreview: XlsxLoader = (file, tab) => unwrap(api.pgp.plans.import.xlsx.preview.post({ file, tab }))

const preview = ref<XlsxPreview | null>(null)
const items = ref<EditableItem[]>([])
const year = ref(String(new Date().getFullYear()))
const quarter = ref('1')
const header = ref({ division: '', sbu: '', sbuDetail: '', directLeader: '' })
const withProgress = ref(true)
const saving = ref(false)
const sum = computed(() => totals(items.value))
const canMerge = computed(() => Boolean(preview.value && (preview.value.hasProgress || preview.value.hasEvidence)))

function onLoaded(p: XlsxPreview) {
  taken.value = null
  preview.value = p
  items.value = p.items.map((i) => ({ ...i, status: i.status ?? 'not_started', _key: newKey() }))
  if (p.suggestedPeriod) { year.value = String(p.suggestedPeriod.year); quarter.value = String(p.suggestedPeriod.quarter) }
  header.value = {
    division: p.meta.division ?? '', sbu: p.meta.sbu ?? '', sbuDetail: p.meta.sbuDetail ?? '', directLeader: p.meta.directLeader ?? '',
  }
  withProgress.value = p.hasProgress || p.hasEvidence
}
function onCleared() {
  preview.value = null
  items.value = []
}

const yearOk = computed(() => /^20\d{2}$/.test(year.value))
async function create() {
  if (!preview.value || !yearOk.value) return notifyError(new Error('Enter a valid year, e.g. 2026'))
  saving.value = true
  taken.value = null
  try {
    const rows = stripKeys(items.value).map((i) => withProgress.value
      ? i
      : { ...i, startValue: null, targetValue: null, currentValue: null, achievement: null, status: 'not_started' as const, evidenceLinks: [] })
    const text = (v: string) => v.trim() || null
    const plan = await unwrap(api.pgp.plans['from-xlsx'].post({
      year: Number(year.value), quarter: Number(quarter.value), sourceRef: preview.value.sourceRef,
      division: text(header.value.division), sbu: text(header.value.sbu), sbuDetail: text(header.value.sbuDetail), directLeader: text(header.value.directLeader),
      items: rows.map(({ id, templateItemId, ...rest }) => rest),
    }))
    await router.push(`/pgp/plans/${plan.id}`)
  } catch (e) { onCreateError(e) } finally { saving.value = false }
}

const card = `${ui.card} ${css({ mb: '4' })}`
const main = css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1' })
const titleCls = css({ truncate: true, fontWeight: 'semiBold' })
const metaCls = css({ display: 'flex', alignItems: 'center', gap: '3' })
const grid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: '4' })
const row = css({ display: 'flex', gap: '4', alignItems: 'flex-end', flexWrap: 'wrap' })
const notice = css({ mb: '4', display: 'flex', alignItems: 'center', gap: '3', flexWrap: 'wrap' })
const check = css({ display: 'flex', alignItems: 'center', gap: '2', cursor: 'pointer' })
const noticeBox = `${ui.note} ${notice}`
</script>

<template>
  <PageHeader title="Create PGP" subtitle="One PGP per quarter. Start from a template, or upload your own Excel file.">
    <template #before-title>
      <RouterLink to="/pgp"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">My PGP</MpButton></RouterLink>
    </template>
  </PageHeader>

  <SegmentedControl v-model="path" :options="pathOptions" label="How to create the PGP" :class="css({ mb: '4' })" />

  <div v-if="taken" :class="noticeBox" role="alert">
    <MpText size="label">{{ taken.message }}</MpText>
    <RouterLink :to="`/pgp/plans/${taken.planId}`" :class="ui.link">Open existing PGP</RouterLink>
  </div>

  <AsyncState v-if="path === 'template'" :loading="loading && !data" :error="error" :empty="!available.length"
    empty-text="No template is available for a quarter you do not already have a PGP for. Upload an Excel file instead." @retry="run">
    <div :class="ui.list">
      <div v-for="t in available" :key="t.id" :class="ui.listRow">
        <div :class="ui.tile"><MpIcon name="goal" size="sm" /></div>
        <div :class="main">
          <MpText size="label" :class="titleCls" :title="t.title">{{ t.title }}</MpText>
          <div :class="metaCls">
            <MpBadge size="sm" variant="subtle" variant-color="blue">{{ t.period }}</MpBadge>
            <MpText size="label-small" color="text.secondary">{{ t.itemCount }} {{ t.itemCount === 1 ? 'item' : 'items' }}</MpText>
          </div>
        </div>
        <MpButton size="sm" variant="secondary" :is-loading="creating === t.id" @click="start(t.id)">Fill in this PGP</MpButton>
      </div>
    </div>
  </AsyncState>

  <template v-else>
    <div :class="card"><XlsxImport :load="loadPreview" @loaded="onLoaded" @cleared="onCleared" /></div>

    <template v-if="preview">
      <div :class="card">
        <div :class="grid">
          <MpFormControl is-required>
            <MpFormLabel>Year</MpFormLabel>
            <MpInput v-model="year" inputmode="numeric" placeholder="2026" :is-invalid="!yearOk" />
          </MpFormControl>
          <MpFormControl is-required>
            <MpFormLabel>Quarter</MpFormLabel>
            <MpSelect v-model="quarter">
              <option v-for="q in ['1', '2', '3', '4']" :key="q" :value="q">Q{{ q }}</option>
            </MpSelect>
          </MpFormControl>
          <MpFormControl><MpFormLabel>Division</MpFormLabel><MpInput v-model="header.division" /></MpFormControl>
          <MpFormControl><MpFormLabel>SBU</MpFormLabel><MpInput v-model="header.sbu" /></MpFormControl>
          <MpFormControl><MpFormLabel>SBU detail</MpFormLabel><MpInput v-model="header.sbuDetail" /></MpFormControl>
          <MpFormControl><MpFormLabel>Direct leader</MpFormLabel><MpInput v-model="header.directLeader" /></MpFormControl>
        </div>
        <label v-if="canMerge" :class="[check, css({ mt: '4' })]">
          <input v-model="withProgress" type="checkbox" data-test="with-progress" />
          <MpText size="label">Also import progress and evidence (current value, achievement, status, links)</MpText>
        </label>
      </div>

      <MpBanner v-if="preview.warnings.length" variant="warning" :class="css({ mb: '4' })">
        <MpBannerTitle>Needs review</MpBannerTitle>
        <MpBannerDescription><div v-for="w in preview.warnings" :key="w">• {{ w }}</div></MpBannerDescription>
      </MpBanner>

      <ItemsEditor v-model="items" mode="plan" />

      <div :class="[row, css({ mt: '6', justifyContent: 'flex-end' })]">
        <MpText size="label" color="text.secondary">{{ items.length }} items · total weight {{ sum.weight }}%</MpText>
        <MpButton :is-loading="saving" :is-disabled="!items.length" data-test="create-plan" @click="create">Create PGP</MpButton>
      </div>
    </template>
  </template>
</template>
