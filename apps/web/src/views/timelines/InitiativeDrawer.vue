<script setup lang="ts">
/** Add or edit one initiative (admin). The Jira key, year and quarter are chosen when adding and fixed afterwards. */
import {
  MpButton, MpDrawer, MpDrawerBody, MpDrawerCloseButton, MpDrawerContent, MpDrawerFooter, MpDrawerHeader, MpDrawerOverlay,
  MpFormControl, MpFormLabel, MpInput, MpSelect, MpText, MpTextarea, css,
} from '@mekari/pixel3'
import { computed, ref, watch } from 'vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { isoDay } from '@/lib/format'

type Row = NonNullable<Awaited<ReturnType<typeof api.initiatives.get>>['data']>[number]

const props = defineProps<{
  open: boolean
  /** The row being edited; null when adding. */
  initiative: Row | null
  /** Quarter to prefill when adding. */
  year: number
  quarter: number
  /** Statuses already used in the data, offered next to the usual ones. */
  statuses: string[]
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const editing = computed(() => props.initiative != null)
const KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/

interface Marker { kind: 'release' | 'self_test'; date: string }
const blank = () => ({
  year: String(props.year), quarter: String(props.quarter), jiraKey: '', title: '', squad: '', criticality: '', epicStatus: 'To Do', projectStatus: '',
  ownerName: '', estDeliveryDate: '', actualDeliveryDate: '', doneItems: '', totalItems: '', prdUrl: '', rfcUrl: '', remark: '', remarkProposed: '',
  needsReview: false, milestones: [] as Marker[],
})
const form = ref(blank())
const saving = ref(false)
const confirming = ref(false)

watch(() => [props.open, props.initiative] as const, ([open, row]) => {
  confirming.value = false
  if (!open) return
  form.value = row
    ? {
        year: String(row.year), quarter: String(row.quarter), jiraKey: row.jiraKey, title: row.title, squad: row.squad ?? '', criticality: row.criticality ?? '',
        epicStatus: row.epicStatus, projectStatus: row.projectStatus ?? '', ownerName: row.ownerName ?? '', estDeliveryDate: isoDay(row.estDeliveryDate),
        actualDeliveryDate: isoDay(row.actualDeliveryDate), doneItems: row.doneItems == null ? '' : String(row.doneItems),
        totalItems: row.totalItems == null ? '' : String(row.totalItems), prdUrl: row.prdUrl ?? '', rfcUrl: row.rfcUrl ?? '', remark: row.remark ?? '',
        remarkProposed: row.remarkProposed ?? '', needsReview: row.needsReview,
        milestones: row.milestones.map((m) => ({ kind: m.kind as Marker['kind'], date: isoDay(m.date) })),
      }
    : blank()
}, { immediate: true })

const withCurrent = (base: string[], current: string) => [...new Set([...base, ...(current ? [current] : [])])]
const statusOptions = computed(() => withCurrent([...new Set(['To Do', 'In Progress', 'In Testing', 'Development', 'Done', ...props.statuses])], form.value.epicStatus))
const criticalityOptions = computed(() => withCurrent(['Strategic', 'BaU'], form.value.criticality))

const text = (v: string) => v.trim() || null
const count = (v: string) => (v.trim() === '' ? null : Number(v))

const problem = computed(() => {
  const f = form.value
  if (!editing.value) {
    if (!/^20\d{2}$/.test(f.year)) return 'Enter a valid year, for example 2026'
    if (!KEY.test(f.jiraKey.trim())) return 'Enter a Jira key such as MESIGN-123'
  }
  if (!f.title.trim()) return 'Enter the initiative title'
  const done = count(f.doneItems), total = count(f.totalItems)
  for (const n of [done, total]) if (n != null && (!Number.isInteger(n) || n < 0)) return 'Items must be whole numbers'
  if (done != null && total == null) return 'Enter the total items as well'
  if (done != null && total != null && done > total) return 'Done items cannot be more than total items'
  if (f.milestones.some((m) => !m.date)) return 'Every release or self-test marker needs a date'
  return ''
})

function addMarker() { form.value.milestones.push({ kind: 'release', date: '' }) }
function removeMarker(i: number) { form.value.milestones.splice(i, 1) }

async function save() {
  if (problem.value) return notifyError(new Error(problem.value))
  const f = form.value
  const fields = {
    title: f.title.trim(), squad: text(f.squad), criticality: text(f.criticality), epicStatus: f.epicStatus.trim() || 'To Do',
    projectStatus: text(f.projectStatus), ownerName: text(f.ownerName), estDeliveryDate: text(f.estDeliveryDate), actualDeliveryDate: text(f.actualDeliveryDate),
    doneItems: count(f.doneItems), totalItems: count(f.totalItems), prdUrl: text(f.prdUrl), rfcUrl: text(f.rfcUrl),
    remark: text(f.remark), remarkProposed: text(f.remarkProposed), needsReview: f.needsReview,
    milestones: f.milestones.map((m) => ({ kind: m.kind, date: m.date })),
  }
  saving.value = true
  try {
    if (props.initiative) await unwrap(api.initiatives({ id: props.initiative.id }).patch(fields))
    else await unwrap(api.initiatives.post({ year: Number(f.year), quarter: Number(f.quarter), jiraKey: f.jiraKey.trim(), ...fields }))
    notifySuccess(editing.value ? 'Initiative updated' : 'Initiative added')
    emit('saved')
  } catch (e) { notifyError(e) } finally { saving.value = false }
}

async function remove() {
  if (!props.initiative) return
  saving.value = true
  try {
    await unwrap(api.initiatives({ id: props.initiative.id }).delete())
    notifySuccess('Initiative deleted')
    emit('saved')
  } catch (e) { notifyError(e) } finally { saving.value = false; confirming.value = false }
}

const grid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4', mb: '4' })
const stack = css({ display: 'flex', flexDirection: 'column', gap: '4', mb: '4' })
const marker = css({ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr) auto', gap: '3', alignItems: 'end', mb: '3' })
const check = css({ display: 'flex', alignItems: 'center', gap: '2', cursor: 'pointer' })
const foot = css({ display: 'flex', alignItems: 'center', gap: '3', width: '100%' })
const spacer = css({ flex: 1 })
</script>

<template>
  <MpDrawer :is-open="open" placement="right" size="lg" @close="!saving && emit('close')">
    <MpDrawerOverlay />
    <MpDrawerContent>
      <MpDrawerHeader>
        <MpText weight="semiBold">{{ editing ? `Edit ${initiative!.jiraKey}` : 'New initiative' }}</MpText>
        <MpDrawerCloseButton />
      </MpDrawerHeader>
      <MpDrawerBody data-test="initiative-form">
        <div v-if="!editing" :class="grid">
          <MpFormControl is-required>
            <MpFormLabel>Year</MpFormLabel>
            <MpInput v-model="form.year" inputmode="numeric" placeholder="2026" />
          </MpFormControl>
          <MpFormControl is-required>
            <MpFormLabel>Quarter</MpFormLabel>
            <MpSelect v-model="form.quarter"><option v-for="q in ['1', '2', '3', '4']" :key="q" :value="q">Q{{ q }}</option></MpSelect>
          </MpFormControl>
        </div>
        <div :class="stack">
          <MpFormControl v-if="!editing" is-required>
            <MpFormLabel>Jira key</MpFormLabel>
            <MpInput v-model="form.jiraKey" placeholder="MESIGN-123" data-test="f-key" />
          </MpFormControl>
          <MpFormControl is-required>
            <MpFormLabel>Initiative</MpFormLabel>
            <MpInput v-model="form.title" data-test="f-title" />
          </MpFormControl>
        </div>
        <div :class="grid">
          <MpFormControl><MpFormLabel>Squad</MpFormLabel><MpInput v-model="form.squad" placeholder="Escape" /></MpFormControl>
          <MpFormControl>
            <MpFormLabel>Criticality</MpFormLabel>
            <MpSelect v-model="form.criticality"><option value="">Not set</option><option v-for="c in criticalityOptions" :key="c" :value="c">{{ c }}</option></MpSelect>
          </MpFormControl>
          <MpFormControl>
            <MpFormLabel>Epic status</MpFormLabel>
            <MpSelect v-model="form.epicStatus"><option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option></MpSelect>
          </MpFormControl>
          <MpFormControl><MpFormLabel>Project status</MpFormLabel><MpInput v-model="form.projectStatus" placeholder="In Testing" /></MpFormControl>
          <MpFormControl><MpFormLabel>Owner</MpFormLabel><MpInput v-model="form.ownerName" /></MpFormControl>
          <div />
          <MpFormControl><MpFormLabel>Est. delivery date</MpFormLabel><MpInput v-model="form.estDeliveryDate" type="date" /></MpFormControl>
          <MpFormControl><MpFormLabel>Actual delivery date</MpFormLabel><MpInput v-model="form.actualDeliveryDate" type="date" /></MpFormControl>
          <MpFormControl><MpFormLabel>Done items</MpFormLabel><MpInput v-model="form.doneItems" inputmode="numeric" /></MpFormControl>
          <MpFormControl><MpFormLabel>Total items</MpFormLabel><MpInput v-model="form.totalItems" inputmode="numeric" /></MpFormControl>
          <MpFormControl><MpFormLabel>PRD link</MpFormLabel><MpInput v-model="form.prdUrl" placeholder="https://" /></MpFormControl>
          <MpFormControl><MpFormLabel>RFC link</MpFormLabel><MpInput v-model="form.rfcUrl" placeholder="https://" /></MpFormControl>
        </div>
        <div :class="stack">
          <MpFormControl><MpFormLabel>Key info / remark</MpFormLabel><MpTextarea v-model="form.remark" :rows="3" /></MpFormControl>
          <MpFormControl><MpFormLabel>Key info / remark (proposed)</MpFormLabel><MpTextarea v-model="form.remarkProposed" :rows="3" /></MpFormControl>
          <label :class="check"><input v-model="form.needsReview" type="checkbox" /><MpText size="label">Needs review</MpText></label>
        </div>

        <MpText weight="semiBold" :class="css({ mb: '3', display: 'block' })">Release and self test</MpText>
        <div v-for="(m, i) in form.milestones" :key="i" :class="marker">
          <MpFormControl>
            <MpFormLabel>Type</MpFormLabel>
            <MpSelect v-model="m.kind"><option value="release">Release</option><option value="self_test">Self test</option></MpSelect>
          </MpFormControl>
          <MpFormControl><MpFormLabel>Date</MpFormLabel><MpInput v-model="m.date" type="date" /></MpFormControl>
          <MpButton variant="ghost" size="sm" left-icon="delete" aria-label="Remove marker" @click="removeMarker(i)" />
        </div>
        <MpButton variant="secondary" size="sm" left-icon="add" data-test="add-marker" @click="addMarker">Add release or self test</MpButton>
        <MpText v-if="problem" size="label" color="text.danger" :class="css({ mt: '4', display: 'block' })">{{ problem }}</MpText>
      </MpDrawerBody>
      <MpDrawerFooter>
        <div :class="foot">
          <template v-if="editing && !confirming">
            <MpButton variant="ghost" :is-disabled="saving" @click="confirming = true">Delete</MpButton>
          </template>
          <template v-if="editing && confirming">
            <MpText size="label" color="text.danger">Delete {{ initiative!.jiraKey }}? This cannot be undone.</MpText>
            <MpButton variant="ghost" size="sm" :is-disabled="saving" @click="confirming = false">Keep</MpButton>
            <MpButton variant="danger" size="sm" :is-loading="saving" data-test="confirm-delete-initiative" @click="remove">Yes, delete</MpButton>
          </template>
          <div :class="spacer" />
          <MpButton variant="ghost" :is-disabled="saving" @click="emit('close')">Cancel</MpButton>
          <MpButton :is-loading="saving" :is-disabled="Boolean(problem)" data-test="save-initiative" @click="save">{{ editing ? 'Save changes' : 'Add initiative' }}</MpButton>
        </div>
      </MpDrawerFooter>
    </MpDrawerContent>
  </MpDrawer>
</template>
