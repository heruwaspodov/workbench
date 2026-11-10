<script setup lang="ts">
/**
 * Spreadsheet-like editor for PGP items, shared by templates and plans.
 * - mode "template": planning columns only
 * - mode "plan": planning + monitoring columns; `lockPlanning` freezes planning columns (submitted plan)
 */
import {
  MpBadge, MpButton, MpInput, MpSelect, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow,
  MpText, MpTextarea, css,
} from '@mekari/pixel3'
import { computed, ref } from 'vue'
import EvidenceLinks from './EvidenceLinks.vue'
import RowActions from './RowActions.vue'
import { type EditableItem, STATUS_OPTIONS, newKey, statusMeta, totals } from '@/lib/pgp'

const props = defineProps<{ mode: 'template' | 'plan'; lockPlanning?: boolean; readonly?: boolean }>()
const items = defineModel<EditableItem[]>({ required: true })

const PROGRESS_FIELDS = ['startValue', 'targetValue', 'currentValue'] as const

const isPlan = computed(() => props.mode === 'plan')
const planningLocked = computed(() => props.readonly || props.lockPlanning)
const sum = computed(() => totals(items.value))

/** First row of a run of identical objective / KR is where we print the group label in read-only mode. */
const isGroupStart = (idx: number, key: 'objective' | 'keyResult') =>
  idx === 0 || items.value[idx - 1]![key] !== items.value[idx]![key] || (key === 'keyResult' && items.value[idx - 1]!.objective !== items.value[idx]!.objective)

/** Rows that repeat the previous row's objective and KR collapse to a compact line while editing. */
const isContinuation = (idx: number) =>
  idx > 0 && items.value[idx - 1]!.objective === items.value[idx]!.objective && items.value[idx - 1]!.keyResult === items.value[idx]!.keyResult
const startsObjective = (idx: number) => idx > 0 && items.value[idx - 1]!.objective !== items.value[idx]!.objective

const expanded = ref(new Set<string>())
const expand = (key: string) => { expanded.value = new Set(expanded.value).add(key) }
const collapsed = (idx: number) => isContinuation(idx) && !expanded.value.has(items.value[idx]!._key)

const num = (v: unknown) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown) => (String(v ?? '').trim() === '' ? null : num(v))

function patch(idx: number, change: Partial<EditableItem>) {
  items.value = items.value.map((it, i) => (i === idx ? { ...it, ...change } : it))
}
function addAfter(idx: number) {
  const base = items.value[idx]
  const row: EditableItem = {
    _key: newKey(), companyOkr: base?.companyOkr ?? null, objective: base?.objective ?? '', keyResult: base?.keyResult ?? '',
    weight: 0, initiative: '', status: 'not_started', evidenceLinks: [],
  }
  const next = [...items.value]
  next.splice(idx + 1, 0, row)
  items.value = next
}
function addNew() {
  items.value = [...items.value, { _key: newKey(), objective: '', keyResult: '', weight: 0, initiative: '', status: 'not_started', evidenceLinks: [] }]
}
function remove(idx: number) { items.value = items.value.filter((_, i) => i !== idx) }
function move(idx: number, dir: -1 | 1) {
  const j = idx + dir
  if (j < 0 || j >= items.value.length) return
  const next = [...items.value]
  ;[next[idx], next[j]] = [next[j]!, next[idx]!]
  items.value = next
}

const setField = (idx: number, field: (typeof PROGRESS_FIELDS)[number], v: string) => patch(idx, { [field]: v || null })

const setStatus = (idx: number, e: Event) =>
  patch(idx, { status: (e.target as HTMLSelectElement).value as EditableItem['status'] })


const wrap = css({ overflowX: 'auto', bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', shadow: 'xs' })
const th = css({ whiteSpace: 'nowrap' })
const progressTh = css({ whiteSpace: 'nowrap', bg: 'background.highlight !important' })
const cellTop = css({ verticalAlign: 'top' })
const groupTop = css({ '& > td': { borderTopWidth: '2px', borderTopColor: 'border.default' } })
const sameAsAbove = css({ display: 'flex', alignItems: 'center', gap: '2' })
const stack = css({ display: 'flex', flexDirection: 'column', gap: '1.5' })
const footer = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '3', p: '3', borderTopWidth: '1px', borderColor: 'border.default.subtle', flexWrap: 'wrap' })
const pre = css({ whiteSpace: 'pre-wrap' })
</script>

