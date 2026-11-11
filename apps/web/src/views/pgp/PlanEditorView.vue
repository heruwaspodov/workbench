<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpButton, MpFormControl, MpFormLabel, MpInput, MpProgress, MpText, css,
} from '@mekari/pixel3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import type { EpicSuggestion } from '@/components/EpicsModal.vue'
import ItemsEditor from '@/components/ItemsEditor.vue'
import PageHeader from '@/components/PageHeader.vue'
import SuggestionsPanel from '@/components/SuggestionsPanel.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { type EditableItem, newKey, stripKeys, toEditable, totals } from '@/lib/pgp'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

const props = defineProps<{ id: string }>()

type Plan = Awaited<ReturnType<typeof fetchPlan>>
const fetchPlan = () => unwrap(api.pgp.plans({ id: props.id }).get())
const { data: plan, loading, error, run } = useAsync(fetchPlan)

const header = ref({ division: '', sbu: '', sbuDetail: '', directLeader: '' })
const items = ref<EditableItem[]>([])
const snapshot = ref('')
const saving = ref(false)

const serialize = () => JSON.stringify({ h: header.value, i: stripKeys(items.value) })
const dirty = computed(() => Boolean(plan.value?.canEdit) && snapshot.value !== serialize())
const sum = computed(() => totals(items.value))

function hydrate(p: Plan) {
  plan.value = p
  header.value = { division: p.division ?? '', sbu: p.sbu ?? '', sbuDetail: p.sbuDetail ?? '', directLeader: p.directLeader ?? '' }
  items.value = toEditable(p.items)
  snapshot.value = serialize()
}
watch(plan, (p) => { if (p && !snapshot.value) hydrate(p) })
onMounted(run)

async function save() {
  saving.value = true
  try {
    const nullify = (v: string) => v.trim() || null
    await unwrap(api.pgp.plans({ id: props.id }).patch({
      division: nullify(header.value.division), sbu: nullify(header.value.sbu),
      sbuDetail: nullify(header.value.sbuDetail), directLeader: nullify(header.value.directLeader),
    }))
    hydrate(await unwrap(api.pgp.plans({ id: props.id }).items.put({ items: stripKeys(items.value) })))
    notifySuccess('PGP saved')
    return true
  } catch (e) { notifyError(e); return false } finally { saving.value = false }
}

async function setStatus(action: 'submit' | 'reopen') {
  if (dirty.value && !(await save())) return
  try {
    hydrate(await unwrap(action === 'submit' ? api.pgp.plans({ id: props.id }).submit.post() : api.pgp.plans({ id: props.id }).reopen.post()))
    notifySuccess(action === 'submit' ? 'PGP submitted' : 'PGP reopened')
  } catch (e) { notifyError(e) }
}

const exportUrl = computed(() => `/api/pgp/plans/${props.id}/export`)

// ----- suggestions: edit the form only; the plan still needs Save -----
const dedupe = (links: string[]) => [...new Set(links)]
function addLink(rowKey: string, url: string) {
  items.value = items.value.map((i) => (i._key === rowKey ? { ...i, evidenceLinks: dedupe([...(i.evidenceLinks ?? []), url]) } : i))
  notifySuccess('Link added to Evidence. Save to keep it.')
}
function useCurrent(rowKey: string, value: string) {
  items.value = items.value.map((i) => (i._key === rowKey && !i.currentValue?.trim() ? { ...i, currentValue: value } : i))
  notifySuccess('Current value filled. Save to keep it.')
}
const statusFromJira = (category: string): EditableItem['status'] => (category === 'done' ? 'done' : category === 'indeterminate' ? 'on_track' : 'not_started')
function addEpics(groupKey: string | null, epics: EpicSuggestion[]) {
  const anchor = items.value.find((i) => i._key === groupKey)
  const objective = anchor?.objective ?? 'Delivery'
  const keyResult = anchor?.keyResult ?? ''
  const rows: EditableItem[] = epics.map((e) => ({
    _key: newKey(), companyOkr: anchor?.companyOkr ?? null, objective, keyResult, weight: 0, initiative: e.summary,
    status: statusFromJira(e.statusCategory), evidenceLinks: [e.url],
  }))
  const at = anchor ? items.value.reduce((last, i, idx) => (i.objective === objective && i.keyResult === keyResult ? idx : last), -1) : items.value.length - 1
  const next = [...items.value]
  next.splice(at + 1, 0, ...rows)
  items.value = next
  notifySuccess(`${rows.length} ${rows.length === 1 ? 'initiative' : 'initiatives'} added. Set the weights, then Save.`)
}

