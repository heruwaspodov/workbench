<script setup lang="ts">
/**
 * Admin editor for the SLA goals the Fast Track SLA card judges tickets against. It mirrors the Time to SLA configuration in Jira
 * (which cannot be read through its API): the first goal that matches a ticket's priority and label applies.
 */
import { MpBanner, MpBannerDescription, MpButton, MpInput, MpSelect, MpText, css } from '@mekari/pixel3'
import { computed, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import RowActions from '@/components/RowActions.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

interface Row { key: number; name: string; priority: string; label: string; calendar: 'weekdays' | 'always'; target: string }
let seq = 0
const rows = ref<Row[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify(rows.value.map(({ key: _k, ...r }) => r))
const { loading, error, run } = useAsync(async () => {
  const goals = await unwrap(api.sla.goals.get())
  rows.value = goals.map((g) => ({ key: ++seq, name: g.name, priority: g.priority, label: g.label, calendar: g.calendar as Row['calendar'], target: g.target }))
  saved.value = snapshot()
})
run()
const dirty = computed(() => snapshot() !== saved.value)

const add = () => { rows.value.push({ key: ++seq, name: '', priority: 'Medium - P2', label: '', calendar: 'weekdays', target: '5d' }) }
const remove = (i: number) => { rows.value.splice(i, 1) }
const move = (i: number, dir: -1 | 1) => {
  const j = i + dir
  if (j < 0 || j >= rows.value.length) return
  const next = [...rows.value]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  rows.value = next
}
const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await unwrap(api.sla.goals.put({ goals: rows.value.map(({ key: _k, ...r }) => r) }))
    await run()
    notifySuccess('SLA goals saved')
  } catch (e) { notifyError(e) } finally { saving.value = false }
}

const grid = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: '36px minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 1.3fr) 180px 110px 110px' }, gap: '3', alignItems: 'center' })
const head = css({ display: { base: 'none', lg: 'grid' }, px: '4', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle' })
const row = css({ px: '4', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle', _last: { borderBottomWidth: '0' } })
</script>

<template>
  <PageHeader title="SLA goals" subtitle="Targets for Fast Track tickets. The first goal that matches a ticket's priority and label (with an assignee set) applies.">
    <MpButton variant="secondary" left-icon="add" @click="add">Add goal</MpButton>
    <MpButton :is-disabled="!dirty" :is-loading="saving" data-test="save-sla-goals" @click="save">Save</MpButton>
  </PageHeader>
  <MpBanner variant="info" :class="css({ mb: '4' })">
    <MpBannerDescription>
      Copy of the Time to SLA configuration in Jira, which cannot be read automatically: update it here when the Jira goals change.
      Targets are written like Jira: 8h, 1d12h, 2d. On the weekdays calendar (Mon-Fri 09:00-18:00, Jakarta) a day is 9 working hours; on the 24x7 calendar it is 24 hours.
    </MpBannerDescription>
  </MpBanner>
  <AsyncState :loading="loading && !rows.length" :error="error" @retry="run">
    <section :class="ui.panel" data-test="sla-goals">
      <div :class="[grid, head]">
        <MpText size="label-small" color="text.secondary">#</MpText>
        <MpText size="label-small" color="text.secondary">Name</MpText>
        <MpText size="label-small" color="text.secondary">Priority</MpText>
        <MpText size="label-small" color="text.secondary">Label</MpText>
        <MpText size="label-small" color="text.secondary">Calendar</MpText>
        <MpText size="label-small" color="text.secondary">Target</MpText>
        <span />
      </div>
      <div v-for="(r, i) in rows" :key="r.key" :class="[grid, row]" data-test="sla-goal-row">
        <MpText color="text.secondary">{{ i + 1 }}</MpText>
        <MpInput v-model="r.name" aria-label="Goal name" placeholder="P2 General" />
        <MpInput v-model="r.priority" aria-label="Priority" placeholder="Medium - P2" />
        <MpInput v-model="r.label" aria-label="Label" placeholder="mesign-p2" />
        <MpSelect :model-value="r.calendar" aria-label="Calendar" @change="(e: Event) => (r.calendar = (e.target as HTMLSelectElement).value as Row['calendar'])">
          <option value="weekdays">Weekdays 09-18</option>
          <option value="always">24x7</option>
        </MpSelect>
        <MpInput v-model="r.target" aria-label="Target" placeholder="5d" />
        <RowActions :index="i" :count="rows.length" @move="move" @remove="remove" />
      </div>
    </section>
  </AsyncState>
</template>
