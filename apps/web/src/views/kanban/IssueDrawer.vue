<script setup lang="ts">
import {
  MpBadge, MpButton, MpDrawer, MpDrawerBody, MpDrawerCloseButton, MpDrawerContent, MpDrawerHeader, MpDrawerOverlay,
  MpSpinner, MpText, css,
} from '@mekari/pixel3'
import { watch } from 'vue'
import { api, unwrap } from '@/lib/api'
import { formatDate, timeAgo } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

const props = defineProps<{ issueKey: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { data: issue, loading, error, run } = useAsync((key: string) => unwrap(api.kanban.issues({ key }).get()))
watch(() => props.issueKey, (k) => { if (k) run(k) }, { immediate: true })

const meta = css({ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '2', columnGap: '3', mb: '5' })
const block = css({ mb: '5' })
const pre = css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const comment = css({ borderLeftWidth: '2px', borderColor: 'border.default.subtle', pl: '3', py: '1', mb: '3' })
</script>

<template>
  <MpDrawer :is-open="Boolean(issueKey)" placement="right" size="lg" @close="emit('close')">
    <MpDrawerOverlay />
    <MpDrawerContent>
      <MpDrawerHeader>
        <MpText weight="semiBold">{{ issueKey }}</MpText>
        <MpDrawerCloseButton />
      </MpDrawerHeader>
      <MpDrawerBody>
        <div v-if="loading" :class="css({ display: 'grid', placeItems: 'center', py: '12' })"><MpSpinner /></div>
        <MpText v-else-if="error" color="text.danger">{{ (error as Error).message }}</MpText>
        <template v-else-if="issue">
          <MpText size="h3" weight="semiBold" :class="css({ mb: '3' })">{{ issue.summary }}</MpText>
          <div :class="css({ display: 'flex', gap: '2', mb: '4', flexWrap: 'wrap' })">
            <MpBadge variant="subtle" :variant-color="issue.statusCategory === 'done' ? 'green' : issue.statusCategory === 'indeterminate' ? 'blue' : 'gray'">{{ issue.status }}</MpBadge>
            <MpBadge variant="subtle" variant-color="gray">{{ issue.issueType }}</MpBadge>
            <MpBadge v-if="issue.storyPoints != null" variant="subtle" variant-color="blue">{{ issue.storyPoints }} SP</MpBadge>
            <a :href="issue.url" target="_blank" rel="noopener noreferrer"><MpButton size="sm" variant="ghost" right-icon="newtab">Open in Jira</MpButton></a>
          </div>

          <div :class="meta">
            <MpText size="label" color="text.secondary">Assignee</MpText><MpText size="label">{{ issue.assignee ?? '-' }}</MpText>
            <MpText size="label" color="text.secondary">Reporter</MpText><MpText size="label">{{ issue.reporter ?? '-' }}</MpText>
            <MpText size="label" color="text.secondary">Priority</MpText><MpText size="label">{{ issue.priority ?? '-' }}</MpText>
            <MpText size="label" color="text.secondary">Sprint</MpText><MpText size="label">{{ issue.sprint ?? '-' }}</MpText>
            <MpText size="label" color="text.secondary">Parent</MpText><MpText size="label">{{ issue.parent ? `${issue.parent.key} · ${issue.parent.summary}` : '-' }}</MpText>
            <MpText size="label" color="text.secondary">Labels</MpText><MpText size="label">{{ issue.labels.join(', ') || '-' }}</MpText>
            <MpText size="label" color="text.secondary">Created</MpText><MpText size="label">{{ formatDate(issue.created) }}</MpText>
            <MpText size="label" color="text.secondary">Updated</MpText><MpText size="label">{{ timeAgo(issue.updated) }}</MpText>
          </div>

          <div :class="block">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Description</MpText>
            <MpText size="label" :class="pre">{{ issue.description || 'No description.' }}</MpText>
          </div>

          <div v-if="issue.subtasks.length" :class="block">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Sub-tasks</MpText>
            <MpText v-for="s in issue.subtasks" :key="s.key" size="label">{{ s.key }} · {{ s.summary }} <MpText as="span" size="label" color="text.secondary">({{ s.status }})</MpText></MpText>
          </div>

          <div :class="block">
            <MpText weight="semiBold" :class="css({ mb: '2' })">Comments ({{ issue.comments.length }})</MpText>
            <div v-for="c in issue.comments" :key="c.id" :class="comment">
              <MpText size="label" weight="semiBold">{{ c.author }} <MpText as="span" size="label-small" color="text.secondary">· {{ timeAgo(c.created) }}</MpText></MpText>
              <MpText size="label" :class="pre">{{ c.body }}</MpText>
            </div>
          </div>
        </template>
      </MpDrawerBody>
    </MpDrawerContent>
  </MpDrawer>
</template>
