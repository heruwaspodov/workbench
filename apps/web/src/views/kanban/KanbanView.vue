<script setup lang="ts">
import { MpBadge, MpButton, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/SearchInput.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { api, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import IssueDrawer from './IssueDrawer.vue'

const scope = ref<'sprint' | 'active'>('sprint')
const search = ref('')
const selected = ref<string | null>(null)
const { data, loading, error, run } = useAsync(() => unwrap(api.kanban.get({ query: { scope: scope.value } })))
onMounted(run)
watch(scope, run)

const columns = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (data.value?.columns ?? []).map((c) => ({
    ...c,
    cards: q ? c.cards.filter((x) => x.key.toLowerCase().includes(q) || x.summary.toLowerCase().includes(q)) : c.cards,
    points: c.cards.reduce((s, x) => s + (x.storyPoints ?? 0), 0),
  }))
})
const total = computed(() => columns.value.reduce((s, c) => s + c.cards.length, 0))

const priorityColor = (p: string | null) => (p && /highest|high|critical|blocker/i.test(p) ? 'red' : p && /medium/i.test(p) ? 'orange' : 'gray')

const board = css({ display: 'flex', gap: '4', overflowX: 'auto', pb: '4', alignItems: 'flex-start' })
const column = css({ width: '300px', flexShrink: 0, bg: 'background.neutral.subtle', rounded: 'xl', p: '3', display: 'flex', flexDirection: 'column', gap: '3', maxHeight: 'calc(100vh - 240px)' })
const columnHead = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: '1' })
const cards = css({ display: 'flex', flexDirection: 'column', gap: '2', overflowY: 'auto', pb: '1' })
const card = css({
  bg: 'background.stage', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default.subtle', shadow: 'xs', p: '3', textAlign: 'left',
  display: 'flex', flexDirection: 'column', gap: '2',
})
const cardFoot = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2' })
const tags = css({ display: 'flex', gap: '1', flexWrap: 'wrap' })
const typeIcon = css({ width: '4', height: '4' })
const count = css({ bg: 'background.stage', rounded: 'full', px: '2', py: '0.5', borderWidth: '1px', borderColor: 'border.default.subtle' })
</script>

<template>
  <PageHeader title="My Kanban" :subtitle="data?.board ? `Board: ${data.board.name}` : 'Jira issues assigned to you'">
    <MpButton variant="secondary" left-icon="refresh" :is-loading="loading" @click="run">Refresh</MpButton>
  </PageHeader>

  <div :class="ui.toolbar">
    <SegmentedControl v-model="scope" label="Scope" :options="[
      { value: 'sprint', label: 'Active sprint', disabled: data?.board?.scrum === false || data?.board === null },
      { value: 'active', label: 'All active + done 7 days' },
    ]" />
    <div :class="ui.fieldWide"><SearchInput v-model="search" placeholder="Filter by key or summary" /></div>
    <MpText size="label" color="text.secondary">{{ total }} {{ total === 1 ? 'issue' : 'issues' }}</MpText>
  </div>

  <AsyncState :loading="loading && !data" :error="error" @retry="run">
    <div :class="board">
      <section v-for="col in columns" :key="col.name" :class="column">
        <div :class="columnHead">
          <MpText size="label" weight="semiBold">{{ col.name }}</MpText>
          <div :class="count"><MpText size="label-small" color="text.secondary">{{ col.cards.length }} · {{ col.points }} SP</MpText></div>
        </div>
        <div :class="cards">
          <button v-for="c in col.cards" :key="c.key" type="button" :class="[card, ui.lift]" @click="selected = c.key">
            <MpText size="label">{{ c.summary }}</MpText>
            <div v-if="c.labels.length" :class="tags">
              <MpBadge v-for="l in c.labels.slice(0, 3)" :key="l" size="sm" variant="subtle" variant-color="gray">{{ l }}</MpBadge>
            </div>
            <div :class="cardFoot">
              <div :class="css({ display: 'flex', gap: '1.5', alignItems: 'center' })">
                <img v-if="c.issueTypeIcon" :src="c.issueTypeIcon" :alt="c.issueType" :class="typeIcon" />
                <MpText size="label-small" color="text.secondary">{{ c.key }}</MpText>
              </div>
              <div :class="css({ display: 'flex', gap: '1', alignItems: 'center' })">
                <MpBadge v-if="c.priority" size="sm" variant="subtle" :variant-color="priorityColor(c.priority)">{{ c.priority }}</MpBadge>
                <MpBadge v-if="c.storyPoints != null" size="sm" variant="subtle" variant-color="blue">{{ c.storyPoints }}</MpBadge>
              </div>
            </div>
            <MpText size="label-small" color="text.secondary">Updated {{ timeAgo(c.updated) }}</MpText>
          </button>
          <MpText v-if="!col.cards.length" size="label-small" color="text.secondary" :class="css({ px: '1', py: '2' })">No issues</MpText>
        </div>
      </section>
    </div>
  </AsyncState>

  <IssueDrawer :issue-key="selected" @close="selected = null" />
</template>
