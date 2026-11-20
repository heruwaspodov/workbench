<script setup lang="ts">
import { MpButton, MpSelect, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/SearchInput.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { api, notifyError, unwrap } from '@/lib/api'
import { isoDay, monthLabel } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'
import HealthBoard from './HealthBoard.vue'
import InitiativeDrawer from './InitiativeDrawer.vue'
import InitiativeDetail from './InitiativeDetail.vue'
import InitiativesGrid from './InitiativesGrid.vue'
import KanbanBoard from './KanbanBoard.vue'
import SyncResultModal, { type SyncResult } from './SyncResultModal.vue'
import TimelineBoard from './TimelineBoard.vue'
import type { Initiative as Row } from './types'

const auth = useAuth()
const isAdmin = computed(() => auth.me?.role === 'admin')

// ----- quarter selector: only quarters that have data -----
const periods = useAsync(() => unwrap(api.initiatives.periods.get()))
const selected = ref('') // "2026-4"
const label = (p: { year: number; quarter: number }) => `${p.year} · Q${p.quarter}`
const keyOf = (p: { year: number; quarter: number }) => `${p.year}-${p.quarter}`
const current = computed(() => periods.data.value?.find((p) => keyOf(p) === selected.value) ?? null)

// ----- the quarter's rows and numbers -----
const board = useAsync(async (year: number, quarter: number) => {
  const [rows, summary] = await Promise.all([
    unwrap(api.initiatives.get({ query: { year, quarter } })),
    unwrap(api.initiatives.summary.get({ query: { year, quarter } })),
  ])
  return { rows, summary }
})
const reload = async () => {
  await periods.run()
  // The quarter I was looking at may be gone after a delete; fall back to the newest.
  if (!current.value) selected.value = periods.data.value?.[0] ? keyOf(periods.data.value[0]) : ''
  else await loadBoard()
}
const loadBoard = () => (current.value ? board.run(current.value.year, current.value.quarter) : Promise.resolve())

onMounted(async () => {
  await periods.run()
  const first = periods.data.value?.[0]
  if (first) selected.value = keyOf(first)
})
watch(selected, () => { resetFilters(); loadBoard() })

// ----- filters (all in the browser: one quarter is a few dozen rows) -----
const q = ref('')
const squad = ref('')
const status = ref('')
const criticality = ref('')
const month = ref('')
function resetFilters() { q.value = squad.value = status.value = criticality.value = month.value = '' }

const rows = computed<Row[]>(() => board.data.value?.rows ?? [])
const squadOf = (r: Row) => r.squad ?? 'Unassigned'
const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))
const squadOptions = computed(() => uniq(rows.value.map(squadOf)))
const statusOptions = computed(() => uniq(rows.value.map((r) => r.epicStatus)))
const criticalityOptions = computed(() => uniq(rows.value.flatMap((r) => (r.criticality ? [r.criticality] : []))))
const monthOptions = computed(() => uniq(rows.value.flatMap((r) => (r.estDeliveryDate ? [isoDay(r.estDeliveryDate).slice(0, 7)] : []))))

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return rows.value.filter((r) =>
    (!squad.value || squadOf(r) === squad.value)
    && (!status.value || r.epicStatus === status.value)
    && (!criticality.value || r.criticality === criticality.value)
    && (!month.value || isoDay(r.estDeliveryDate).slice(0, 7) === month.value)
    && (!needle || [r.title, r.jiraKey, r.ownerName, r.remark, r.remarkProposed].some((v) => v?.toLowerCase().includes(needle))))
})

