<script setup lang="ts">
import { MpBadge, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css } from '@mekari/pixel3'
import { computed } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import { isoDay } from '@/lib/format'
import { ui } from '@/lib/ui'
import { type Initiative, STATUS_COLOR, statusText } from './types'
import { atRisk, currentWeekIndex, dayMonth, quarterWeeks, weekIndexOf } from './weeks'

const props = defineProps<{ rows: Initiative[]; year: number; quarter: number; today: string; canEdit: boolean }>()
const emit = defineEmits<{ edit: [row: Initiative] }>()

const layout = computed(() => quarterWeeks(props.year, props.quarter))
const current = computed(() => currentWeekIndex(layout.value.weeks, props.today))

interface Marker { kind: 'release' | 'self_test'; text: string }
/** Markers of one row, keyed by the index of the week they fall in. */
function markersByWeek(r: Initiative) {
  const byWeek = new Map<number, Marker[]>()
  for (const m of r.milestones) {
    const date = isoDay(m.date)
    const i = weekIndexOf(layout.value.weeks, date)
    byWeek.set(i, [...(byWeek.get(i) ?? []), { kind: m.kind as Marker['kind'], text: dayMonth(date) }])
  }
  return byWeek
}
const table = computed(() => props.rows.map((r) => ({ r, marks: markersByWeek(r) })))
const risky = computed(() => props.rows.filter((r) => atRisk({ ...r, milestones: r.milestones.map((m) => ({ kind: m.kind, date: isoDay(m.date) })) }, props.today)))

const wide = css({
  tableLayout: 'fixed', minWidth: '1080px',
  '& th, & td': { px: '1', textAlign: 'center' },
  '& thead th': { fontSize: 'xs', lineHeight: '1.25', whiteSpace: 'normal', py: '2' },
  '& tbody tr:hover > *': { bg: 'transparent' },
})
/** Keeps "5-9 Oct" and "30 Nov" in one piece so a narrow week column only breaks between the two halves of "30 Nov - 4 Dec". */
const nb = (range: string) => range.replace(/(\d) ([A-Z])/g, '$1\u00a0$2').replace(/(\d)-(\d)/g, '$1\u2011$2').replace(' - ', '\u00a0- ')
const nowrap = css({ whiteSpace: 'nowrap' })
const left = css({ textAlign: 'left !important' })
const now = css({ bg: 'background.information !important', color: 'text.link !important' })
const stack = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0 })
const metaRow = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })
const chip = css({ whiteSpace: 'normal', textAlign: 'center', lineHeight: '1.2', px: '1', display: 'inline-block' })
const cell = css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1' })
const head = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', flexWrap: 'wrap', px: '4', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle' })
const title = css({ display: 'block', textAlign: 'left', cursor: 'pointer', _hover: { textDecoration: 'underline' } })
</script>

<template>
  <AsyncState :empty="rows.length === 0" empty-text="No initiatives match these filters.">
    <div :class="ui.panel" data-test="view-timeline">
      <div :class="head">
        <MpText weight="semiBold">{{ year }} Q{{ quarter }} delivery timeline &amp; releases</MpText>
        <MpBadge variant="subtle" :variant-color="risky.length ? 'orange' : 'gray'" :title="risky.map((r) => r.jiraKey).join(', ')" data-test="goal-risk">
          Goal risk: progress under 50% with a release next week · {{ risky.length }}
        </MpBadge>
      </div>
      <MpTableContainer>
        <MpTable :class="[ui.table, wide]">
          <colgroup>
            <col style="width: 220px" />
            <col style="width: 72px" />
            <col v-for="w in layout.weeks" :key="w.index" />
          </colgroup>
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th" rowspan="2" :class="left">Initiative &amp; status</MpTableCell>
              <MpTableCell as="th" rowspan="2" :class="left">Squad</MpTableCell>
              <MpTableCell v-for="g in layout.groups" :key="g.label" as="th" colspan="4">{{ g.label }}</MpTableCell>
            </MpTableRow>
            <MpTableRow>
              <MpTableCell v-for="w in layout.weeks" :key="w.index" as="th" :class="w.index === current && now" :data-week="w.index" :title="w.index === current ? 'This week' : undefined">
                W{{ w.number }}<br />{{ nb(w.range) }}
              </MpTableCell>
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="{ r, marks } in table" :key="r.id" data-row>
              <MpTableCell :class="left">
                <div :class="stack">
                  <button v-if="canEdit" type="button" :class="[title, css({ fontWeight: 'semiBold' })]" @click="emit('edit', r)">{{ r.title }}</button>
                  <MpText v-else weight="semiBold" :class="title">{{ r.title }}</MpText>
                  <div :class="metaRow">
                    <MpText size="label-small" color="text.secondary">{{ r.jiraKey }}</MpText>
                    <MpBadge size="sm" variant="subtle" :variant-color="STATUS_COLOR[r.statusCategory]">{{ statusText(r) }}</MpBadge>
                  </div>
                </div>
              </MpTableCell>
              <MpTableCell :class="left"><MpText size="label">{{ r.squad ?? 'Unassigned' }}</MpText></MpTableCell>
              <MpTableCell v-for="w in layout.weeks" :key="w.index" :data-cell="`${r.jiraKey}:${w.index}`">
                <div v-if="marks.get(w.index)" :class="cell">
                  <MpBadge v-for="(m, i) in marks.get(w.index)" :key="i" size="sm" variant="subtle" :variant-color="m.kind === 'release' ? 'green' : 'gray'" :class="chip"
                    :data-marker="m.kind">
                    <span :class="nowrap">{{ m.kind === 'release' ? 'Release' : 'Self test' }}</span><br /><span :class="nowrap">{{ m.text }}</span>
                  </MpBadge>
                </div>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
    </div>
  </AsyncState>
</template>
