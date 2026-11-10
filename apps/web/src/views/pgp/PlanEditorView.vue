<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpButton, MpFormControl, MpFormLabel, MpInput, MpProgress, MpText, css,
} from '@mekari/pixel3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import ItemsEditor from '@/components/ItemsEditor.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { type EditableItem, stripKeys, toEditable, totals } from '@/lib/pgp'
import { useAsync } from '@/lib/use-async'

const props = defineProps<{ id: string }>()

type Plan = Awaited<ReturnType<typeof fetchPlan>>
const fetchPlan = () => unwrap(api.pgp.plans({ id: props.id }).get())
const { data: plan, loading, error, run } = useAsync(fetchPlan)

const header = ref({ division: '', sbu: '', sbuDetail: '', directLeader: '' })
const items = ref<EditableItem[]>([])
const snapshot = ref('')
const saving = ref(false)

const serialize = () => JSON.stringify({ h: header.value, i: stripKeys(items.value) })
const dirty = computed(() => Boolean(plan.value?.canEdit) && snapshot.value !== serialize())
const sum = computed(() => totals(items.value))

function hydrate(p: Plan) {
  plan.value = p
  header.value = { division: p.division ?? '', sbu: p.sbu ?? '', sbuDetail: p.sbuDetail ?? '', directLeader: p.directLeader ?? '' }
  items.value = toEditable(p.items)
  snapshot.value = serialize()
}
watch(plan, (p) => { if (p && !snapshot.value) hydrate(p) })
onMounted(run)

async function save() {
  saving.value = true
  try {
    const nullify = (v: string) => v.trim() || null
    await unwrap(api.pgp.plans({ id: props.id }).patch({
      division: nullify(header.value.division), sbu: nullify(header.value.sbu),
      sbuDetail: nullify(header.value.sbuDetail), directLeader: nullify(header.value.directLeader),
    }))
    hydrate(await unwrap(api.pgp.plans({ id: props.id }).items.put({ items: stripKeys(items.value) })))
    notifySuccess('PGP tersimpan')
    return true
  } catch (e) { notifyError(e); return false } finally { saving.value = false }
}

async function setStatus(action: 'submit' | 'reopen') {
  if (dirty.value && !(await save())) return
  try {
    hydrate(await unwrap(action === 'submit' ? api.pgp.plans({ id: props.id }).submit.post() : api.pgp.plans({ id: props.id }).reopen.post()))
    notifySuccess(action === 'submit' ? 'PGP disubmit' : 'PGP dibuka kembali')
  } catch (e) { notifyError(e) }
}

const exportUrl = computed(() => `/api/pgp/plans/${props.id}/export`)

// Jira delivery stats as evidence helper (silently hidden when Jira isn't connected)
const stats = ref<{ month: string; tickets: number; storyPoints: number }[]>([])
watch(plan, async (p) => { if (p?.canEdit && !stats.value.length) stats.value = await unwrap(api.kanban.stats.get()).catch(() => []) }, { once: true })
const monthLabel = (m: string) => new Date(`${m}-01`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault() }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => !dirty.value || window.confirm('Ada perubahan yang belum disimpan. Tinggalkan halaman?'))

const card = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', p: '5', mb: '4' })
const headerGrid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' }, gap: '4' })
const summary = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: '2fr 3fr' }, gap: '4', mb: '4' })
const statRow = css({ display: 'flex', gap: '4', flexWrap: 'wrap' })
const stat = css({ bg: 'background.neutral.subtle', rounded: 'md', px: '3', py: '2', minWidth: '140px' })
</script>