// ----- the four views share the same filtered rows; the chosen one lives in the URL (?tab=) -----
type Tab = 'timeline' | 'kanban' | 'grid' | 'health'
const TABS: Tab[] = ['timeline', 'kanban', 'grid', 'health']
const route = useRoute()
const router = useRouter()
const asTab = (v: unknown): Tab => (TABS.includes(v as Tab) ? (v as Tab) : 'timeline')
const tab = ref<Tab>(asTab(route.query.tab))
watch(tab, (t) => { router.replace({ query: { ...route.query, tab: t } }) })
const openCount = computed(() => filtered.value.filter((r) => r.resolution === 'Open').length)
const tabs = computed(() => [
  { value: 'timeline' as const, label: 'Delivery timeline & releases' },
  { value: 'kanban' as const, label: 'Kanban board' },
  { value: 'grid' as const, label: `Grid view (${filtered.value.length})` },
  { value: 'health' as const, label: `Health & anomalies (${openCount.value})` },
])

/** Today in Jakarta, the team's calendar, as YYYY-MM-DD (marks the current week and decides "release next week"). */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

// ----- add / edit (admin) -----
const drawer = ref<{ open: boolean; row: Row | null }>({ open: false, row: null })
const openNew = () => { drawer.value = { open: true, row: null } }
const openEdit = (row: Row) => { detail.value = null; drawer.value = { open: true, row } }
/** Read-only detail for everyone; admins edit from inside it. */
const detail = ref<Row | null>(null)
const openDetail = (row: Row) => { detail.value = row }

// ----- sync from Jira (admin): the whole quarter, or one initiative from its detail panel -----
const syncing = ref<'quarter' | 'one' | null>(null)
const syncResult = ref<SyncResult | null>(null)
async function syncFromJira(only?: Row) {
  if (!current.value || syncing.value) return
  syncing.value = only ? 'one' : 'quarter'
  try {
    syncResult.value = await unwrap(api.initiatives.sync.post({ year: current.value.year, quarter: current.value.quarter, ...(only ? { keys: [only.jiraKey] } : {}) }))
    await loadBoard()
    // Keep the open panel on the same initiative, now with the fresh numbers.
    if (only) detail.value = board.data.value?.rows.find((r) => r.id === only.id) ?? null
  } catch (e) { notifyError(e) } finally { syncing.value = null }
}
const closeDrawer = () => { drawer.value = { ...drawer.value, open: false } }
async function onSaved() {
  closeDrawer()
  detail.value = null
  await reload()
}
const now = new Date()
const defaults = computed(() => ({ year: current.value?.year ?? now.getFullYear(), quarter: current.value?.quarter ?? Math.floor(now.getMonth() / 3) + 1 }))
const knownStatuses = computed(() => statusOptions.value)

const kpis = computed(() => {
  const s = board.data.value?.summary
  if (!s) return []
  return [
    { label: 'Total initiatives', value: s.total, note: `${s.squads.length} ${s.squads.length === 1 ? 'squad' : 'squads'}`, test: 'kpi-total' },
    { label: 'Completed / done', value: s.done, note: `${s.donePercent}%`, test: 'kpi-done' },
    { label: 'Active in progress', value: s.active, note: 'Dev & testing', test: 'kpi-active' },
    { label: 'Needs review', value: s.needsReview, note: 'Flagged for review', test: 'kpi-review' },
  ]
})

const kpiGrid = css({ display: 'grid', gridTemplateColumns: { base: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: '4', mb: '5' })
const kpiCard = `${ui.card} ${css({ display: 'flex', flexDirection: 'column', gap: '1' })}`
const kpiRow = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '3' })
const filters = `${ui.toolbar} ${css({ mb: '4' })}`
const search = css({ flex: '1 1 260px', minWidth: '220px', maxWidth: '420px' })
const periodBox = css({ minWidth: '140px' })
</script>

