<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpButton, MpFormControl, MpFormLabel, MpInput, MpProgress, MpText, css,
} from '@mekari/pixel3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import ItemsEditor from '@/components/ItemsEditor.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import { type EditableItem, stripKeys, toEditable, totals } from '@/lib/pgp'
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

// Jira delivery stats as evidence helper (silently hidden when Jira isn't connected)
const stats = ref<{ month: string; tickets: number; storyPoints: number }[]>([])
watch(plan, async (p) => { if (p?.canEdit && !stats.value.length) stats.value = await unwrap(api.kanban.stats.get()).catch(() => []) }, { once: true })
// Confluence pages the user touched recently, as ready-to-copy evidence links (owner only, hidden when unavailable)
type Doc = { id: string; title: string; space: string | null; url: string; lastModified: string | null }
const docs = ref<Doc[] | null>(null)
watch(plan, async (p) => {
  if (!p?.canEdit) return
  docs.value = (await unwrap(api.confluence.pages.get({ query: { role: 'contributor', days: 90, pagelen: 8 } })).catch(() => null))?.items ?? null
}, { once: true })
const monthLabel = (m: string) => new Date(`${m}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault() }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => !dirty.value || window.confirm('You have unsaved changes. Leave this page?'))

// Layout: plan details and items on the left; evidence sources (Jira, Confluence) beside them on wide screens, below on narrow ones.
const layout = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', xl: 'minmax(0, 1fr) 320px' }, columnGap: '6', rowGap: '5', alignItems: 'start' })
const mainCol = css({ display: 'flex', flexDirection: 'column', gap: '5', minWidth: 0 })
const details = `${ui.card} ${css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: '200px minmax(0, 1fr)' }, columnGap: '6', rowGap: '5' })}`
const scoreBlock = css({ display: 'flex', flexDirection: 'column', gap: '2', lg: { borderRightWidth: '1px', borderColor: 'border.default.subtle', pr: '6' } })
const headerGrid = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })
const aside = css({ display: 'flex', flexDirection: 'column', gap: '4', minWidth: 0, xl: { position: 'sticky', top: '6' } })
const asideCard = `${ui.card} ${css({ display: 'flex', flexDirection: 'column', gap: '3', p: '4' })}`
const listRow = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', py: '2', borderTopWidth: '1px', borderColor: 'border.default.subtle' })
const docLink = `${ui.link} ${css({ display: 'block', truncate: true })}`
const grow = css({ minWidth: 0, flex: 1 })
</script>

<template>
  <AsyncState :loading="loading && !plan" :error="error" @retry="run">
    <template v-if="plan">
      <PageHeader :title="plan.template.title" :subtitle="`${plan.user.name} · ${plan.template.period}`">
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

        <aside v-if="plan.canEdit" :class="aside" aria-label="Evidence sources">
          <section :class="asideCard">
            <div>
              <MpText weight="semiBold">Jira delivery</MpText>
              <MpText size="label-small" color="text.secondary">Resolved issues, last 3 months</MpText>
            </div>
            <template v-if="stats.length">
              <div v-for="s in stats" :key="s.month" :class="listRow">
                <MpText size="label">{{ monthLabel(s.month) }}</MpText>
                <MpText size="label" color="text.secondary">{{ s.storyPoints }} SP · {{ s.tickets }} {{ s.tickets === 1 ? 'ticket' : 'tickets' }}</MpText>
              </div>
            </template>
            <MpText v-else size="label" color="text.secondary">
              Nothing to show yet. Connect Jira in <RouterLink to="/connections" :class="ui.link">Connections</RouterLink> to see your story points.
            </MpText>
          </section>

          <section v-if="docs" :class="asideCard">
            <div>
              <MpText weight="semiBold">Confluence pages</MpText>
              <MpText size="label-small" color="text.secondary">Created or edited in the last 90 days. Copy a link into Evidence.</MpText>
            </div>
            <MpText v-if="!docs.length" size="label" color="text.secondary">No pages in the last 90 days.</MpText>
            <div v-for="d in docs" :key="d.id" :class="listRow">
              <div :class="grow">
                <a v-if="isHttpUrl(d.url)" :href="d.url" target="_blank" rel="noopener noreferrer" :title="d.title" :class="docLink">{{ d.title }}</a>
                <MpText v-else size="label" weight="semiBold">{{ d.title }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ d.space ?? '-' }} · {{ formatDate(d.lastModified) }}</MpText>
              </div>
              <MpButton size="sm" variant="ghost" left-icon="copy" aria-label="Copy link" title="Copy link" @click="copyText(d.url)" />
            </div>
            <RouterLink to="/confluence" :class="ui.link">View all pages</RouterLink>
          </section>
        </aside>
      </div>
    </template>
  </AsyncState>
</template>
