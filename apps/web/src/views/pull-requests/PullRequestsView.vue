<script setup lang="ts">
import {
  MpAvatar, MpAvatarGroup, MpBadge, MpButton, MpButtonGroup, MpIcon, MpSelect, MpTable, MpTableBody, MpTableCell,
  MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
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

const toolbar = css({ display: 'flex', gap: '3', alignItems: 'center', mb: '4', flexWrap: 'wrap' })
const wrap = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', overflowX: 'auto' })
const rowCls = css({ cursor: 'pointer' })
const branch = css({ fontFamily: 'mono', fontSize: 'xs', bg: 'background.neutral', px: '1.5', py: '0.5', rounded: 'sm', whiteSpace: 'nowrap' })
const pager = css({ display: 'flex', justifyContent: 'flex-end', gap: '2', p: '3' })
</script>

<template>
  <PageHeader title="Pull Requests" subtitle="PR Bitbucket kamu dari semua repo yang kamu kerjakan.">
    <MpButton variant="secondary" left-icon="refresh" :is-loading="loading" @click="run">Refresh</MpButton>
  </PageHeader>

  <div :class="toolbar">
    <MpButtonGroup>
      <MpButton size="sm" :variant="role === 'author' ? 'primary' : 'secondary'" @click="role = 'author'">Dibuat saya</MpButton>
      <MpButton size="sm" :variant="role === 'reviewer' ? 'primary' : 'secondary'" @click="role = 'reviewer'">Perlu review saya</MpButton>
    </MpButtonGroup>
    <MpSelect v-model="state" size="sm" :class="css({ width: '160px' })">
      <option value="OPEN">Open</option>
      <option value="MERGED">Merged</option>
      <option value="DECLINED">Declined</option>
      <option value="ALL">Semua state</option>
    </MpSelect>
    <MpSelect v-model="repo" size="sm" placeholder="Semua repo" is-clearable :class="css({ width: '220px' })">
      <option v-for="r in repos ?? []" :key="r" :value="r">{{ r }}</option>
    </MpSelect>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0" empty-text="Tidak ada pull request." @retry="run">
    <div v-if="data" :class="wrap">
      <MpTableContainer>
        <MpTable is-hoverable>
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
                  <MpText v-if="role === 'reviewer'" size="label-small" color="text.secondary">oleh {{ pr.author.name }}</MpText>
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
        <MpButton size="sm" variant="secondary" :is-disabled="page === 1" @click="page--">Sebelumnya</MpButton>
        <MpButton size="sm" variant="secondary" :is-disabled="!data.hasNext" @click="page++">Berikutnya</MpButton>
      </div>
    </div>
  </AsyncState>
</template>
