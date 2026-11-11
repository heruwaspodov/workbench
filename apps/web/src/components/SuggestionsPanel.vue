<script setup lang="ts">
/**
 * Suggestions beside the plan, from the owner's own Jira and Confluence activity in the plan's quarter.
 * Nothing is filled in automatically: every action asks for confirmation and only edits the form (the plan still needs Save).
 */
import {
  MpBadge, MpButton, MpInput, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpSpinner, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import EpicsModal, { type EpicSuggestion } from './EpicsModal.vue'
import PickTargetModal from './PickTargetModal.vue'
import { ApiError, api, notifyError, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import type { EditableItem } from '@/lib/pgp'
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
const epicList = computed(() => (allEpics.value ? data.value?.epics : data.value?.epics.slice(0, LIMIT)) ?? [])
const pageList = computed(() => (allPages.value ? data.value?.pages : data.value?.pages.slice(0, LIMIT)) ?? [])
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

// ----- team delivery rate by label (the label is typed by hand and remembered in this browser) -----
const LABEL_KEY = 'one-desk:delivery-label'
const readLabel = () => { try { return localStorage.getItem(LABEL_KEY) ?? '' } catch { return '' } }
const label = ref(readLabel())
const rate = useAsync((l: string) => unwrap(api.pgp.plans({ id: props.planId }).suggestions['delivery-rate'].get({ query: { label: l } })))
async function applyLabel() {
  const l = label.value.trim()
  try { localStorage.setItem(LABEL_KEY, l) } catch { /* remembering is a convenience only */ }
  if (l) await rate.run(l)
}
onMounted(() => { if (label.value.trim()) rate.run(label.value.trim()) })
const rateText = (r: { done: number; total: number; rate: number | null }, unit: string) => (r.rate == null ? `No ${unit}` : `${r.rate}% (${r.done}/${r.total} ${unit})`)
const releasedText = (r: { released: number; done: number; rate: number | null }, unit: string) => (r.rate == null ? `No done ${unit}` : `${r.rate}% (${r.released}/${r.done} ${unit})`)
type Release = 'all_released' | 'partial' | 'not_released' | 'no_info'
const releaseOrder: Release[] = ['all_released', 'partial', 'not_released', 'no_info']
const releaseLabel: Record<Release, string> = { all_released: 'All released', partial: 'Partial', not_released: 'Not released', no_info: 'No release info' }
const releaseColor: Record<Release, 'green' | 'blue' | 'orange' | 'gray'> = { all_released: 'green', partial: 'blue', not_released: 'orange', no_info: 'gray' }
const rateValue = computed(() => {
  const r = rate.data.value
  return r && r.tickets.rate != null ? `${r.label}: ${r.tickets.rate}% tickets (${r.tickets.done}/${r.tickets.total}), ${r.storyPoints.rate ?? 0}% SP` : ''
})

const aside = css({ display: 'flex', flexDirection: 'column', gap: '4', minWidth: 0, xl: { position: 'sticky', top: '6' } })
const card = `${ui.card} ${css({ display: 'flex', flexDirection: 'column', gap: '3', p: '4' })}`
const row = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', py: '2', borderTopWidth: '1px', borderColor: 'border.default.subtle' })
const rowBtn = css({ ...{ width: '100%', textAlign: 'left', cursor: 'pointer', rounded: 'md', px: '1' }, _hover: { bg: 'background.neutral.subtle.hovered' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused' } })
const grow = css({ minWidth: 0, flex: 1 })
const trunc = `${ui.link} ${css({ display: 'block', truncate: true })}`
const head = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '2' })
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
      <section :class="card" data-test="epics">
        <div :class="head">
          <div>
            <MpText weight="semiBold">Jira epics</MpText>
            <MpText size="label-small" color="text.secondary">Worked on in {{ data.period }}</MpText>
          </div>
          <MpButton v-if="canAddInitiatives && data.epics.length" size="sm" variant="secondary" data-test="add-epics" @click="epicsOpen = true">Add initiatives</MpButton>
        </div>
        <MpText v-if="data.errors.epics" size="label" :class="problem">Epics could not be loaded: {{ data.errors.epics }}</MpText>
        <MpText v-else-if="!data.epics.length" size="label" color="text.secondary">No epics found for this quarter.</MpText>
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
        <MpButton v-if="data.epics.length > LIMIT" size="sm" variant="textLink" @click="allEpics = !allEpics">{{ allEpics ? 'Show fewer' : `Show all ${data.epics.length}` }}</MpButton>
      </section>

      <section :class="card" data-test="pages">
        <div>
          <MpText weight="semiBold">Confluence (last 3 months)</MpText>
          <MpText size="label-small" color="text.secondary">Pages you created or edited</MpText>
        </div>
        <div v-if="data.errors.pages" :class="css({ display: 'flex', flexDirection: 'column', gap: '2', alignItems: 'flex-start' })">
          <MpText size="label" :class="problem">Confluence could not be loaded. Try again in a moment.</MpText>
          <MpButton size="sm" variant="secondary" @click="run">Try again</MpButton>
        </div>
        <MpText v-else-if="!data.pages.length" size="label" color="text.secondary">No pages in the last 3 months.</MpText>
        <div v-for="p in pageList" :key="p.id" :class="row">
          <div :class="grow">
            <a v-if="isHttpUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer" :title="p.title" :class="trunc">{{ p.title }}</a>
            <MpText v-else size="label" weight="semiBold">{{ p.title }}</MpText>
            <div :class="meta">
              <MpBadge size="sm" variant="subtle" variant-color="gray">{{ kindLabel[p.kind] }}</MpBadge>
              <MpText size="label-small" color="text.secondary">{{ p.space ?? '-' }} · {{ formatDate(p.lastModified) }}</MpText>
            </div>
          </div>
          <MpButton size="sm" variant="ghost" @click="openPicker(p.title, p.url)">Add to…</MpButton>
          <MpButton size="sm" variant="ghost" left-icon="copy" aria-label="Copy link" title="Copy link" @click="copyText(p.url)" />
        </div>
        <MpButton v-if="data.pages.length > LIMIT" size="sm" variant="textLink" @click="allPages = !allPages">{{ allPages ? 'Show fewer' : `Show all ${data.pages.length}` }}</MpButton>
      </section>

      <section :class="card" data-test="delivery">
        <div>
          <MpText weight="semiBold">Story points &amp; tickets</MpText>
          <MpText size="label-small" color="text.secondary">Resolved by you in {{ data.period }}. Select a month for the tickets.</MpText>
        </div>
        <MpText v-if="data.errors.delivery" size="label" :class="problem">Delivery could not be loaded: {{ data.errors.delivery }}</MpText>
        <button v-for="d in data.delivery" :key="d.month" type="button" :class="[row, rowBtn]" :data-month="d.month" @click="openMonth(d.month)">
          <MpText size="label">{{ monthLabel(d.month) }}</MpText>
          <MpText size="label" color="text.secondary">{{ d.storyPoints }} SP · {{ plural(d.tickets, 'ticket') }} ›</MpText>
        </button>
      </section>

      <section :class="card" data-test="bugs">
        <div>
          <MpText weight="semiBold">Bugs by priority</MpText>
          <MpText size="label-small" color="text.secondary">Assigned to you and created in {{ data.period }}</MpText>
        </div>
        <MpText v-if="data.errors.bugs" size="label" :class="problem">Bugs could not be loaded: {{ data.errors.bugs }}</MpText>
        <MpText v-else-if="!data.bugs || !data.bugs.total" size="label" color="text.secondary">No bugs assigned to you were created this quarter.</MpText>
        <template v-else>
          <div v-for="b in data.bugs.items" :key="b.priority" :class="row">
            <MpText size="label" :title="b.priority">{{ b.label }}</MpText>
            <MpText size="label" weight="semiBold">{{ b.count }}</MpText>
          </div>
          <div :class="meta">
            <a :href="data.bugs.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton size="sm" variant="ghost" @click="openPicker('Bugs by priority', data.bugs.url, data.bugs.value)">Add to…</MpButton>
          </div>
        </template>
      </section>

      <section :class="card" data-test="rate">
        <div>
          <MpText weight="semiBold">Team delivery rate</MpText>
          <MpText size="label-small" color="text.secondary">Done over total for a Jira label, whole team, {{ data.period }}</MpText>
        </div>
        <form :class="css({ display: 'flex', gap: '2' })" @submit.prevent="applyLabel">
          <MpInput v-model="label" placeholder="Jira label" aria-label="Jira label" maxlength="100" />
          <MpButton type="submit" variant="secondary" :is-loading="rate.loading.value">Show</MpButton>
        </form>
        <MpText v-if="rate.error.value" size="label" :class="problem">{{ (rate.error.value as Error).message }}</MpText>
        <template v-else-if="rate.data.value">
          <div :class="css({ display: 'flex', flexDirection: 'column', gap: '1' })">
            <MpText size="label">By tickets: <b>{{ rateText(rate.data.value.tickets, 'tickets') }}</b></MpText>
            <MpText size="label">By story points: <b>{{ rateText(rate.data.value.storyPoints, 'SP') }}</b></MpText>
            <MpText size="label-small" color="text.secondary" data-test="rate-excluded">
              Not counted: {{ plural(rate.data.value.excluded.epics, 'epic') }}, {{ rate.data.value.excluded.wontFix }} Won't Fix. Open tickets not touched this quarter are left out.
            </MpText>
            <MpText v-if="rate.data.value.truncated" size="label-small" color="text.secondary">Only the first 1000 tickets were counted.</MpText>
          </div>
          <div :class="css({ display: 'flex', flexDirection: 'column', gap: '1' })" data-test="rate-released">
            <MpText size="label">Released (of done): <b>{{ releasedText(rate.data.value.released.tickets, 'tickets') }}</b></MpText>
            <MpText size="label">Released by story points: <b>{{ releasedText(rate.data.value.released.storyPoints, 'SP') }}</b></MpText>
            <MpText size="label-small" color="text.secondary">
              Released = fix version marked released in Jira. {{ plural(rate.data.value.released.tickets.noVersion, 'done ticket') }} without a fix version, not assumed released.
            </MpText>
          </div>
          <div v-if="rate.data.value.epics.length" :class="css({ display: 'flex', flexDirection: 'column' })" data-test="rate-epics">
            <MpText size="label" weight="semiBold">Epics with this label</MpText>
            <div :class="meta">
              <MpBadge v-for="r in releaseOrder" :key="r" size="sm" variant="subtle" :variant-color="releaseColor[r]">{{ rate.data.value.epicSummary[r] }} {{ releaseLabel[r] }}</MpBadge>
            </div>
            <div v-for="e in rate.data.value.epics" :key="e.key" :class="row">
              <div :class="grow">
                <a :href="e.url" target="_blank" rel="noopener noreferrer" :title="e.summary" :class="trunc">{{ e.summary }}</a>
                <MpText size="label-small" color="text.secondary">{{ e.key }} · {{ e.children.done }}/{{ e.children.total }} done · {{ e.children.released }} released</MpText>
              </div>
              <MpBadge size="sm" variant="subtle" :variant-color="releaseColor[e.release]">{{ releaseLabel[e.release] }}</MpBadge>
            </div>
            <MpText v-if="rate.data.value.epicsTruncated" size="label-small" color="text.secondary">Some epic children were not loaded, so statuses may be incomplete.</MpText>
          </div>
          <div :class="meta">
            <a :href="rate.data.value.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
            <MpButton size="sm" variant="ghost" :is-disabled="!rateValue" @click="openPicker(`Delivery rate: ${rate.data.value.label}`, rate.data.value.url, rateValue)">Add to…</MpButton>
          </div>
        </template>
      </section>
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
