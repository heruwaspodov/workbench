<script setup lang="ts">
import { MpBadge, MpText, css } from '@mekari/pixel3'
import { computed } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import { formatDate } from '@/lib/format'
import { ui } from '@/lib/ui'
import { type Initiative, STATUS_COLOR, progressText } from './types'

const props = defineProps<{ rows: Initiative[] }>()
const emit = defineEmits<{ open: [row: Initiative] }>()

/** Usual order first; any other status the data uses follows alphabetically. */
const ORDER = ['to do', 'backlog', 'open', 'in progress', 'development', 'in testing', 'done']
const columns = computed(() => {
  const groups = new Map<string, Initiative[]>()
  for (const r of props.rows) groups.set(r.epicStatus, [...(groups.get(r.epicStatus) ?? []), r])
  const rank = (s: string) => { const i = ORDER.indexOf(s.toLowerCase()); return i === -1 ? ORDER.length : i }
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([status, items]) => ({ status, items }))
})

const board = css({ display: 'flex', gap: '4', alignItems: 'flex-start', overflowX: 'auto', pb: '2' })
const column = css({ flex: '0 0 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3' })
const colHead = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', px: '1' })
const card = `${ui.card} ${css({ p: '4', display: 'flex', flexDirection: 'column', gap: '2', textAlign: 'left', width: '100%' })}`
const clickable = css({ cursor: 'pointer', _hover: { borderColor: 'border.default' } })
const meta = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
</script>

<template>
  <AsyncState :empty="rows.length === 0" empty-text="No initiatives match these filters.">
    <div :class="board" data-test="view-kanban">
      <section v-for="c in columns" :key="c.status" :class="column" :data-column="c.status">
        <div :class="colHead">
          <MpText weight="semiBold">{{ c.status }}</MpText>
          <MpBadge size="sm" variant="subtle" variant-color="gray">{{ c.items.length }}</MpBadge>
        </div>
        <button v-for="r in c.items" :key="r.id" type="button" :class="[card, clickable]" data-card @click="emit('open', r)">
          <MpText weight="semiBold">{{ r.title }}</MpText>
          <div :class="meta">
            <MpText size="label-small" color="text.secondary">{{ r.jiraKey }}</MpText>
            <MpBadge size="sm" variant="subtle" :variant-color="STATUS_COLOR[r.statusCategory]">{{ r.projectStatus || r.epicStatus }}</MpBadge>
          </div>
          <div :class="meta">
            <MpText size="label-small" color="text.secondary">{{ r.squad ?? 'Unassigned' }}</MpText>
            <MpBadge v-if="r.criticality" size="sm" variant="subtle" :variant-color="r.criticality === 'Strategic' ? 'blue' : 'gray'">{{ r.criticality }}</MpBadge>
          </div>
          <MpText size="label-small" color="text.secondary">{{ [r.ownerName ?? 'No owner', r.totalItems ? progressText(r) : null].filter(Boolean).join(' · ') }}</MpText>
          <MpText v-if="r.estDeliveryDate" size="label-small" color="text.secondary">Est. {{ formatDate(r.estDeliveryDate) }}</MpText>
          <div v-if="r.anomalies.length || r.needsReview" :class="meta">
            <MpBadge v-if="r.anomalies.length" size="sm" variant="subtle" variant-color="orange">{{ r.anomalies.length }} open</MpBadge>
            <MpBadge v-if="r.needsReview" size="sm" variant="subtle" variant-color="orange">Needs review</MpBadge>
          </div>
        </button>
      </section>
    </div>
  </AsyncState>
</template>
