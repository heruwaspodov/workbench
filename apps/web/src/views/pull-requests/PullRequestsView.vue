<script setup lang="ts">
import {
  MpAvatar, MpAvatarGroup, MpBadge, MpButton, MpIcon, MpSelect, MpTable, MpTableBody, MpTableCell,
  MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { api, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { prStateColor } from './pr-ui'

type State = 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL'
const router = useRouter()
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

const open = (r: string, id: number) => router.push(`/pull-requests/${r}/${id}`)

const rowCls = css({ cursor: 'pointer' })
const branch = css({ fontFamily: 'mono', fontSize: 'xs', bg: 'background.neutral', px: '1.5', py: '0.5', rounded: 'sm', whiteSpace: 'nowrap' })
const pager = css({ display: 'flex', justifyContent: 'flex-end', gap: '2', p: '3', borderTopWidth: '1px', borderColor: 'border.default.subtle' })
</script>

<template>
  <PageHeader title="Pull Requests" subtitle="Your Bitbucket pull requests across every repository you work in.">
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
    <div v-if="data" :class="ui.flat">
      <MpTableContainer>
        <MpTable is-hoverable :class="ui.table">
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Repo</MpTableCell>
              <MpTableCell as="th">Pull request</MpTableCell>
              <MpTableCell as="th">Branch</MpTableCell>
              <MpTableCell as="th">State</MpTableCell>
              <MpTableCell as="th">Reviewers</MpTableCell>
              <MpTableCell as="th">Activity</MpTableCell>
              <MpTableCell as="th">Updated</MpTableCell>
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="pr in data.items" :key="`${pr.repo}-${pr.id}`" :class="rowCls" @click="open(pr.repo, pr.id)">
              <MpTableCell><MpText size="label" color="text.secondary">{{ pr.repo }}</MpText></MpTableCell>
              <MpTableCell :style="{ minWidth: '320px' }">
                <MpText size="label" weight="semiBold">#{{ pr.id }} {{ pr.title }}</MpText>
                <div :class="css({ display: 'flex', gap: '1', mt: '1', flexWrap: 'wrap' })">
                  <MpBadge v-if="pr.draft" size="sm" variant="subtle" variant-color="gray">Draft</MpBadge>
                  <MpBadge v-for="k in pr.jiraKeys" :key="k" size="sm" variant="subtle" variant-color="blue">{{ k }}</MpBadge>
                  <MpText v-if="role === 'reviewer'" size="label-small" color="text.secondary">by {{ pr.author.name }}</MpText>
                </div>
              </MpTableCell>
              <MpTableCell>
                <span :class="branch">{{ pr.sourceBranch }}</span>
                <MpText as="span" size="label-small" color="text.secondary"> → </MpText>
                <span :class="branch">{{ pr.destinationBranch }}</span>
              </MpTableCell>
              <MpTableCell><MpBadge variant="subtle" :variant-color="prStateColor(pr.state)">{{ pr.state }}</MpBadge></MpTableCell>
              <MpTableCell>
                <div :class="css({ display: 'flex', alignItems: 'center', gap: '2' })">
                  <MpAvatarGroup v-if="pr.reviewers.length" size="sm" :max="3">
                    <MpAvatar v-for="r in pr.reviewers" :key="r.name" :name="r.name" :src="r.avatarUrl ?? undefined" />
                  </MpAvatarGroup>
                  <MpText size="label-small" :color="pr.approvals ? 'text.success' : 'text.secondary'">{{ pr.approvals }} ✓</MpText>
                </div>
              </MpTableCell>
              <MpTableCell>
                <div :class="css({ display: 'flex', gap: '3', alignItems: 'center' })">
                  <span :class="css({ display: 'flex', gap: '1', alignItems: 'center' })"><MpIcon name="comment" size="sm" /><MpText size="label">{{ pr.commentCount }}</MpText></span>
                  <span v-if="pr.taskCount" :class="css({ display: 'flex', gap: '1', alignItems: 'center' })"><MpIcon name="task-todo" size="sm" /><MpText size="label">{{ pr.taskCount }}</MpText></span>
                </div>
              </MpTableCell>
              <MpTableCell><MpText size="label" color="text.secondary">{{ timeAgo(pr.updatedOn) }}</MpText></MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
      <div :class="pager">
        <MpButton size="sm" variant="secondary" :is-disabled="page === 1" @click="page--">Previous</MpButton>
        <MpButton size="sm" variant="secondary" :is-disabled="!data.hasNext" @click="page++">Next</MpButton>
      </div>
    </div>
  </AsyncState>
</template>
