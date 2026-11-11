<script setup lang="ts">
import { MpBadge, MpButton, MpIcon, MpProgress, MpText, css } from '@mekari/pixel3'
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import DeletePlanModal from '@/components/DeletePlanModal.vue'
import PageHeader from '@/components/PageHeader.vue'
import ReportingLinePanel from '@/components/ReportingLinePanel.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const { data, loading, error, run } = useAsync(async () => {
  return { plans: await unwrap(api.pgp.plans.get()) }
})
onMounted(run)

type Row = NonNullable<typeof data.value>['plans'][number]
const target = ref<Row | null>(null)
const deleting = ref(false)
async function remove() {
  if (!target.value) return
  deleting.value = true
  try {
    await unwrap(api.pgp.plans({ id: target.value.id }).delete())
    notifySuccess('PGP deleted')
  } catch (e) { notifyError(e) } finally {
    deleting.value = false
    target.value = null
    await run() // also covers a plan that was already gone
  }
}

const section = ui.section
// The row is a link plus a separate delete button: a button cannot sit inside the link.
const rowWrap = css({
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', pr: '3',
  borderBottomWidth: '1px', borderColor: 'border.default.subtle', _hover: { bg: 'background.surface' },
})
const rowLink = css({
  display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: '3', alignItems: 'center', px: '4', py: '3',
  textDecoration: 'none', color: 'inherit', _focusVisible: { outline: '2px solid', outlineColor: 'border.focused', outlineOffset: '-2px' },
})
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
    <RouterLink to="/pgp/new"><MpButton left-icon="add">Create PGP</MpButton></RouterLink>
  </PageHeader>

  <ReportingLinePanel />

  <AsyncState :loading="loading && !data" :error="error" @retry="run">
    <template v-if="data">
      <MpText size="h3" weight="semiBold" :class="section">My PGP</MpText>
      <AsyncState :empty="!data.plans.length" empty-text="No PGP yet. Use Create PGP to start from a template or an Excel file.">
        <div :class="ui.list">
          <div v-for="p in data.plans" :key="p.id" :class="rowWrap">
          <RouterLink :to="`/pgp/plans/${p.id}`" :class="rowLink">
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
          <MpButton size="sm" variant="ghost" left-icon="delete" :aria-label="`Delete ${p.templateTitle}`" title="Delete" data-test="delete-row" @click="target = p" />
          </div>
        </div>
      </AsyncState>
      <DeletePlanModal :open="Boolean(target)" :title="target?.templateTitle ?? ''" :period="target?.period ?? ''" :submitted="target?.status === 'submitted'" :loading="deleting"
        @close="target = null" @confirm="remove" />
    </template>
  </AsyncState>
</template>
