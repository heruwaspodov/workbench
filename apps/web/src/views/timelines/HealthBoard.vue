<script setup lang="ts">
import { MpBadge, MpText, css } from '@mekari/pixel3'
import { computed, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { ui } from '@/lib/ui'
import { type Initiative, STATUS_COLOR, resolutionColor, statusText } from './types'

const props = defineProps<{ rows: Initiative[] }>()
const emit = defineEmits<{ open: [row: Initiative] }>()

/** Resolution is derived by the server: "Open" while an initiative has anything to act on. */
type Show = 'open' | 'all'
const show = ref<Show>('open')
const open = computed(() => props.rows.filter((r) => r.resolution === 'Open'))
const options = computed(() => [
  { value: 'open' as const, label: `Open (${open.value.length})` },
  { value: 'all' as const, label: `All initiatives (${props.rows.length})` },
])
const listed = computed(() => (show.value === 'open' ? [...open.value].sort((a, b) => b.anomalies.length - a.anomalies.length) : props.rows))

const bar = css({ mb: '4' })
const row = css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '3', alignItems: 'start', px: '4', py: '4', borderBottomWidth: '1px', borderColor: 'border.default.subtle' })
const main = css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2', textAlign: 'left' })
const meta = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
const reasons = css({ listStyle: 'disc', pl: '5', display: 'flex', flexDirection: 'column', gap: '1' })
const sheetBox = css({ display: 'flex', flexDirection: 'column', gap: '1', mt: '1' })
const pre = css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const link = css({ cursor: 'pointer', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%', fontWeight: 'semiBold', _hover: { textDecoration: 'underline' } })
</script>

<template>
  <div data-test="view-health">
    <SegmentedControl v-model="show" :options="options" label="Resolution status" :class="bar" />
    <AsyncState :empty="listed.length === 0" :empty-text="show === 'open' ? 'Nothing to resolve for these filters.' : 'No initiatives match these filters.'">
      <div :class="ui.panel">
        <div v-for="r in listed" :key="r.id" :class="row" data-row>
          <div :class="main">
            <button type="button" :class="link" data-test="open-initiative" @click="emit('open', r)">{{ r.title }}</button>
            <div :class="meta">
              <MpText size="label-small" color="text.secondary">{{ r.jiraKey }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ r.squad ?? 'Unassigned' }}</MpText>
              <MpBadge size="sm" variant="subtle" :variant-color="STATUS_COLOR[r.statusCategory]">{{ statusText(r) }}</MpBadge>
            </div>
            <ul v-if="r.anomalies.length" :class="reasons">
              <li v-for="a in r.anomalies" :key="a"><MpText size="label">{{ a }}</MpText></li>
            </ul>
            <MpText v-else size="label" color="text.secondary">Nothing to resolve.</MpText>
            <div v-if="r.sheetAnomalies || r.sheetResolution" :class="sheetBox" data-test="health-sheet">
              <div :class="meta">
                <MpText size="label-small" color="text.secondary">From the sheet</MpText>
                <MpBadge v-if="r.sheetResolution" size="sm" variant="subtle" :variant-color="resolutionColor(r.sheetResolution)">{{ r.sheetResolution }}</MpBadge>
              </div>
              <MpText v-if="r.sheetAnomalies" size="label" :class="pre">{{ r.sheetAnomalies }}</MpText>
            </div>
          </div>
          <MpBadge variant="subtle" :variant-color="r.resolution === 'Open' ? 'orange' : 'green'">{{ r.resolution === 'Open' ? 'Open' : 'Healthy' }}</MpBadge>
        </div>
      </div>
    </AsyncState>
  </div>
</template>
