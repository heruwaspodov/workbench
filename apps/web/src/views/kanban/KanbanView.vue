<script setup lang="ts">
import { MpBadge, MpButton, MpButtonGroup, MpInput, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
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

const toolbar = css({ display: 'flex', gap: '3', alignItems: 'center', mb: '4', flexWrap: 'wrap' })
const board = css({ display: 'flex', gap: '4', overflowX: 'auto', pb: '4', alignItems: 'flex-start' })
const column = css({ width: '300px', flexShrink: 0, bg: 'background.neutral.subtle', rounded: 'lg', p: '3', display: 'flex', flexDirection: 'column', gap: '2', maxHeight: 'calc(100vh - 220px)' })
const columnHead = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: '1', mb: '1' })
const cards = css({ display: 'flex', flexDirection: 'column', gap: '2', overflowY: 'auto' })
const card = css({
  bg: 'background.surface', rounded: 'md', borderWidth: '1px', borderColor: 'border.default', p: '3', cursor: 'pointer', textAlign: 'left',
  display: 'flex', flexDirection: 'column', gap: '2', _hover: { borderColor: 'border.focused', shadow: 'sm' },
})
const cardFoot = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2' })
const typeIcon = css({ width: '4', height: '4' })
</script>

<template>
  <PageHeader title="My Kanban" :subtitle="data?.board ? `Board: ${data.board.name}` : 'Issue Jira yang di-assign ke kamu'">
    <MpButton variant="secondary" left-icon="refresh" :is-loading="loading" @click="run">Refresh</MpButton>
  </PageHeader>

  <div :class="toolbar">
    <MpButtonGroup>
      <MpButton size="sm" :variant="scope === 'sprint' ? 'primary' : 'secondary'" :is-disabled="data?.board?.scrum === false || data?.board === null" @click="scope = 'sprint'">Sprint aktif</MpButton>
      <MpButton size="sm" :variant="scope === 'active' ? 'primary' : 'secondary'" @click="scope = 'active'">Semua aktif + done 7 hari</MpButton>
    </MpButtonGroup>
    <MpInput v-model="search" size="sm" placeholder="Filter key / summary" :class="css({ maxWidth: '260px' })" is-clearable />
    <MpText size="label" color="text.secondary">{{ total }} issue</MpText>
  </div>

  <AsyncState :loading="loading && !data" :error="error" @retry="run">
    <div :class="board">
      <section v-for="col in columns" :key="col.name" :class="column">
        <div :class="columnHead">
          <MpText size="label" weight="semiBold">{{ col.name.toUpperCase() }}</MpText>
          <MpText size="label-small" color="text.secondary">{{ col.cards.length }} · {{ col.points }} SP</MpText>
        </div>
        <div :class="cards">
          <button v-for="c in col.cards" :key="c.key" type="button" :class="card" @click="selected = c.key">
            <MpText size="label">{{ c.summary }}</MpText>
            <div v-if="c.labels.length" :class="css({ display: 'flex', gap: '1', flexWrap: 'wrap' })">
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
            <MpText size="label-small" color="text.secondary">{{ timeAgo(c.updated) }}</MpText>
          </button>
          <MpText v-if="!col.cards.length" size="label-small" color="text.secondary" :class="css({ px: '1', py: '2' })">Kosong</MpText>
        </div>
      </section>
    </div>
  </AsyncState>

  <IssueDrawer :issue-key="selected" @close="selected = null" />
</template>
