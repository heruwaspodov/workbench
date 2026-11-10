<script setup lang="ts">
import { MpAvatar, MpAvatarGroup, MpBadge, MpButton, MpIcon, MpSelect, MpText, css } from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { api, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { prStateColor } from './pr-ui'

type State = 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL'
const role = ref<'author' | 'reviewer'>('author')
const state = ref<State>('OPEN')
const repo = ref('')
const page = ref(1)

const { data, loading, error, run } = useAsync(() => unwrap(api['pull-requests'].get({
  query: { role: role.value, state: state.value, repo: repo.value || undefined, page: page.value },
})))
const { data: repos, run: loadRepos } = useAsync(() => unwrap(api['pull-requests'].repos.get()))

onMounted(() => { run(); loadRepos() })
watch([role, state, repo], () => { page.value = 1; run() })
watch(page, run)

// One compact block per pull request, so everything fits the page width without sideways scrolling.
const list = css({ borderTopWidth: '1px', borderColor: 'border.default.subtle' })
const row = css({
  display: 'grid', gridTemplateColumns: { base: 'auto minmax(0, 1fr)', lg: 'auto minmax(0, 1fr) auto' }, columnGap: '3', rowGap: '2', alignItems: 'center',
  px: '4', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle', textDecoration: 'none', color: 'inherit',
  _hover: { bg: 'background.surface' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused', outlineOffset: '-2px' },
})
const main = css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1' })
const titleLine = css({ display: 'flex', alignItems: 'center', gap: '2', minWidth: 0 })
const title = css({ truncate: true, fontWeight: 'semiBold' })
const meta = css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '3', rowGap: '1', minWidth: 0 })
const branches = css({ display: 'flex', alignItems: 'center', gap: '2', minWidth: 0 })
const chip = css({ fontFamily: 'mono', fontSize: 'xs', bg: 'background.surface', px: '2', py: '0.5', rounded: 'md', maxWidth: '240px', truncate: true })
const side = css({
  display: 'grid', gridTemplateColumns: { base: 'repeat(3, auto)', lg: '104px 40px 40px 72px' }, columnGap: '3', alignItems: 'center', justifyContent: 'start',
  gridColumn: { base: '2', lg: 'auto' },
})
const stat = css({ display: 'flex', alignItems: 'center', gap: '1' })
const pager = css({ display: 'flex', justifyContent: 'flex-end', gap: '2', p: '3' })
</script>

<template>
  <PageHeader title="My Pull Requests" subtitle="Your Bitbucket pull requests across every repository you work in.">
    <MpButton variant="secondary" left-icon="refresh" :is-loading="loading" @click="run">Refresh</MpButton>
  </PageHeader>

  <div :class="ui.toolbar">
    <SegmentedControl v-model="role" label="Role" :options="[
      { value: 'author', label: 'Created by me' },
      { value: 'reviewer', label: 'Needs my review' },
    ]" />
    <div :class="ui.field">
      <MpSelect v-model="state">
        <option value="OPEN">Open</option>
        <option value="MERGED">Merged</option>
        <option value="DECLINED">Declined</option>
        <option value="ALL">All states</option>
      </MpSelect>
    </div>
    <div :class="ui.field">
      <MpSelect v-model="repo" placeholder="All repositories" is-clearable>
        <option v-for="r in repos ?? []" :key="r" :value="r">{{ r }}</option>
      </MpSelect>
    </div>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0" empty-text="No pull requests." @retry="run">
    <div v-if="data">
      <div :class="list">
        <RouterLink v-for="pr in data.items" :key="`${pr.repo}-${pr.id}`" :to="`/pull-requests/${pr.repo}/${pr.id}`" :class="row">
          <MpAvatar :name="pr.author.name" :src="pr.author.avatarUrl ?? undefined" />

          <div :class="main">
            <div :class="titleLine">
              <MpBadge v-if="pr.draft" size="sm" variant="subtle" variant-color="gray">Draft</MpBadge>
              <MpText size="label" :class="title" :title="pr.title">{{ pr.title }}</MpText>
            </div>
            <div :class="meta">
              <MpText size="label-small" color="text.secondary">{{ pr.repo }} · {{ pr.author.name }} · #{{ pr.id }} · updated {{ timeAgo(pr.updatedOn) }}</MpText>
              <div :class="branches">
                <span :class="chip" :title="pr.sourceBranch">{{ pr.sourceBranch }}</span>
                <MpText as="span" size="label-small" color="text.secondary">→</MpText>
                <span :class="chip" :title="pr.destinationBranch">{{ pr.destinationBranch }}</span>
              </div>
              <MpBadge v-for="k in pr.jiraKeys" :key="k" size="sm" variant="subtle" variant-color="blue">{{ k }}</MpBadge>
            </div>
          </div>

          <div :class="side">
            <div :class="stat">
              <MpAvatarGroup v-if="pr.reviewers.length" size="sm" :max="3">
                <MpAvatar v-for="r in pr.reviewers" :key="r.name" :name="r.name" :src="r.avatarUrl ?? undefined" />
              </MpAvatarGroup>
            </div>
            <div :class="stat" title="Approvals">
              <MpIcon name="check" size="sm" />
              <MpText size="label" :color="pr.approvals ? 'text.success' : 'text.secondary'">{{ pr.approvals }}</MpText>
            </div>
            <div :class="stat" title="Comments">
              <MpIcon name="comment" size="sm" />
              <MpText size="label">{{ pr.commentCount }}</MpText>
            </div>
            <MpBadge variant="subtle" :variant-color="prStateColor(pr.state)">{{ pr.state }}</MpBadge>
          </div>
        </RouterLink>
      </div>
      <div :class="pager">
        <MpButton size="sm" variant="secondary" :is-disabled="page === 1" @click="page--">Previous</MpButton>
        <MpButton size="sm" variant="secondary" :is-disabled="!data.hasNext" @click="page++">Next</MpButton>
      </div>
    </div>
  </AsyncState>
</template>
