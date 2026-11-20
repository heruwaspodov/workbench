<script setup lang="ts">
import {
  MpBadge, MpButton, MpSelect, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import SearchInput from '@/components/SearchInput.vue'
import { api, unwrap } from '@/lib/api'
import { isHttpUrl } from '@/lib/clipboard'
import { formatDate, isoDay, monthLabel } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'
import InitiativeDrawer from './InitiativeDrawer.vue'

type Row = NonNullable<Awaited<ReturnType<typeof api.initiatives.get>>['data']>[number]

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
const page = ref(1)
const pageSize = ref(20)
function resetFilters() { q.value = squad.value = status.value = criticality.value = month.value = ''; page.value = 1 }

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
watch([q, squad, status, criticality, month, pageSize], () => { page.value = 1 })
const shown = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const hasNext = computed(() => page.value * pageSize.value < filtered.value.length)

// ----- presentation -----
const STATUS_COLOR = { done: 'green', active: 'blue', todo: 'gray' } as const
const progress = (r: Row) => (r.totalItems ? `${r.doneItems ?? 0}/${r.totalItems} · ${Math.round(((r.doneItems ?? 0) / r.totalItems) * 100)}%` : '-')
const remarkOf = (r: Row) => r.remark || r.remarkProposed || ''

// ----- add / edit (admin) -----
const drawer = ref<{ open: boolean; row: Row | null }>({ open: false, row: null })
const openNew = () => { drawer.value = { open: true, row: null } }
const openEdit = (row: Row) => { drawer.value = { open: true, row } }
const closeDrawer = () => { drawer.value = { ...drawer.value, open: false } }
async function onSaved() {
  closeDrawer()
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
const titleCell = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0, maxWidth: '420px' })
const metaRow = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
const remark = css({ lineClamp: 2 })
const links = css({ display: 'flex', gap: '3' })
const flag = css({ cursor: 'help' })
</script>

<template>
  <PageHeader title="Timelines" subtitle="Delivery timeline and releases for Mekari Sign initiatives.">
    <div v-if="periods.data.value?.length" :class="periodBox">
      <MpSelect v-model="selected" aria-label="Year and quarter" data-test="period-select">
        <option v-for="p in periods.data.value" :key="keyOf(p)" :value="keyOf(p)">{{ label(p) }}</option>
      </MpSelect>
    </div>
    <template v-if="isAdmin">
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

        <MpText weight="semiBold" :class="css({ mb: '3', display: 'block' })" data-test="grid-title">Grid view · {{ filtered.length }}</MpText>
        <AsyncState :empty="filtered.length === 0" empty-text="No initiatives match these filters.">
          <div :class="ui.panel">
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
                    <MpTableCell v-if="isAdmin" as="th" />
                  </MpTableRow>
                </MpTableHead>
                <MpTableBody>
                  <MpTableRow v-for="r in shown" :key="r.id" data-row>
                    <MpTableCell>
                      <div :class="titleCell">
                        <MpText weight="semiBold">{{ r.title }}</MpText>
                        <div :class="metaRow">
                          <MpText size="label-small" color="text.secondary">{{ r.jiraKey }}</MpText>
                          <MpBadge size="sm" variant="subtle" :variant-color="STATUS_COLOR[r.statusCategory]">{{ r.projectStatus || r.epicStatus }}</MpBadge>
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
                    <MpTableCell>{{ progress(r) }}</MpTableCell>
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
                      <MpBadge v-if="r.anomalies.length" size="sm" variant="subtle" variant-color="orange" :class="flag" :title="r.anomalies.join('\n')" data-test="anomaly-badge">
                        {{ r.anomalies.length }} open
                      </MpBadge>
                      <span v-else>-</span>
                    </MpTableCell>
                    <MpTableCell v-if="isAdmin">
                      <MpButton size="sm" variant="ghost" left-icon="edit" data-test="edit-initiative" @click="openEdit(r)">Edit</MpButton>
                    </MpTableCell>
                  </MpTableRow>
                </MpTableBody>
              </MpTable>
            </MpTableContainer>
            <PaginationBar v-model:page="page" v-model:page-size="pageSize" :shown="shown.length" :total="filtered.length" :has-next="hasNext" />
          </div>
        </AsyncState>
      </template>
    </AsyncState>
  </AsyncState>

  <InitiativeDrawer v-if="isAdmin" :open="drawer.open" :initiative="drawer.row" :year="defaults.year" :quarter="defaults.quarter"
    :statuses="knownStatuses" @close="closeDrawer" @saved="onSaved" />
</template>
