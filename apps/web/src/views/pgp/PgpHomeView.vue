<script setup lang="ts">
import { MpBadge, MpButton, MpProgress, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import ReportingLinePanel from '@/components/ReportingLinePanel.vue'
import { api, notifyError, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const { data, loading, error, run } = useAsync(async () => {
  const [plans, templates] = await Promise.all([unwrap(api.pgp.plans.get()), unwrap(api.pgp.templates.get())])
  return { plans, templates }
})
onMounted(run)

const available = computed(() => {
  if (!data.value) return []
  const taken = new Set(data.value.plans.map((p) => p.templateId))
  return data.value.templates.filter((t) => t.status === 'published' && !taken.has(t.id))
})

const creating = ref<string | null>(null)
async function start(templateId: string) {
  creating.value = templateId
  try {
    const plan = await unwrap(api.pgp.plans.post({ templateId }))
    await router.push(`/pgp/plans/${plan.id}`)
  } catch (e) { notifyError(e) } finally { creating.value = null }
}

const col = css({ display: 'flex', flexDirection: 'column', gap: '3' })
const card = `${ui.card} ${col}`
const linkCard = `${ui.card} ${col} ${ui.lift}`
const grid = ui.cards
const between = ui.between
const section = ui.section
</script>

<template>
  <PageHeader title="Personal Growth Plan" subtitle="Your quarterly plan and progress, in the format set by management.">
    <RouterLink v-if="auth.me?.role === 'admin'" to="/pgp/templates">
      <MpButton variant="secondary" left-icon="plans">Manage templates</MpButton>
    </RouterLink>
  </PageHeader>

  <ReportingLinePanel />

  <AsyncState :loading="loading && !data" :error="error" @retry="run">
    <template v-if="data">
      <div v-if="available.length">
        <MpText size="h3" weight="semiBold" :class="css({ mb: '3' })">Start a new PGP</MpText>
        <div :class="grid">
          <div v-for="t in available" :key="t.id" :class="card">
            <div :class="between">
              <MpBadge variant="subtle" variant-color="blue">{{ t.period }}</MpBadge>
              <MpText size="label-small" color="text.secondary">{{ t.itemCount }} {{ t.itemCount === 1 ? 'item' : 'items' }}</MpText>
            </div>
            <MpText weight="semiBold">{{ t.title }}</MpText>
            <MpButton size="sm" :is-loading="creating === t.id" @click="start(t.id)">Fill in this PGP</MpButton>
          </div>
        </div>
      </div>

      <MpText size="h3" weight="semiBold" :class="section">My PGP</MpText>
      <AsyncState :empty="!data.plans.length" empty-text="No PGP yet. Pick a template above to start.">
        <div :class="grid">
          <RouterLink v-for="p in data.plans" :key="p.id" :to="`/pgp/plans/${p.id}`" :class="linkCard">
            <div :class="between">
              <MpBadge variant="subtle" variant-color="blue">{{ p.period }}</MpBadge>
              <MpBadge :variant-color="p.status === 'submitted' ? 'green' : 'gray'" variant="subtle">
                {{ p.status === 'submitted' ? 'Submitted' : 'Draft' }}
              </MpBadge>
            </div>
            <MpText weight="semiBold">{{ p.templateTitle }}</MpText>
            <div>
              <div :class="between">
                <MpText size="label" color="text.secondary">Score</MpText>
                <MpText size="label" weight="semiBold">{{ p.score }}% / {{ p.totalWeight }}%</MpText>
              </div>
              <MpProgress :value="String(p.score)" :class="css({ mt: '1' })" />
            </div>
            <MpText size="label-small" color="text.secondary">Updated {{ timeAgo(p.updatedAt) }}</MpText>
          </RouterLink>
        </div>
      </AsyncState>
    </template>
  </AsyncState>
</template>
