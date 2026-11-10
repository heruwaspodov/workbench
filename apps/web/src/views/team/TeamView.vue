<script setup lang="ts">
import {
  MpAvatar, MpBadge, MpButton, MpFormControl, MpFormLabel, MpSelect, MpTable, MpTableBody, MpTableCell, MpTableContainer,
  MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, unwrap } from '@/lib/api'
import { pct, timeAgo } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

const period = ref('')
const periods = useAsync(async () => {
  const templates = await unwrap(api.pgp.templates.get())
  return [...new Set(templates.filter((t) => t.status === 'published').map((t) => t.period))].sort().reverse()
})
const team = useAsync((p: string) => unwrap(api.org.team.get({ query: p ? { period: p } : {} })))

onMounted(async () => {
  await team.run('')
  period.value = team.data.value?.period ?? ''
  await periods.run()
})
watch(period, (p, prev) => { if (prev && p !== team.data.value?.period) team.run(p) })

const periodOptions = computed(() => {
  const list = periods.data.value ?? []
  const current = team.data.value?.period
  return current && !list.includes(current) ? [current, ...list] : list
})

const label = (plan: { status: string } | null) => (!plan ? 'Belum mulai' : plan.status === 'submitted' ? 'Submitted' : 'Draft')
const color = (plan: { status: string } | null) => (!plan ? 'gray' : plan.status === 'submitted' ? 'green' : 'orange')

const bar = css({ display: 'flex', alignItems: 'flex-end', gap: '3', mb: '4' })
const wrap = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', overflow: 'hidden' })
const person = css({ display: 'flex', alignItems: 'center', gap: '3' })
const actions = css({ display: 'flex', gap: '2', justifyContent: 'flex-end' })
</script>

<template>
  <PageHeader title="Tim Saya" subtitle="PGP direct report kamu per quarter. Hanya baca." />

  <div :class="bar">
    <MpFormControl :class="css({ width: '200px' })">
      <MpFormLabel>Period</MpFormLabel>
      <MpSelect v-model="period" :is-disabled="!periodOptions.length">
        <option v-for="p in periodOptions" :key="p" :value="p">{{ p }}</option>
      </MpSelect>
    </MpFormControl>
  </div>

  <AsyncState :loading="team.loading.value && !team.data.value" :error="team.error.value"
    :empty="team.data.value?.members.length === 0" empty-text="Belum ada direct report aktif." @retry="team.run(period)">
    <div v-if="team.data.value" :class="wrap">
      <MpTableContainer>
        <MpTable>
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Nama</MpTableCell>
              <MpTableCell as="th">Status PGP</MpTableCell>
              <MpTableCell as="th">Score</MpTableCell>
              <MpTableCell as="th">Total weight</MpTableCell>
              <MpTableCell as="th">Terakhir update</MpTableCell>
              <MpTableCell as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="m in team.data.value.members" :key="m.user.id">
              <MpTableCell>
                <div :class="person">
                  <MpAvatar :name="m.user.name" :src="m.user.avatarUrl ?? undefined" size="sm" />
                  <div>
                    <MpText weight="semiBold">{{ m.user.name }}</MpText>
                    <MpText size="label-small" color="text.secondary">{{ m.user.email }}</MpText>
                  </div>
                </div>
              </MpTableCell>
              <MpTableCell><MpBadge variant="subtle" :variant-color="color(m.plan)">{{ label(m.plan) }}</MpBadge></MpTableCell>
              <MpTableCell>{{ m.plan ? pct(m.plan.score) : '-' }}</MpTableCell>
              <MpTableCell>{{ m.plan ? pct(m.plan.totalWeight) : '-' }}</MpTableCell>
              <MpTableCell>{{ m.plan ? timeAgo(m.plan.updatedAt) : '-' }}</MpTableCell>
              <MpTableCell>
                <div v-if="m.plan" :class="actions">
                  <RouterLink :to="`/pgp/plans/${m.plan.planId}`"><MpButton size="sm" variant="secondary">Lihat</MpButton></RouterLink>
                  <a :href="`/api/pgp/plans/${m.plan.planId}/export`"><MpButton size="sm" variant="ghost" left-icon="excel-document">Export</MpButton></a>
                </div>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
    </div>
  </AsyncState>
</template>