<template>
  <PageHeader title="Timelines" subtitle="Delivery timeline and releases for Mekari Sign initiatives.">
    <div v-if="periods.data.value?.length" :class="periodBox">
      <MpSelect v-model="selected" aria-label="Year and quarter" data-test="period-select">
        <option v-for="p in periods.data.value" :key="keyOf(p)" :value="keyOf(p)">{{ label(p) }}</option>
      </MpSelect>
    </div>
    <template v-if="isAdmin">
      <MpButton v-if="current" variant="secondary" left-icon="refresh" :is-loading="syncing === 'quarter'" :is-disabled="syncing === 'one'" data-test="sync-quarter" @click="syncFromJira()">Sync from Jira</MpButton>
      <MpButton variant="secondary" left-icon="add" data-test="new-initiative" @click="openNew">New initiative</MpButton>
      <RouterLink to="/timelines/import"><MpButton variant="secondary" left-icon="upload">Import initiatives</MpButton></RouterLink>
    </template>
  </PageHeader>

  <AsyncState :loading="periods.loading.value && !periods.data.value" :error="periods.error.value" :empty="periods.data.value?.length === 0"
    :empty-text="isAdmin ? 'No initiatives yet. Import a quarter from an Excel file, or add one by hand.' : 'No initiatives have been added yet.'" @retry="periods.run">
    <AsyncState :loading="board.loading.value && !board.data.value" :error="board.error.value" @retry="loadBoard">
      <template v-if="board.data.value">
        <div :class="kpiGrid">
          <div v-for="k in kpis" :key="k.label" :class="kpiCard" :data-test="k.test">
            <MpText size="label-small" color="text.secondary" :class="css({ textTransform: 'uppercase', letterSpacing: '0.04em' })">{{ k.label }}</MpText>
            <div :class="kpiRow">
              <MpText size="h2" weight="semiBold">{{ k.value }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ k.note }}</MpText>
            </div>
          </div>
        </div>

        <div :class="filters">
          <div :class="search"><SearchInput v-model="q" placeholder="Search initiatives, Jira keys, owner, remarks" /></div>
          <div :class="ui.field">
            <MpSelect v-model="squad" aria-label="Squad" data-test="f-squad">
              <option value="">Squad: All</option><option v-for="s in squadOptions" :key="s" :value="s">{{ s }}</option>
            </MpSelect>
          </div>
          <div :class="ui.field">
            <MpSelect v-model="status" aria-label="Epic status" data-test="f-status">
              <option value="">Epic status: All</option><option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
            </MpSelect>
          </div>
          <div :class="ui.field">
            <MpSelect v-model="criticality" aria-label="Criticality" data-test="f-criticality">
              <option value="">Criticality: All</option><option v-for="c in criticalityOptions" :key="c" :value="c">{{ c }}</option>
            </MpSelect>
          </div>
          <div :class="ui.field">
            <MpSelect v-model="month" aria-label="Est. delivery month" data-test="f-month">
              <option value="">Est. delivery month: All</option><option v-for="m in monthOptions" :key="m" :value="m">{{ monthLabel(m) }}</option>
            </MpSelect>
          </div>
        </div>

        <SegmentedControl v-model="tab" :options="tabs" label="View" :class="css({ mb: '4' })" data-test="view-tabs" />
        <TimelineBoard v-if="tab === 'timeline' && current" :rows="filtered" :year="current.year" :quarter="current.quarter" :today="today" @open="openDetail" />
        <KanbanBoard v-else-if="tab === 'kanban'" :rows="filtered" @open="openDetail" />
        <InitiativesGrid v-else-if="tab === 'grid'" :rows="filtered" :can-edit="isAdmin" @open="openDetail" @edit="openEdit" />
        <HealthBoard v-else-if="tab === 'health'" :rows="filtered" @open="openDetail" />
      </template>
    </AsyncState>
  </AsyncState>

  <InitiativeDetail :row="detail" :can-edit="isAdmin" :syncing="syncing === 'one'" @close="detail = null" @edit="openEdit" @sync="syncFromJira" />
  <SyncResultModal :result="syncResult" @close="syncResult = null" />
  <InitiativeDrawer v-if="isAdmin" :open="drawer.open" :initiative="drawer.row" :year="defaults.year" :quarter="defaults.quarter"
    :statuses="knownStatuses" @close="closeDrawer" @saved="onSaved" />
</template>
