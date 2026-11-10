<script setup lang="ts">
import { MpBadge, MpButton, MpIcon, MpProgress, MpText, css } from '@mekari/pixel3'
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

const section = ui.section
const main = css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1' })
const title = css({ truncate: true, fontWeight: 'semiBold' })
const meta = css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '3', rowGap: '1' })
const score = css({ display: 'grid', gridTemplateColumns: { base: 'auto auto', lg: '150px 84px' }, columnGap: '4', rowGap: '1', alignItems: 'center', justifyItems: 'start' })
const scoreText = css({ display: 'flex', flexDirection: 'column', gap: '1', width: '100%' })
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
        <div :class="ui.list">
          <div v-for="t in available" :key="t.id" :class="ui.listRow">
            <div :class="ui.tile"><MpIcon name="goal" size="sm" /></div>
            <div :class="main">
              <MpText size="label" :class="title" :title="t.title">{{ t.title }}</MpText>
              <div :class="meta">
                <MpBadge size="sm" variant="subtle" variant-color="blue">{{ t.period }}</MpBadge>
                <MpText size="label-small" color="text.secondary">{{ t.itemCount }} {{ t.itemCount === 1 ? 'item' : 'items' }}</MpText>
              </div>
            </div>
            <MpButton size="sm" variant="secondary" :is-loading="creating === t.id" @click="start(t.id)">Fill in this PGP</MpButton>
          </div>
        </div>
      </div>

      <MpText size="h3" weight="semiBold" :class="section">My PGP</MpText>
      <AsyncState :empty="!data.plans.length" empty-text="No PGP yet. Pick a template above to start.">
        <div :class="ui.list">
          <RouterLink v-for="p in data.plans" :key="p.id" :to="`/pgp/plans/${p.id}`" :class="ui.listRow">
            <div :class="ui.tile"><MpIcon name="goal" size="sm" /></div>
            <div :class="main">
              <MpText size="label" :class="title" :title="p.templateTitle">{{ p.templateTitle }}</MpText>
              <div :class="meta">
                <MpBadge size="sm" variant="subtle" variant-color="blue">{{ p.period }}</MpBadge>
                <MpText size="label-small" color="text.secondary">Updated {{ timeAgo(p.updatedAt) }}</MpText>
              </div>
            </div>
            <div :class="score">
              <div :class="scoreText">
                <MpText size="label" weight="semiBold">{{ p.score }}% <MpText as="span" size="label" color="text.secondary">of {{ p.totalWeight }}%</MpText></MpText>
                <MpProgress :value="String(p.score)" />
              </div>
              <MpBadge :variant-color="p.status === 'submitted' ? 'green' : 'gray'" variant="subtle">
                {{ p.status === 'submitted' ? 'Submitted' : 'Draft' }}
              </MpBadge>
            </div>
          </RouterLink>
        </div>
      </AsyncState>
    </template>
  </AsyncState>
</template>