<template>
  <div :class="wrap">
    <MpTableContainer>
      <MpTable is-hoverable>
        <MpTableHead>
          <MpTableRow>
            <MpTableCell as="th" :class="th" :style="{ width: '40px' }">#</MpTableCell>
            <MpTableCell as="th" :class="th" :style="{ minWidth: '240px' }">Objective / Key Result</MpTableCell>
            <MpTableCell as="th" :class="th" :style="{ width: '96px' }">Weight %</MpTableCell>
            <MpTableCell as="th" :class="th" :style="{ minWidth: '300px' }">Initiative</MpTableCell>
            <template v-if="isPlan">
              <MpTableCell as="th" :class="progressTh" :style="{ minWidth: '120px' }">Baseline</MpTableCell>
              <MpTableCell as="th" :class="progressTh" :style="{ minWidth: '120px' }">Target</MpTableCell>
              <MpTableCell as="th" :class="progressTh" :style="{ minWidth: '140px' }">Current</MpTableCell>
              <MpTableCell as="th" :class="progressTh" :style="{ width: '104px' }">Achv %</MpTableCell>
              <MpTableCell as="th" :class="progressTh" :style="{ minWidth: '150px' }">Status</MpTableCell>
              <MpTableCell as="th" :class="progressTh" :style="{ minWidth: '240px' }">Evidence (one link per line)</MpTableCell>
            </template>
            <MpTableCell v-if="!readonly" as="th" :class="th" :style="{ width: '120px' }" />
          </MpTableRow>
        </MpTableHead>

        <MpTableBody>
          <MpTableRow v-for="(item, idx) in items" :key="item._key" :class="startsObjective(idx) && groupTop">
            <MpTableCell :class="cellTop"><MpText size="label" color="text.secondary">{{ idx + 1 }}</MpText></MpTableCell>

            <!-- Objective / KR -->
            <MpTableCell :class="cellTop">
              <div v-if="planningLocked" :class="stack">
                <MpText v-if="isGroupStart(idx, 'objective')" size="label" weight="semiBold">{{ item.objective }}</MpText>
                <MpText v-if="isGroupStart(idx, 'keyResult')" size="label" color="text.secondary" :class="pre">{{ item.keyResult }}</MpText>
              </div>
              <div v-else-if="collapsed(idx)" :class="sameAsAbove">
                <MpText size="label-small" color="text.secondary">↳ Same objective &amp; KR as above</MpText>
                <MpButton variant="ghost" size="sm" @click="expand(item._key)">Edit</MpButton>
              </div>
              <div v-else :class="stack">
                <MpInput size="sm" placeholder="Objective" :model-value="item.objective" @update:model-value="(v: string) => patch(idx, { objective: v })" />
                <MpTextarea placeholder="Key result" :model-value="item.keyResult" @update:model-value="(v: string) => patch(idx, { keyResult: v })" />
              </div>
            </MpTableCell>

            <!-- Weight -->
            <MpTableCell :class="cellTop">
              <MpText v-if="planningLocked" size="label">{{ item.weight }}%</MpText>
              <MpInput v-else size="sm" type="number" min="0" max="100" step="0.5" :model-value="item.weight"
                @update:model-value="(v: string) => patch(idx, { weight: num(v) })" />
            </MpTableCell>

            <!-- Initiative -->
            <MpTableCell :class="cellTop">
              <MpText v-if="planningLocked" size="label" :class="pre">{{ item.initiative }}</MpText>
              <MpTextarea v-else placeholder="Initiative / measurable target" :model-value="item.initiative"
                @update:model-value="(v: string) => patch(idx, { initiative: v })" />
            </MpTableCell>

            <!-- Monitoring columns -->
            <template v-if="isPlan">
              <MpTableCell v-for="field in PROGRESS_FIELDS" :key="field" :class="cellTop">
                <MpText v-if="readonly" size="label" :class="pre">{{ item[field] || '-' }}</MpText>
                <MpTextarea v-else :model-value="item[field] ?? ''" @update:model-value="(v: string) => setField(idx, field, v)" />
              </MpTableCell>
              <MpTableCell :class="cellTop">
                <MpText v-if="readonly" size="label">{{ item.achievement ?? '-' }}{{ item.achievement != null ? '%' : '' }}</MpText>
                <MpInput v-else size="sm" type="number" min="0" :max="item.weight" step="0.5" :model-value="item.achievement ?? ''"
                  :is-invalid="(item.achievement ?? 0) > item.weight"
                  @update:model-value="(v: string) => patch(idx, { achievement: numOrNull(v) })" />
                <MpText v-if="!readonly" size="label-small" color="text.secondary">max {{ item.weight }}</MpText>
              </MpTableCell>
              <MpTableCell :class="cellTop">
                <MpBadge v-if="readonly" variant="subtle" :variant-color="statusMeta(item.status ?? 'not_started').color">
                  {{ statusMeta(item.status ?? 'not_started').label }}
                </MpBadge>
                <MpSelect v-else size="sm" :model-value="item.status ?? 'not_started'"
                  @change="(e: Event) => setStatus(idx, e)">
                  <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </MpSelect>
              </MpTableCell>
              <MpTableCell :class="cellTop">
                <EvidenceLinks :links="item.evidenceLinks ?? []" :readonly="readonly" @update="(links: string[]) => patch(idx, { evidenceLinks: links })" />
              </MpTableCell>
            </template>

            <!-- Row actions -->
            <MpTableCell v-if="!readonly" :class="cellTop">
              <RowActions v-if="!planningLocked" :index="idx" :count="items.length"
                @add="addAfter" @move="move" @remove="remove" />
            </MpTableCell>
          </MpTableRow>

          <MpTableRow v-if="!items.length">
            <MpTableCell :colspan="isPlan ? 11 : 5">
              <MpText color="text.secondary">No items yet.</MpText>
            </MpTableCell>
          </MpTableRow>
        </MpTableBody>
      </MpTable>
    </MpTableContainer>

    <div :class="footer">
      <MpButton v-if="!planningLocked" variant="secondary" size="sm" left-icon="add" @click="addNew">Add item</MpButton>
      <span v-else />
      <div :class="css({ display: 'flex', gap: '4', alignItems: 'center' })">
        <MpText size="label">
          Total weight:
          <MpText as="span" size="label" weight="semiBold" :color="sum.weight === 100 ? 'text.success' : 'text.danger'">{{ sum.weight }}%</MpText>
        </MpText>
        <MpText v-if="isPlan" size="label">Score: <MpText as="span" size="label" weight="semiBold">{{ sum.score }}%</MpText></MpText>
      </div>
    </div>
  </div>
</template>
