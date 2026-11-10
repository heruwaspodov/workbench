<script setup lang="ts">
/**
 * PGP items, shared by templates and plans. Rows that share an objective and key result form one group card:
 * the group header edits objective and key result for the whole group, each row is one initiative.
 * - mode "template": planning fields only
 * - mode "plan": planning + monitoring fields; `lockPlanning` freezes the planning fields (submitted plan)
 */
import { MpBadge, MpButton, MpInput, MpSelect, MpText, MpTextarea, css } from '@mekari/pixel3'
import { computed } from 'vue'
import EvidenceLinks from './EvidenceLinks.vue'
import RowActions from './RowActions.vue'
import { ui } from '@/lib/ui'
import { type EditableItem, STATUS_OPTIONS, newKey, statusMeta, totals } from '@/lib/pgp'

const props = defineProps<{ mode: 'template' | 'plan'; lockPlanning?: boolean; readonly?: boolean }>()
const items = defineModel<EditableItem[]>({ required: true })

const isPlan = computed(() => props.mode === 'plan')
const planningLocked = computed(() => Boolean(props.readonly || props.lockPlanning))
const sum = computed(() => totals(items.value))

interface Group { key: string; objective: string; keyResult: string; rows: { i: number; it: EditableItem }[] }
const groups = computed<Group[]>(() => {
  const out: Group[] = []
  items.value.forEach((it, i) => {
    const last = out[out.length - 1]
    if (last && last.objective === it.objective && last.keyResult === it.keyResult) last.rows.push({ i, it })
    else out.push({ key: it._key, objective: it.objective, keyResult: it.keyResult, rows: [{ i, it }] })
  })
  return out
})
const groupWeight = (g: Group) => Math.round(g.rows.reduce((s, r) => s + (Number(r.it.weight) || 0), 0) * 100) / 100
const groupScore = (g: Group) => Math.round(g.rows.reduce((s, r) => s + Math.min(Number(r.it.achievement) || 0, Number(r.it.weight) || 0), 0) * 100) / 100

const num = (v: unknown) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown) => (String(v ?? '').trim() === '' ? null : num(v))

function patch(idx: number, change: Partial<EditableItem>) {
  items.value = items.value.map((it, i) => (i === idx ? { ...it, ...change } : it))
}
function patchGroup(g: Group, change: Partial<EditableItem>) {
  const at = new Set(g.rows.map((r) => r.i))
  items.value = items.value.map((it, i) => (at.has(i) ? { ...it, ...change } : it))
}
function addInitiative(g: Group) {
  const last = g.rows[g.rows.length - 1]!
  const row: EditableItem = {
    _key: newKey(), companyOkr: last.it.companyOkr ?? null, objective: g.objective, keyResult: g.keyResult,
    weight: 0, initiative: '', status: 'not_started', evidenceLinks: [],
  }
  const next = [...items.value]
  next.splice(last.i + 1, 0, row)
  items.value = next
}
function addObjective() {
  items.value = [...items.value, { _key: newKey(), objective: '', keyResult: '', weight: 0, initiative: '', status: 'not_started', evidenceLinks: [] }]
}
const remove = (idx: number) => { items.value = items.value.filter((_, i) => i !== idx) }
function move(idx: number, dir: -1 | 1) {
  const j = idx + dir
  if (j < 0 || j >= items.value.length) return
  const next = [...items.value]
  ;[next[idx], next[j]] = [next[j]!, next[idx]!]
  items.value = next
}
const setField = (idx: number, field: 'startValue' | 'targetValue' | 'currentValue', v: string) => patch(idx, { [field]: v || null })
const setStatus = (idx: number, e: Event) => patch(idx, { status: (e.target as HTMLSelectElement).value as EditableItem['status'] })

const stack = css({ display: 'flex', flexDirection: 'column', gap: '4' })
const groupHead = css({
  display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto' }, columnGap: '4', rowGap: '2', alignItems: 'start',
  bg: 'background.surface', px: '4', py: '3',
})
const headText = css({ display: 'flex', flexDirection: 'column', gap: '2', minWidth: 0 })
const headMeta = css({ display: 'flex', gap: '5', alignItems: 'baseline' })
const metaItem = css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5' })
const rowBase = {
  columnGap: '3', rowGap: '3', px: '4', py: '4', borderTopWidth: '1px', borderColor: 'border.default.subtle', alignItems: 'start', display: 'grid',
} as const
// Initiative text gets the full card width; weight, achievement, status and the row actions sit on the line below it.
const rowPlan = css({ ...rowBase, gridTemplateColumns: { base: 'repeat(2, minmax(0, 1fr))', lg: '88px 88px 160px minmax(0, 1fr)' } })
const rowTemplate = css({ ...rowBase, gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: '96px minmax(0, 1fr)' } })
const full = css({ gridColumn: '1 / -1' })
const field = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0 })
const actionsCell = css({ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gridColumn: { base: '1 / -1', lg: 'auto' }, alignSelf: 'stretch' })

const monitor = css({
  gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: { base: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
  columnGap: '3', rowGap: '3', bg: 'background.surface', rounded: 'lg', p: '3',
})
const groupFoot = css({ borderTopWidth: '1px', borderColor: 'border.default.subtle', px: '3', py: '2' })
const pre = css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const compactTa = css({ '& textarea': { minHeight: '56px !important' } })
/** Textarea height that follows the text, so long initiatives are readable without dragging the corner. */
const rowsFor = (text: string | null | undefined, perLine: number, min = 2, max = 8) => {
  const t = text ?? ''
  return Math.min(max, Math.max(min, Math.ceil(t.length / perLine) + (t.split('\n').length - 1)))
}
const bar = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '3' })
const empty = css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3', p: '6' })
</script>

