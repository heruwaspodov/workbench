<script setup lang="ts">
/**
 * Suggestions beside the plan, from the owner's own Jira and Confluence activity in the plan's quarter.
 * Nothing is filled in automatically: every action asks for confirmation and only edits the form (the plan still needs Save).
 */
import {
  MpBadge, MpButton, MpInput, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpSpinner, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import EpicsModal, { type EpicSuggestion } from './EpicsModal.vue'
import PanelCard from './PanelCard.vue'
import PickTargetModal from './PickTargetModal.vue'
import { ApiError, api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import type { EditableItem } from '@/lib/pgp'
import { useAuth } from '@/stores/auth'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

const props = defineProps<{ planId: string; items: EditableItem[]; canAddInitiatives: boolean }>()
const emit = defineEmits<{
  link: [rowKey: string, url: string]
  current: [rowKey: string, value: string]
  epics: [groupKey: string | null, epics: EpicSuggestion[]]
}>()

const { data, loading, error, run } = useAsync(() => unwrap(api.pgp.plans({ id: props.planId }).suggestions.get()))
onMounted(run)
const notConnected = computed(() => error.value instanceof ApiError && error.value.code === 'NOT_CONNECTED')
const errorText = computed(() => (error.value instanceof Error ? error.value.message : 'Could not load suggestions'))

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ----- show more -----
const LIMIT = 6
const allEpics = ref(false)
const allPages = ref(false)
const allRateEpics = ref(false)
const epicList = computed(() => (allEpics.value ? data.value?.epics : data.value?.epics.slice(0, LIMIT)) ?? [])
const pageList = computed(() => (allPages.value ? data.value?.pages : data.value?.pages.slice(0, LIMIT)) ?? [])
const rateEpicList = computed(() => (allRateEpics.value ? rate.data.value?.epics : rate.data.value?.epics.slice(0, LIMIT)) ?? [])
const kindLabel: Record<string, string> = { rfc: 'RFC', rca: 'RCA', 'tech-doc': 'Tech doc', other: 'Page' }

// ----- pick a target initiative -----
const picker = ref<{ heading: string; url?: string; currentValue?: string } | null>(null)
const openPicker = (heading: string, url?: string, currentValue?: string) => { monthOpen.value = null; picker.value = { heading, url, currentValue } }
const onLink = (key: string, url: string) => { emit('link', key, url); picker.value = null }
const onCurrent = (key: string, value: string) => { emit('current', key, value); picker.value = null }

// ----- epics -> initiatives -----
const epicsOpen = ref(false)
const onEpics = (groupKey: string | null, list: EpicSuggestion[]) => { emit('epics', groupKey, list); epicsOpen.value = false }

// ----- month detail modal -----
const monthOpen = ref<string | null>(null)
const month = useAsync((m: string) => unwrap(api.pgp.plans({ id: props.planId }).suggestions.delivery({ month: m }).get()))
function openMonth(m: string) { monthOpen.value = m; month.run(m) }
const monthValue = computed(() => (month.data.value ? `${month.data.value.storyPoints} SP · ${plural(month.data.value.tickets, 'ticket')} (${monthLabel(month.data.value.month)})` : ''))

// ----- team delivery rate by label (the default label lives in Connections; typing another one is a one-off look) -----
const label = ref('')
const savedLabel = ref<string | null>(null)
const rate = useAsync((l: string) => unwrap(api.pgp.plans({ id: props.planId }).suggestions['delivery-rate'].get({ query: { label: l } })))
async function applyLabel() {
  const l = label.value.trim()
  if (!l) return
  rateLoadedFor = l
  await Promise.all([rate.run(l), Promise.resolve(loadSla())])
}
// The card is heavy (it reads every epic's children), so it loads only once it is open and a label is known.
const rateOpen = ref(false)
let rateLoadedFor = ''
function loadRate() {
  const l = label.value.trim()
  if (!rateOpen.value || !l || rateLoadedFor === l) return
  rateLoadedFor = l
  rate.run(l)
}
watch(data, (d, before) => {
  if (!d || before) return // first load only: later reloads must not overwrite what is typed
  savedLabel.value = d.teamLabel
  label.value = d.teamLabel ?? ''
  loadRate()
  loadSla()
})
const onRateToggle = (open: boolean) => { rateOpen.value = open; loadRate() }
// ----- Fast Track SLA (loaded when its card is open) -----
const auth = useAuth()
const sla = useAsync((l: string) => unwrap(api.pgp.plans({ id: props.planId }).suggestions['fast-track-sla'].get({ query: l ? { label: l } : {} })))
const slaOpen = ref(false)
const allMissed = ref(false)
let slaLoadedFor: string | null = null
function loadSla(force = false) {
  const l = label.value.trim()
  if (!slaOpen.value || (!force && slaLoadedFor === l)) return
  slaLoadedFor = l
  sla.run(l)
}
const onSlaToggle = (open: boolean) => { slaOpen.value = open; loadSla() }
const missedList = computed(() => (allMissed.value ? sla.data.value?.missedTickets : sla.data.value?.missedTickets.slice(0, LIMIT)) ?? [])
const duration = (minutes: number, calendar: 'weekdays' | 'always') => {
  const day = (calendar === 'weekdays' ? 9 : 24) * 60
  const d = Math.floor(minutes / day), h = Math.floor((minutes % day) / 60), m = minutes % 60
  return [d ? `${d}d` : '', h ? `${h}h` : '', !d && m ? `${m}m` : ''].filter(Boolean).join(' ') || '0h'
}
const slaValue = computed(() => {
  const r = sla.data.value
  return r && r.rate != null ? `${r.rate}% of Fast Track tickets within SLA (${r.met}/${r.met + r.missed}, ${r.label})` : ''
})
const canSaveDefault = computed(() => label.value.trim() !== '' && label.value.trim() !== (savedLabel.value ?? ''))
const savingDefault = ref(false)
async function saveDefault() {
  savingDefault.value = true
  try {
    const o = await unwrap(api.connections.jira['team-label'].put({ label: label.value.trim() }))
    savedLabel.value = o.jira.teamLabel
    notifySuccess('Default team label saved')
  } catch (e) { notifyError(e) } finally { savingDefault.value = false }
}
const rateText = (r: { done: number; total: number; rate: number | null }, unit: string) => (r.rate == null ? `No ${unit}` : `${r.rate}% (${r.done}/${r.total} ${unit})`)
const releasedText = (r: { released: number; done: number; rate: number | null }, unit: string) => (r.rate == null ? `No done ${unit}` : `${r.rate}% (${r.released}/${r.done} ${unit})`)
type Delivery = 'delivered' | 'children_done' | 'in_progress' | 'no_children'
const deliveryOrder: Delivery[] = ['delivered', 'children_done', 'in_progress', 'no_children']
const deliveryLabel: Record<Delivery, string> = { delivered: 'Delivered', children_done: 'All children done', in_progress: 'In progress', no_children: 'No children' }
const deliveryColor: Record<Delivery, 'green' | 'blue' | 'orange' | 'gray'> = { delivered: 'green', children_done: 'orange', in_progress: 'blue', no_children: 'gray' }
const rateValue = computed(() => {
  const r = rate.data.value
  return r && r.tickets.rate != null ? `${r.label}: ${r.tickets.rate}% tickets (${r.tickets.done}/${r.tickets.total}), ${r.storyPoints.rate ?? 0}% SP` : ''
})

const aside = css({
  display: 'flex', flexDirection: 'column', gap: '3', minWidth: 0,
  xl: { position: 'sticky', top: '6', maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto', scrollbarGutter: 'stable', pr: '1' },
})
const row = css({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', py: '2', borderTopWidth: '1px', borderColor: 'border.default.subtle',
  _first: { borderTopWidth: '0', pt: '0' },
})
const rowBtn = css({ width: '100%', textAlign: 'left', cursor: 'pointer', rounded: 'md', px: '1', _hover: { bg: 'background.neutral.subtle.hovered' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused' } })
const grow = css({ minWidth: 0, flex: 1 })
const scroll = css({ maxHeight: '320px', overflowY: 'auto', pr: '1' })
const stats = css({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2' })
const stat = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '3', rounded: 'lg', bg: 'background.surface', minWidth: 0 })
const explain = css({
  fontSize: 'sm', color: 'text.secondary', '& summary': { cursor: 'pointer', fontWeight: 'semiBold', color: 'text.primary' }, '& p': { mt: '2' },
})
const card = `${ui.card} ${css({ display: 'flex', flexDirection: 'column', gap: '3', p: '4' })}`
const pct = (r: number | null) => (r == null ? '-' : `${r}%`)
const trunc = `${ui.link} ${css({ display: 'block', truncate: true })}`
const meta = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
const problem = css({ color: 'text.danger' })
</script>

<template>
  <aside :class="aside" aria-label="Suggestions">
    <div v-if="loading && !data" :class="css({ display: 'grid', placeItems: 'center', py: '8' })"><MpSpinner /></div>

    <section v-else-if="error" :class="card">
      <MpText weight="semiBold">Suggestions</MpText>
      <MpText v-if="notConnected" size="label" color="text.secondary">
        Jira is not connected yet. Open <RouterLink to="/connections" :class="ui.link">Connections</RouterLink> to link your account.
      </MpText>
      <template v-else>
        <MpText size="label" :class="problem">{{ errorText }}</MpText>
        <MpButton size="sm" variant="secondary" @click="run">Try again</MpButton>
      </template>
    </section>

    <template v-else-if="data">
      <PanelCard id="epics" title="Jira epics" :subtitle="`Worked on in ${data.period}`" :count="data.errors.epics ? null : data.epics.length" default-open>
        <MpText v-if="data.errors.epics" size="label" :class="problem">Epics could not be loaded: {{ data.errors.epics }}</MpText>
        <MpText v-else-if="!data.epics.length" size="label" color="text.secondary">No epics found for this quarter.</MpText>
        <template v-else>
          <MpButton v-if="canAddInitiatives" size="sm" variant="secondary" data-test="add-epics" :class="css({ alignSelf: 'flex-start' })" @click="epicsOpen = true">Add initiatives</MpButton>
          <div :class="allEpics ? scroll : undefined">
            <div v-for="e in epicList" :key="e.key" :class="row">
              <div :class="grow">
                <a :href="e.url" target="_blank" rel="noopener noreferrer" :title="e.summary" :class="trunc">{{ e.summary }}</a>
                <div :class="meta">
                  <MpText size="label-small" color="text.secondary">{{ e.key }}</MpText>
                  <MpBadge size="sm" variant="subtle" :variant-color="e.statusCategory === 'done' ? 'green' : e.statusCategory === 'indeterminate' ? 'blue' : 'gray'">{{ e.status }}</MpBadge>
                </div>
              </div>
              <MpButton size="sm" variant="ghost" @click="openPicker(e.summary, e.url)">Add to…</MpButton>
            </div>
          </div>
          <MpButton v-if="data.epics.length > LIMIT" size="sm" variant="textLink" :class="css({ alignSelf: 'flex-start' })" @click="allEpics = !allEpics">{{ allEpics ? 'Show fewer' : `Show all ${data.epics.length}` }}</MpButton>
        </template>
      </PanelCard>

      <PanelCard id="pages" title="Confluence" subtitle="Pages you created or edited, last 3 months" :count="data.errors.pages ? null : data.pages.length">
        <div v-if="data.errors.pages" :class="css({ display: 'flex', flexDirection: 'column', gap: '2', alignItems: 'flex-start' })">
          <MpText size="label" :class="problem">Confluence could not be loaded. Try again in a moment.</MpText>
          <MpButton size="sm" variant="secondary" @click="run">Try again</MpButton>
        </div>
        <MpText v-else-if="!data.pages.length" size="label" color="text.secondary">No pages in the last 3 months.</MpText>
        <template v-else>
          <div :class="allPages ? scroll : undefined">
            <div v-for="p in pageList" :key="p.id" :class="row">
              <div :class="grow">
                <a v-if="isHttpUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer" :title="p.title" :class="trunc">{{ p.title }}</a>
                <MpText v-else size="label" weight="semiBold">{{ p.title }}</MpText>
                <div :class="meta">
                  <MpBadge size="sm" variant="subtle" variant-color="gray">{{ kindLabel[p.kind] }}</MpBadge>
                  <MpText size="label-small" color="text.secondary">{{ p.space ?? '-' }} · {{ formatDate(p.lastModified) }}</MpText>
                </div>
              </div>
              <div :class="css({ display: 'flex', alignItems: 'center', flexShrink: 0 })">
                <MpButton size="sm" variant="ghost" @click="openPicker(p.title, p.url)">Add to…</MpButton>
                <MpButton size="sm" variant="ghost" left-icon="copy" aria-label="Copy link" title="Copy link" @click="copyText(p.url)" />
              </div>
            </div>
          </div>
          <MpButton v-if="data.pages.length > LIMIT" size="sm" variant="textLink" :class="css({ alignSelf: 'flex-start' })" @click="allPages = !allPages">{{ allPages ? 'Show fewer' : `Show all ${data.pages.length}` }}</MpButton>
        </template>
      </PanelCard>

      <PanelCard id="delivery" title="Story points & tickets" :subtitle="`Resolved by you in ${data.period}`">
        <MpText v-if="data.errors.delivery" size="label" :class="problem">Delivery could not be loaded: {{ data.errors.delivery }}</MpText>
        <MpText v-else size="label-small" color="text.secondary">Select a month to see its tickets.</MpText>
        <div>
          <button v-for="d in data.delivery" :key="d.month" type="button" :class="[row, rowBtn]" :data-month="d.month" @click="openMonth(d.month)">
            <MpText size="label">{{ monthLabel(d.month) }}</MpText>
            <MpText size="label" color="text.secondary">{{ d.storyPoints }} SP · {{ plural(d.tickets, 'ticket') }} ›</MpText>
          </button>
        </div>
      </PanelCard>

      <PanelCard id="bugs" title="Bugs by priority" :subtitle="`Assigned to you, created in ${data.period}`" :count="data.bugs ? data.bugs.total : null">
        <MpText v-if="data.errors.bugs" size="label" :class="problem">Bugs could not be loaded: {{ data.errors.bugs }}</MpText>
        <MpText v-else-if="!data.bugs || !data.bugs.total" size="label" color="text.secondary">No bugs assigned to you were created this quarter.</MpText>
        <template v-else>
          <div>
            <div v-for="b in data.bugs.items" :key="b.priority" :class="row">
              <MpText size="label" :title="b.priority">{{ b.label }}</MpText>
              <MpText size="label" weight="semiBold">{{ b.count }}</MpText>
            </div>
          </div>
          <div :class="meta">
            <a :href="data.bugs.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton size="sm" variant="ghost" @click="openPicker('Bugs by priority', data.bugs.url, data.bugs.value)">Add to…</MpButton>
          </div>
        </template>
      </PanelCard>

      <PanelCard id="sla" title="Fast Track SLA" :subtitle="`Created in ${data.period}${label.trim() ? `, ${label.trim()}` : ''}`" :count="sla.data.value?.rate != null ? `${sla.data.value.rate}%` : null" @toggle="onSlaToggle">
        <MpText v-if="!label.trim()" size="label" color="text.secondary">
          Set your team label in <RouterLink to="/connections" :class="ui.link">Connections</RouterLink> to see your Fast Track SLA.
        </MpText>
        <div v-else-if="sla.loading.value" :class="css({ display: 'grid', placeItems: 'center', py: '4' })"><MpSpinner /></div>
        <MpText v-else-if="sla.error.value" size="label" :class="problem">{{ (sla.error.value as Error).message }}</MpText>
        <template v-else-if="sla.data.value">
          <div :class="stats">
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">Within SLA</MpText>
              <MpText size="h3" weight="semiBold">{{ pct(sla.data.value.rate) }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ sla.data.value.met }}/{{ sla.data.value.met + sla.data.value.missed }} tickets</MpText>
            </div>
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">Missed</MpText>
              <MpText size="h3" weight="semiBold">{{ sla.data.value.missed }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ sla.data.value.running }} running · {{ sla.data.value.noGoal }} no goal</MpText>
            </div>
          </div>
          <div v-if="sla.data.value.goals.length">
            <div v-for="g in sla.data.value.goals" :key="g.name" :class="row">
              <div :class="grow">
                <MpText size="label" :class="css({ truncate: true })" :title="g.name">{{ g.name }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ g.target }} · {{ g.calendar === 'weekdays' ? 'working days' : '24x7' }}</MpText>
              </div>
              <MpText size="label" color="text.secondary">{{ g.met }} met · {{ g.missed }} missed<template v-if="g.running"> · {{ g.running }} running</template></MpText>
            </div>
          </div>
          <MpText v-else size="label" color="text.secondary">No Fast Track ticket matched an SLA goal in this quarter.</MpText>
          <div v-if="sla.data.value.missedTickets.length" :class="css({ display: 'flex', flexDirection: 'column', gap: '2' })" data-test="sla-missed">
            <MpText size="label" weight="semiBold">Missed tickets</MpText>
            <div :class="allMissed ? scroll : undefined">
              <div v-for="t in missedList" :key="t.key" :class="row">
                <div :class="grow">
                  <a :href="t.url" target="_blank" rel="noopener noreferrer" :title="t.summary" :class="trunc">{{ t.key }} {{ t.summary }}</a>
                  <MpText size="label-small" color="text.secondary">{{ t.goal }} · {{ duration(t.elapsedMinutes, t.calendar) }} of {{ duration(t.targetMinutes, t.calendar) }}<template v-if="t.open"> · still open</template></MpText>
                </div>
              </div>
            </div>
            <MpButton v-if="sla.data.value.missedTickets.length > LIMIT" size="sm" variant="textLink" :class="css({ alignSelf: 'flex-start' })" @click="allMissed = !allMissed">{{ allMissed ? 'Show fewer' : `Show all ${sla.data.value.missedTickets.length}` }}</MpButton>
            <MpText v-if="sla.data.value.missedTruncated" size="label-small" color="text.secondary">Only the 50 worst are listed.</MpText>
          </div>
          <details :class="explain">
            <summary>How is this counted?</summary>
            <p>Fast Track tickets of the team label created this quarter. The first SLA goal matching the ticket's priority and label (with an assignee set) applies; time runs from creation to resolution on the goal's calendar (working days are Mon-Fri 09:00-18:00, no holidays). A ticket still open past its target counts as missed.</p>
            <p>The goals are a copy of the Time to SLA configuration in Jira<template v-if="auth.me?.role === 'admin'">: <RouterLink to="/admin/sla" :class="ui.link">edit SLA goals</RouterLink></template><template v-else>; an admin keeps them up to date</template>.</p>
            <p v-if="sla.data.value.truncated">Only the first 1000 tickets were counted.</p>
          </details>
          <div :class="meta">
            <a :href="sla.data.value.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton size="sm" variant="ghost" :is-disabled="!slaValue" @click="openPicker('Fast Track SLA', sla.data.value.url, slaValue)">Add to…</MpButton>
          </div>
        </template>
      </PanelCard>

      <PanelCard id="rate" @toggle="onRateToggle" title="Team delivery rate" :subtitle="`Whole team, by Jira label, ${data.period}`" :count="rate.data.value?.tickets.rate != null ? `${rate.data.value.tickets.rate}%` : null">
        <form :class="css({ display: 'flex', gap: '2' })" @submit.prevent="applyLabel">
          <MpInput v-model="label" placeholder="Jira label" aria-label="Jira label" maxlength="100" />
          <MpButton type="submit" variant="secondary" :is-loading="rate.loading.value">Show</MpButton>
        </form>
        <div :class="meta">
          <MpButton v-if="canSaveDefault" size="sm" variant="ghost" data-test="save-default-label" :is-loading="savingDefault" @click="saveDefault">Use as default</MpButton>
          <MpText size="label-small" color="text.secondary">
            <template v-if="savedLabel">Default: {{ savedLabel }}. Change it in <RouterLink to="/connections" :class="ui.link">Connections</RouterLink>.</template>
            <template v-else>No default yet. Set one in <RouterLink to="/connections" :class="ui.link">Connections</RouterLink>.</template>
          </MpText>
        </div>
        <MpText v-if="rate.error.value" size="label" :class="problem">{{ (rate.error.value as Error).message }}</MpText>
        <template v-else-if="rate.data.value">
          <div :class="stats">
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">Tickets done</MpText>
              <MpText size="h3" weight="semiBold">{{ pct(rate.data.value.tickets.rate) }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ rate.data.value.tickets.done }}/{{ rate.data.value.tickets.total }} tickets</MpText>
            </div>
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">Story points done</MpText>
              <MpText size="h3" weight="semiBold">{{ pct(rate.data.value.storyPoints.rate) }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ rate.data.value.storyPoints.done }}/{{ rate.data.value.storyPoints.total }} SP</MpText>
            </div>
          </div>
          <div :class="stats" data-test="rate-released">
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">Tickets released</MpText>
              <MpText size="h3" weight="semiBold">{{ pct(rate.data.value.released.tickets.rate) }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ rate.data.value.released.tickets.released }}/{{ rate.data.value.released.tickets.done }} done tickets</MpText>
            </div>
            <div :class="stat">
              <MpText size="label-small" color="text.secondary">SP released</MpText>
              <MpText size="h3" weight="semiBold">{{ pct(rate.data.value.released.storyPoints.rate) }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ rate.data.value.released.storyPoints.released }}/{{ rate.data.value.released.storyPoints.done }} SP</MpText>
            </div>
          </div>
          <details :class="explain" data-test="rate-excluded">
            <summary>How is this counted?</summary>
            <p>Not counted: {{ plural(rate.data.value.excluded.epics, 'epic') }} and {{ rate.data.value.excluded.wontFix }} Won't Fix. Open tickets not touched this quarter are left out.</p>
            <p>Released = a fix version marked released in Jira, so it depends on the team filling it in. {{ plural(rate.data.value.released.tickets.noVersion, 'done ticket') }} without a fix version, not assumed released.</p>
            <p>Epics follow their own Jira status: Delivered = the epic is Done. "All children done" = still open but nothing left to do (probably not closed yet). An epic is listed when it or a ticket under it carries the label, and it was created or resolved this quarter, has the quarter as its Period or in its name (like 26Q4), or a quarter of its work finished in it{{ rate.data.value.excluded.epicsOutOfQuarter ? `; ${plural(rate.data.value.excluded.epicsOutOfQuarter, 'older epic')} left out` : '' }}.</p>
            <p>Toggle names come from Jira. Whether a toggle is switched on is not recorded in Jira, so it is not shown.</p>
            <p v-if="rate.data.value.truncated">Only the first 1000 tickets were counted.</p>
          </details>
          <div v-if="rate.data.value.epics.length" :class="css({ display: 'flex', flexDirection: 'column', gap: '2' })" data-test="rate-epics">
            <MpText size="label" weight="semiBold">Epics delivered: {{ rate.data.value.epicsDelivered.delivered }}/{{ rate.data.value.epicsDelivered.total }}</MpText>
            <div :class="meta">
              <MpBadge v-for="r in deliveryOrder" :key="r" size="sm" variant="subtle" :variant-color="deliveryColor[r]">{{ rate.data.value.epicSummary[r] }} {{ deliveryLabel[r] }}</MpBadge>
            </div>
            <div :class="allRateEpics ? scroll : undefined">
              <div v-for="e in rateEpicList" :key="e.key" :class="row">
                <div :class="grow">
                  <a :href="e.url" target="_blank" rel="noopener noreferrer" :title="e.summary" :class="trunc">{{ e.summary }}</a>
                  <MpText size="label-small" color="text.secondary">{{ e.key }} · {{ e.children.done }}/{{ e.children.total }} done · {{ e.children.released }} released<template v-if="e.deliveredOn"> · delivered {{ formatDate(e.deliveredOn) }}</template></MpText>
                  <MpText v-if="e.projectStatus || e.viaChildren" size="label-small" color="text.secondary">
                    <template v-if="e.projectStatus">Project: {{ e.projectStatus }}</template><template v-if="e.projectStatus && e.viaChildren"> · </template><template v-if="e.viaChildren" >from labelled tickets</template>
                  </MpText>
                  <MpText v-if="e.toggles.length" size="label-small" color="text.secondary" :title="e.toggles.join(', ')" :class="css({ truncate: true })">Toggle: {{ e.toggles.join(', ') }}</MpText>
                </div>
                <MpBadge size="sm" variant="subtle" :variant-color="deliveryColor[e.delivery]">{{ deliveryLabel[e.delivery] }}</MpBadge>
              </div>
            </div>
            <MpButton v-if="rate.data.value.epics.length > LIMIT" size="sm" variant="textLink" :class="css({ alignSelf: 'flex-start' })" @click="allRateEpics = !allRateEpics">{{ allRateEpics ? 'Show fewer' : `Show all ${rate.data.value.epics.length}` }}</MpButton>
            <MpText v-if="rate.data.value.epicsTruncated" size="label-small" color="text.secondary">Some epic children were not loaded, so statuses may be incomplete.</MpText>
          </div>
          <div :class="meta">
            <a :href="rate.data.value.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton size="sm" variant="ghost" :is-disabled="!rateValue" @click="openPicker(`Delivery rate: ${rate.data.value.label}`, rate.data.value.url, rateValue)">Add to…</MpButton>
          </div>
        </template>
      </PanelCard>
    </template>

    <MpModal :is-open="Boolean(monthOpen)" size="lg" @close="monthOpen = null">
      <MpModalOverlay />
      <MpModalContent>
        <MpModalHeader>{{ monthOpen ? monthLabel(monthOpen) : '' }}<MpModalCloseButton /></MpModalHeader>
        <MpModalBody>
          <div v-if="month.loading.value" :class="css({ display: 'grid', placeItems: 'center', py: '8' })"><MpSpinner /></div>
          <MpText v-else-if="month.error.value" :class="problem">{{ (month.error.value as Error).message }}</MpText>
          <template v-else-if="month.data.value">
            <MpText size="label" color="text.secondary" :class="css({ mb: '3' })" data-test="month-total">
              {{ month.data.value.storyPoints }} SP · {{ plural(month.data.value.tickets, 'ticket') }}
            </MpText>
            <MpText v-if="!month.data.value.issues.length" size="label" color="text.secondary">No tickets with story points resolved this month.</MpText>
            <div v-for="i in month.data.value.issues" :key="i.key" :class="row">
              <div :class="grow">
                <a :href="i.url" target="_blank" rel="noopener noreferrer" :title="i.summary" :class="trunc">{{ i.key }} {{ i.summary }}</a>
                <MpText size="label-small" color="text.secondary">{{ formatDate(i.resolvedAt) }}</MpText>
              </div>
              <MpBadge size="sm" variant="subtle" variant-color="blue">{{ i.storyPoints }} SP</MpBadge>
            </div>
            <MpText v-if="month.data.value.tickets > month.data.value.issues.length" size="label-small" color="text.secondary" :class="css({ mt: '2' })">
              Showing the first {{ month.data.value.issues.length }} tickets. Open in Jira for the rest.
            </MpText>
          </template>
        </MpModalBody>
        <MpModalFooter>
          <template v-if="month.data.value">
            <a :href="month.data.value.url" target="_blank" rel="noopener noreferrer"><MpButton variant="secondary" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton variant="secondary" @click="openPicker(`${monthLabel(month.data.value.month)} delivery`, month.data.value.url, monthValue)">Add to…</MpButton>
          </template>
        </MpModalFooter>
      </MpModalContent>
    </MpModal>

    <PickTargetModal :open="Boolean(picker)" :heading="picker?.heading ?? ''" :url="picker?.url" :current-value="picker?.currentValue" :items="items"
      @close="picker = null" @link="onLink" @current="onCurrent" />
    <EpicsModal :open="epicsOpen" :epics="data?.epics ?? []" :items="items" @close="epicsOpen = false" @add="onEpics" />
  </aside>
</template>