<template>
  <AsyncState :loading="loading && !plan" :error="error" @retry="run">
    <template v-if="plan">
      <PageHeader :title="plan.template.title" :subtitle="`${plan.user.name} · ${plan.template.period}`">
        <template #before-title>
          <RouterLink to="/pgp"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">PGP saya</MpButton></RouterLink>
        </template>
        <MpBadge :variant-color="plan.status === 'submitted' ? 'green' : 'gray'" variant="subtle">
          {{ plan.status === 'submitted' ? `Submitted ${formatDate(plan.submittedAt)}` : 'Draft' }}
        </MpBadge>
        <a :href="exportUrl"><MpButton variant="secondary" left-icon="excel-document">Export Excel</MpButton></a>
        <template v-if="plan.canEdit">
          <MpButton v-if="plan.status === 'draft'" variant="secondary" :is-disabled="sum.weight !== 100" @click="setStatus('submit')">Submit</MpButton>
          <MpButton v-else variant="secondary" @click="setStatus('reopen')">Buka kembali</MpButton>
          <MpButton :is-loading="saving" :is-disabled="!dirty" @click="save">Simpan</MpButton>
        </template>
      </PageHeader>

      <MpBanner v-if="!plan.canEdit" variant="info" :class="css({ mb: '4' })">
        <MpBannerDescription>
          {{ plan.viewerRole === 'leader' ? `Kamu melihat PGP ${plan.user.name} sebagai direct leader (hanya baca).` : `Kamu melihat PGP ${plan.user.name} sebagai admin (hanya baca).` }}
        </MpBannerDescription>
      </MpBanner>

      <MpBanner v-if="plan.status === 'submitted' && plan.canEdit" variant="info" :class="css({ mb: '4' })">
        <MpBannerDescription>Plan sudah disubmit: kolom planning dikunci, kolom monitoring (baseline, current, achievement, status, evidence) tetap bisa diupdate.</MpBannerDescription>
      </MpBanner>

      <div :class="summary">
        <div :class="[card, css({ mb: '0' })]">
          <MpText size="label" color="text.secondary">Score quarter ini</MpText>
          <MpText size="h1" weight="semiBold">{{ sum.score }}%</MpText>
          <MpProgress :value="String(sum.score)" :class="css({ my: '2' })" />
          <MpText size="label-small" :color="sum.weight === 100 ? 'text.secondary' : 'text.danger'">
            Total weight {{ sum.weight }}%{{ sum.weight !== 100 ? ' — harus 100% untuk submit' : '' }}
          </MpText>
        </div>
        <div v-if="plan.canEdit" :class="[card, css({ mb: '0' })]">
          <MpText size="label" color="text.secondary" :class="css({ mb: '2' })">Delivery dari Jira (resolved, 3 bulan terakhir)</MpText>
          <div v-if="stats.length" :class="statRow">
            <div v-for="s in stats" :key="s.month" :class="stat">
              <MpText size="label-small" color="text.secondary">{{ monthLabel(s.month) }}</MpText>
              <MpText weight="semiBold">{{ s.storyPoints }} SP</MpText>
              <MpText size="label-small" color="text.secondary">{{ s.tickets }} tiket</MpText>
            </div>
          </div>
          <MpText v-else size="label" color="text.secondary">
            Hubungkan Jira di <RouterLink to="/connections" :class="css({ color: 'text.link' })">Connections</RouterLink> untuk melihat ringkasan story point.
          </MpText>
        </div>
      </div>

      <div :class="card">
        <div :class="headerGrid">
          <MpFormControl>
            <MpFormLabel>Division</MpFormLabel>
            <MpInput v-model="header.division" :is-read-only="!plan.canEdit" placeholder="Technology Engineering" />
          </MpFormControl>
          <MpFormControl>
            <MpFormLabel>SBU (Scope Product)</MpFormLabel>
            <MpInput v-model="header.sbu" :is-read-only="!plan.canEdit" placeholder="ESIGN" />
          </MpFormControl>
          <MpFormControl>
            <MpFormLabel>SBU (Detail)</MpFormLabel>
            <MpInput v-model="header.sbuDetail" :is-read-only="!plan.canEdit" />
          </MpFormControl>
          <MpFormControl>
            <MpFormLabel>Direct Leader</MpFormLabel>
            <MpInput v-model="header.directLeader" :is-read-only="!plan.canEdit" />
          </MpFormControl>
        </div>
      </div>

      <ItemsEditor v-model="items" mode="plan" :lock-planning="plan.status === 'submitted'" :readonly="!plan.canEdit" />
    </template>
  </AsyncState>
</template>