<template>
  <div :class="stack">
    <section v-for="g in groups" :key="g.key" :class="ui.panel">
      <header :class="groupHead">
        <div :class="headText">
          <template v-if="planningLocked">
            <MpText weight="semiBold">{{ g.objective || 'Untitled objective' }}</MpText>
            <MpText size="label" color="text.secondary" :class="pre">{{ g.keyResult }}</MpText>
          </template>
          <template v-else>
            <MpInput :model-value="g.objective" placeholder="Objective" @update:model-value="(v: string) => patchGroup(g, { objective: v })" />
            <MpTextarea :model-value="g.keyResult" placeholder="Key result" :class="compactTa" :rows="rowsFor(g.keyResult, 110, 1)" @update:model-value="(v: string) => patchGroup(g, { keyResult: v })" />
          </template>
        </div>
        <div :class="headMeta">
          <div :class="metaItem">
            <MpText size="label-small" color="text.secondary">Weight</MpText>
            <MpText weight="semiBold">{{ groupWeight(g) }}%</MpText>
          </div>
          <div v-if="isPlan" :class="metaItem">
            <MpText size="label-small" color="text.secondary">Score</MpText>
            <MpText weight="semiBold">{{ groupScore(g) }}%</MpText>
          </div>
        </div>
      </header>

      <div v-for="r in g.rows" :key="r.it._key" :class="isPlan ? rowPlan : rowTemplate">
        <label :class="[field, full]">
          <MpText size="label-small" color="text.secondary">Initiative</MpText>
          <MpText v-if="planningLocked" size="label" :class="pre">{{ r.it.initiative || '-' }}</MpText>
          <MpTextarea v-else placeholder="Initiative / measurable target" :class="compactTa" :rows="rowsFor(r.it.initiative, 110)" :model-value="r.it.initiative"
            @update:model-value="(v: string) => patch(r.i, { initiative: v })" />
        </label>

        <label :class="field">
          <MpText size="label-small" color="text.secondary">Weight %</MpText>
          <MpText v-if="planningLocked" size="label">{{ r.it.weight }}%</MpText>
          <MpInput v-else size="sm" type="number" min="0" max="100" step="0.5" :model-value="r.it.weight"
            @update:model-value="(v: string) => patch(r.i, { weight: num(v) })" />
        </label>

        <template v-if="isPlan">
          <label :class="field" data-field="achievement">
            <MpText size="label-small" color="text.secondary">Achv %</MpText>
            <MpText v-if="readonly" size="label">{{ r.it.achievement != null ? `${r.it.achievement}%` : '-' }}</MpText>
            <MpInput v-else size="sm" type="number" min="0" :max="r.it.weight" step="0.5" :model-value="r.it.achievement ?? ''"
              :is-invalid="(r.it.achievement ?? 0) > r.it.weight" @update:model-value="(v: string) => patch(r.i, { achievement: numOrNull(v) })" />
          </label>

          <label :class="field">
            <MpText size="label-small" color="text.secondary">Status</MpText>
            <MpBadge v-if="readonly" variant="subtle" :variant-color="statusMeta(r.it.status ?? 'not_started').color" :class="css({ alignSelf: 'flex-start' })">
              {{ statusMeta(r.it.status ?? 'not_started').label }}
            </MpBadge>
            <MpSelect v-else size="sm" :model-value="r.it.status ?? 'not_started'" @change="(e: Event) => setStatus(r.i, e)">
              <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </MpSelect>
          </label>
        </template>

        <div v-if="!planningLocked" :class="actionsCell">
          <RowActions :index="r.i" :count="items.length" @move="move" @remove="remove" />
        </div>

        <div v-if="isPlan" :class="monitor">
          <label v-for="f in ([['startValue', 'Baseline'], ['targetValue', 'Target'], ['currentValue', 'Current']] as const)" :key="f[0]" :class="field">
            <MpText size="label-small" color="text.secondary">{{ f[1] }}</MpText>
            <MpText v-if="readonly" size="label" :class="pre">{{ r.it[f[0]] || '-' }}</MpText>
            <MpInput v-else size="sm" :model-value="r.it[f[0]] ?? ''" @update:model-value="(v: string) => setField(r.i, f[0], v)" />
          </label>
          <label :class="[field, full]">
            <MpText size="label-small" color="text.secondary">Evidence (one link per line)</MpText>
            <EvidenceLinks :links="r.it.evidenceLinks ?? []" :readonly="readonly" @update="(links: string[]) => patch(r.i, { evidenceLinks: links })" />
          </label>
        </div>
      </div>

      <div v-if="!planningLocked" :class="groupFoot">
        <MpButton variant="ghost" size="sm" left-icon="add" @click="addInitiative(g)">Add initiative</MpButton>
      </div>
    </section>

    <div v-if="!groups.length" :class="[ui.panel, empty]">
      <MpText color="text.secondary">No items yet. Add an objective to start this {{ isPlan ? 'plan' : 'template' }}.</MpText>
      <MpButton v-if="!planningLocked" variant="secondary" left-icon="add" @click="addObjective">Add objective</MpButton>
    </div>

    <div v-else :class="bar">
      <MpButton v-if="!planningLocked" variant="secondary" size="sm" left-icon="add" @click="addObjective">Add objective</MpButton>
      <span v-else />
      <MpText size="label">
        Total weight
        <MpText as="span" size="label" weight="semiBold" :color="sum.weight === 100 ? 'text.success' : 'text.danger'">{{ sum.weight }}%</MpText>
        <template v-if="isPlan"> · Score <MpText as="span" size="label" weight="semiBold">{{ sum.score }}%</MpText></template>
      </MpText>
    </div>
  </div>
</template>