const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault() }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => !dirty.value || window.confirm('You have unsaved changes. Leave this page?'))

// Layout: plan details and items on the left; suggestions beside them on wide screens, below on narrow ones.
const layout = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', xl: 'minmax(0, 1fr) 320px' }, columnGap: '6', rowGap: '5', alignItems: 'start' })
const mainCol = css({ display: 'flex', flexDirection: 'column', gap: '5', minWidth: 0 })
const details = `${ui.card} ${css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: '200px minmax(0, 1fr)' }, columnGap: '6', rowGap: '5' })}`
const scoreBlock = css({ display: 'flex', flexDirection: 'column', gap: '2', lg: { borderRightWidth: '1px', borderColor: 'border.default.subtle', pr: '6' } })
const headerGrid = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })
</script>

<template>
  <AsyncState :loading="loading && !plan" :error="error" @retry="run">
    <template v-if="plan">
      <PageHeader :title="plan.title" :subtitle="`${plan.user.name} · ${plan.period}`">
        <template #before-title>
          <RouterLink to="/pgp"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">My PGP</MpButton></RouterLink>
        </template>
        <MpBadge :variant-color="plan.status === 'submitted' ? 'green' : 'gray'" variant="subtle">
          {{ plan.status === 'submitted' ? `Submitted ${formatDate(plan.submittedAt)}` : 'Draft' }}
        </MpBadge>
        <a :href="exportUrl"><MpButton variant="secondary" left-icon="excel-document">Export Excel</MpButton></a>
        <template v-if="plan.canEdit">
          <MpButton v-if="plan.status === 'draft'" variant="secondary" :is-disabled="sum.weight !== 100" @click="setStatus('submit')">Submit</MpButton>
          <MpButton v-else variant="secondary" @click="setStatus('reopen')">Reopen</MpButton>
          <MpButton :is-loading="saving" :is-disabled="!dirty" @click="save">Save</MpButton>
        </template>
      </PageHeader>

      <MpBanner v-if="!plan.canEdit" variant="info" :class="css({ mb: '4' })">
        <MpBannerDescription>
          {{ plan.viewerRole === 'leader' ? `You are viewing ${plan.user.name}'s PGP as their direct leader (read-only).` : `You are viewing ${plan.user.name}'s PGP as an admin (read-only).` }}
        </MpBannerDescription>
      </MpBanner>

      <MpBanner v-if="plan.status === 'submitted' && plan.canEdit" variant="info" :class="css({ mb: '4' })">
        <MpBannerDescription>This plan is submitted: the planning columns are locked, while the monitoring columns (baseline, current, achievement, status, evidence) can still be updated.</MpBannerDescription>
      </MpBanner>

      <div :class="layout">
        <div :class="mainCol">
          <section :class="details">
            <div :class="scoreBlock">
              <MpText size="label" color="text.secondary">This quarter's score</MpText>
              <MpText size="h1" weight="semiBold">{{ sum.score }}%</MpText>
              <MpProgress :value="String(sum.score)" />
              <MpText size="label-small" :color="sum.weight === 100 ? 'text.secondary' : 'text.danger'">
                Total weight {{ sum.weight }}%{{ sum.weight !== 100 ? ' — must be 100% to submit' : '' }}
              </MpText>
            </div>
            <div :class="headerGrid">
              <MpFormControl>
                <MpFormLabel>Division</MpFormLabel>
                <MpInput v-model="header.division" :is-read-only="!plan.canEdit" placeholder="Technology Engineering" />
              </MpFormControl>
              <MpFormControl>
                <MpFormLabel>SBU (Scope Product)</MpFormLabel>
                <MpInput v-model="header.sbu" :is-read-only="!plan.canEdit" placeholder="ESIGN" />
              </MpFormControl>
              <MpFormControl>
                <MpFormLabel>SBU (Detail)</MpFormLabel>
                <MpInput v-model="header.sbuDetail" :is-read-only="!plan.canEdit" />
              </MpFormControl>
              <MpFormControl>
                <MpFormLabel>Direct Leader</MpFormLabel>
                <MpInput v-model="header.directLeader" :is-read-only="!plan.canEdit" />
              </MpFormControl>
            </div>
          </section>

          <ItemsEditor v-model="items" mode="plan" :lock-planning="plan.status === 'submitted'" :readonly="!plan.canEdit" />
        </div>

        <SuggestionsPanel v-if="plan.canEdit" :plan-id="id" :items="items" :can-add-initiatives="plan.status === 'draft'"
          @link="addLink" @current="useCurrent" @epics="addEpics" />
      </div>
    </template>
  </AsyncState>
</template>
