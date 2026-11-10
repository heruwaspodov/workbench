<script setup lang="ts">
import {
  MpAvatar, MpBadge, MpButton, MpTab, MpTabList, MpTabPanel, MpTabPanels, MpTabs, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, unwrap } from '@/lib/api'
import { formatDate, timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import IssueDrawer from '../kanban/IssueDrawer.vue'
import { buildColor, prStateColor } from './pr-ui'

const props = defineProps<{ repo: string; id: string }>()
const { data: pr, loading, error, run } = useAsync(() => unwrap(api['pull-requests']({ repo: props.repo })({ id: props.id }).get()))
onMounted(run)

const issueKey = ref<string | null>(null)

// Lazy diff
const diff = ref<{ diff: string; truncated: boolean } | null>(null)
const diffLoading = ref(false)
async function loadDiff() {
  diffLoading.value = true
  try { diff.value = await unwrap(api['pull-requests']({ repo: props.repo })({ id: props.id }).diff.get()) } catch (e) { notifyError(e) } finally { diffLoading.value = false }
}
const diffLines = computed(() => (diff.value?.diff ?? '').split('\n').map((text) => ({
  text,
  kind: text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') ? 'file' : text.startsWith('@@') ? 'hunk' : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'del' : 'ctx',
})))

const FILE_STATUS = { added: 'green', removed: 'red', modified: 'blue', renamed: 'orange' } as const
const fileColor = (s: string) => FILE_STATUS[s as keyof typeof FILE_STATUS] ?? 'gray'

const layout = css({ display: 'grid', gridTemplateColumns: { base: '1fr', xl: '1fr 320px' }, gap: '4', alignItems: 'start' })
const card = ui.card
const side = css({ display: 'flex', flexDirection: 'column', gap: '4' })
const pre = css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const branch = css({ fontFamily: 'mono', fontSize: 'xs', bg: 'background.neutral', px: '1.5', py: '0.5', rounded: 'sm' })
const listRow = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '3', py: '2', borderBottomWidth: '1px', borderColor: 'border.default.subtle' })
const mono = css({ fontFamily: 'mono', fontSize: 'xs' })
const diffBox = css({ fontFamily: 'mono', fontSize: 'xs', overflowX: 'auto', bg: 'background.neutral.subtle', rounded: 'md', p: '3', maxHeight: '70vh', overflowY: 'auto' })
const diffAdd = css({ bg: 'background.success', display: 'block', whiteSpace: 'pre' })
const diffDel = css({ bg: 'background.danger', display: 'block', whiteSpace: 'pre' })
const diffHunk = css({ color: 'text.information', display: 'block', whiteSpace: 'pre' })
const diffFile = css({ fontWeight: 'semiBold', display: 'block', whiteSpace: 'pre', mt: '2' })
const diffCtx = css({ display: 'block', whiteSpace: 'pre' })
const diffClass = { add: diffAdd, del: diffDel, hunk: diffHunk, file: diffFile, ctx: diffCtx } as const
const comment = css({ display: 'flex', gap: '3', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle' })
</script>

<template>
  <AsyncState :loading="loading && !pr" :error="error" @retry="run">
    <template v-if="pr">
      <PageHeader :title="`#${pr.id} ${pr.title}`" :subtitle="`${pr.repo} · created ${formatDate(pr.createdOn)} by ${pr.author.name}`">
        <template #before-title>
          <RouterLink to="/pull-requests"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">Pull Requests</MpButton></RouterLink>
        </template>
        <MpBadge variant="subtle" :variant-color="prStateColor(pr.state)">{{ pr.state }}</MpBadge>
        <a :href="pr.url" target="_blank" rel="noopener noreferrer"><MpButton variant="secondary" right-icon="newtab">Open in Bitbucket</MpButton></a>
      </PageHeader>

      <div :class="layout">
        <div :class="card">
          <MpTabs :default-value="0">
            <MpTabList>
              <MpTab>Overview</MpTab>
              <MpTab>Files ({{ pr.totals.files }})</MpTab>
              <MpTab>Commits ({{ pr.commits.length }})</MpTab>
              <MpTab>Comments ({{ pr.comments.length }})</MpTab>
            </MpTabList>
            <MpTabPanels>
              <MpTabPanel>
                <div :class="css({ display: 'flex', gap: '2', alignItems: 'center', mb: '4', flexWrap: 'wrap' })">
                  <span :class="branch">{{ pr.sourceBranch }}</span><MpText size="label" color="text.secondary">→</MpText><span :class="branch">{{ pr.destinationBranch }}</span>
                  <MpText size="label" color="text.success">+{{ pr.totals.added }}</MpText>
                  <MpText size="label" color="text.danger">−{{ pr.totals.removed }}</MpText>
                </div>
                <MpText size="label" :class="pre">{{ pr.description || 'No description.' }}</MpText>
              </MpTabPanel>

              <MpTabPanel>
                <div v-for="f in pr.files" :key="f.path" :class="listRow">
                  <div :class="css({ display: 'flex', gap: '2', alignItems: 'center', minWidth: 0 })">
                    <MpBadge size="sm" variant="subtle" :variant-color="fileColor(f.status)">{{ f.status }}</MpBadge>
                    <span :class="mono">{{ f.oldPath ? `${f.oldPath} → ` : '' }}{{ f.path }}</span>
                  </div>
                  <MpText size="label-small" :class="css({ whiteSpace: 'nowrap' })">
                    <MpText as="span" size="label-small" color="text.success">+{{ f.added }}</MpText>
                    <MpText as="span" size="label-small" color="text.danger"> −{{ f.removed }}</MpText>
                  </MpText>
                </div>
                <div :class="css({ mt: '4' })">
                  <MpButton v-if="!diff" variant="secondary" size="sm" :is-loading="diffLoading" @click="loadDiff">Show diff</MpButton>
                  <template v-else>
                    <MpText v-if="diff.truncated" size="label-small" color="text.warning" :class="css({ mb: '2' })">The diff is too large and is shown in part. Open it in Bitbucket for the full version.</MpText>
                    <div :class="diffBox"><span v-for="(l, i) in diffLines" :key="i" :class="diffClass[l.kind as keyof typeof diffClass]">{{ l.text || ' ' }}</span></div>
                  </template>
                </div>
              </MpTabPanel>

              <MpTabPanel>
                <div v-for="c in pr.commits" :key="c.hash" :class="listRow">
                  <div>
                    <MpText size="label">{{ c.message }}</MpText>
                    <MpText size="label-small" color="text.secondary">{{ c.author }} · {{ timeAgo(c.date) }}</MpText>
                  </div>
                  <span :class="mono">{{ c.hash }}</span>
                </div>
              </MpTabPanel>

              <MpTabPanel>
                <MpText v-if="!pr.comments.length" color="text.secondary">No comments yet.</MpText>
                <div v-for="c in pr.comments" :key="c.id" :class="comment">
                  <MpAvatar :name="c.author" :src="c.avatarUrl ?? undefined" size="sm" />
                  <div :class="css({ minWidth: 0 })">
                    <MpText size="label" weight="semiBold">{{ c.author }} <MpText as="span" size="label-small" color="text.secondary">· {{ timeAgo(c.createdOn) }}</MpText></MpText>
                    <MpText v-if="c.inline" size="label-small" color="text.secondary" :class="mono">{{ c.inline.path }}{{ c.inline.line ? `:${c.inline.line}` : '' }}</MpText>
                    <MpText size="label" :class="pre">{{ c.body }}</MpText>
                  </div>
                </div>
              </MpTabPanel>
            </MpTabPanels>
          </MpTabs>
        </div>

        <aside :class="side">
          <div :class="card">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Reviewers</MpText>
            <MpText v-if="!pr.reviewers.length" size="label" color="text.secondary">No reviewers yet.</MpText>
            <div v-for="r in pr.reviewers" :key="r.name" :class="listRow">
              <div :class="css({ display: 'flex', gap: '2', alignItems: 'center' })">
                <MpAvatar :name="r.name" :src="r.avatarUrl ?? undefined" size="sm" />
                <MpText size="label">{{ r.name }}</MpText>
              </div>
              <MpBadge size="sm" variant="subtle" :variant-color="r.approved ? 'green' : r.state === 'changes_requested' ? 'orange' : 'gray'">
                {{ r.approved ? 'Approved' : r.state === 'changes_requested' ? 'Changes requested' : 'Pending' }}
              </MpBadge>
            </div>
          </div>

          <div :class="card">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Builds</MpText>
            <MpText v-if="!pr.builds.length" size="label" color="text.secondary">No build statuses.</MpText>
            <div v-for="b in pr.builds" :key="b.key" :class="listRow">
              <a v-if="b.url" :href="b.url" target="_blank" rel="noopener noreferrer" :class="css({ color: 'text.link', fontSize: 'sm' })">{{ b.name }}</a>
              <MpText v-else size="label">{{ b.name }}</MpText>
              <MpBadge size="sm" variant="subtle" :variant-color="buildColor(b.state)">{{ b.state }}</MpBadge>
            </div>
          </div>

          <div v-if="pr.jiraKeys.length" :class="card">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Jira</MpText>
            <div :class="css({ display: 'flex', gap: '2', flexWrap: 'wrap' })">
              <MpButton v-for="k in pr.jiraKeys" :key="k" size="sm" variant="secondary" @click="issueKey = k">{{ k }}</MpButton>
            </div>
          </div>
        </aside>
      </div>

      <IssueDrawer :issue-key="issueKey" @close="issueKey = null" />
    </template>
  </AsyncState>
</template>
