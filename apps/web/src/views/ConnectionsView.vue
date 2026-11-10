<script setup lang="ts">
import { MpAvatar, MpBadge, MpButton, MpIcon, MpInput, MpSelect, MpText, css } from '@mekari/pixel3'
import { onMounted, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

type Overview = Awaited<ReturnType<typeof load>>
const load = () => unwrap(api.connections.get())
const { data: overview, loading, error, run } = useAsync(load)
const busy = ref<string | null>(null)

async function act(key: string, fn: () => Promise<Overview>, success: string) {
  busy.value = key
  try { overview.value = await fn(); notifySuccess(success) } catch (e) { notifyError(e) } finally { busy.value = null }
}

// Jira
const jiraQuery = ref('')
const jiraResults = ref<{ accountId: string; displayName: string; avatarUrl: string | null }[]>([])
const searchJira = async () => {
  try { jiraResults.value = await unwrap(api.connections.jira.users.get({ query: { q: jiraQuery.value } })) } catch (e) { notifyError(e) }
}
const boards = ref<{ id: number; name: string; type: string; project: string | null }[]>([])
const boardQuery = ref('')
const searchBoards = async () => {
  try {
    boards.value = await unwrap(api.connections.jira.boards.get({ query: { q: boardQuery.value } }))
    // A pasted board URL or id resolves exactly one board: select it right away.
    const pasted = /\/boards\/\d+/.test(boardQuery.value) || /^\s*\d+\s*$/.test(boardQuery.value)
    if (pasted && boards.value.length === 1) await onBoardChange(String(boards.value[0]!.id))
    else if (pasted) notifyError(new Error('Board tidak ditemukan'))
  } catch (e) { notifyError(e) }
}
const onBoardChange = (value: string | number) =>
  act('board', () => unwrap(api.connections.jira.board.put({ boardId: value ? Number(value) : null })), 'Board saved')

// Bitbucket
const bbQuery = ref('')
const bbResults = ref<{ uuid: string; displayName: string; nickname: string | null; avatarUrl: string | null }[]>([])
const searchBb = async () => {
  try { bbResults.value = await unwrap(api.connections.bitbucket.members.get({ query: { q: bbQuery.value } })) } catch (e) { notifyError(e) }
}

onMounted(run)

const card = css({ display: 'flex', flexDirection: 'column', gap: '4' })
const row = ui.row
const between = ui.between
const list = css({ display: 'flex', flexDirection: 'column', gap: '1', maxHeight: '260px', overflowY: 'auto' })
const listItem = css({ display: 'flex', alignItems: 'center', gap: '3', p: '2', rounded: 'md', _hover: { bg: 'background.neutral.subtle' } })
const muted = ui.note
const grid = ui.twoCol
</script>

<template>
  <PageHeader title="Connections" subtitle="Link your Jira and Bitbucket accounts. Data is read through a service account; your linked account is used to filter it." />

  <AsyncState :loading="loading && !overview" :error="error" @retry="run">
    <div v-if="overview" :class="grid">
      <!-- Jira -->
      <section :class="[ui.card, card]">
        <div :class="between">
          <div :class="row">
            <MpIcon name="table-view-column" />
            <MpText size="h3" weight="semiBold">Jira</MpText>
          </div>
          <MpBadge v-if="!overview.jira.configured" variant="subtle" variant-color="gray">Not configured</MpBadge>
          <MpBadge v-else-if="overview.jira.accountId" variant="subtle" variant-color="green">Connected</MpBadge>
          <MpBadge v-else variant="subtle" variant-color="orange">Not connected</MpBadge>
        </div>

        <template v-if="overview.jira.configured">
          <div v-if="overview.jira.accountId" :class="[muted, between]">
            <div>
              <MpText weight="semiBold">{{ overview.jira.displayName }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ overview.jira.baseUrl }}</MpText>
            </div>
            <MpButton variant="ghost" size="sm" :is-loading="busy === 'jira-off'"
              @click="act('jira-off', () => unwrap(api.connections.jira.delete()), 'Jira disconnected')">Disconnect</MpButton>
          </div>

          <div v-else :class="css({ display: 'flex', flexDirection: 'column', gap: '3' })">
            <MpButton :is-loading="busy === 'jira-auto'" left-icon="data-connect"
              @click="act('jira-auto', () => unwrap(api.connections.jira.auto.post()), 'Jira connected')">
              Connect automatically (by Mekari email)
            </MpButton>
            <MpText size="label-small" color="text.secondary">Not found? Search manually:</MpText>
            <div :class="row">
              <MpInput v-model="jiraQuery" placeholder="Name or email" @keyup.enter="searchJira" />
              <MpButton variant="secondary" @click="searchJira">Search</MpButton>
            </div>
            <div v-if="jiraResults.length" :class="list">
              <div v-for="u in jiraResults" :key="u.accountId" :class="listItem">
                <MpAvatar :name="u.displayName" :src="u.avatarUrl ?? undefined" size="sm" />
                <MpText :class="css({ flex: 1 })">{{ u.displayName }}</MpText>
                <MpButton size="sm" variant="secondary"
                  @click="act('jira-set', () => unwrap(api.connections.jira.put({ accountId: u.accountId })), 'Jira connected')">Select</MpButton>
              </div>
            </div>
          </div>

          <div v-if="overview.jira.accountId" :class="css({ display: 'flex', flexDirection: 'column', gap: '2' })">
            <MpText weight="semiBold">Board for Kanban</MpText>
            <MpText size="label-small" color="text.secondary">
              Optional. Without a board, Kanban groups issues by status category (To Do / In Progress / Done).
              Search by board name or project key (e.g. MESIGN), or paste a Jira board URL or ID.
            </MpText>
            <MpText v-if="overview.jira.boardIsDefault" size="label-small" color="text.secondary">
              Using the team default board{{ overview.jira.boardName ? `: ${overview.jira.boardName}` : '' }}. Pick another board to replace it.
            </MpText>
            <div :class="row">
              <MpInput v-model="boardQuery" placeholder="Name, project key (MESIGN) or board URL" @keyup.enter="searchBoards" />
              <MpButton variant="secondary" @click="searchBoards">Search</MpButton>
            </div>
            <MpSelect :model-value="overview.jira.boardId ?? ''" placeholder="No board" is-clearable @change="(e: Event) => onBoardChange((e.target as HTMLSelectElement).value)" @clear="onBoardChange('')">
              <option v-if="overview.jira.boardId && !boards.some((b) => b.id === overview?.jira.boardId)" :value="overview.jira.boardId">
                {{ overview.jira.boardName ?? `Board #${overview.jira.boardId}` }}
              </option>
              <option v-for="b in boards" :key="b.id" :value="b.id">{{ b.name }} ({{ b.type }}{{ b.project ? ` · ${b.project}` : '' }})</option>
            </MpSelect>
          </div>
        </template>
        <MpText v-else size="label" color="text.secondary">An admin needs to set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.</MpText>
      </section>

      <!-- Bitbucket -->
      <section :class="[ui.card, card]">
        <div :class="between">
          <div :class="row">
            <MpIcon name="file-code" />
            <MpText size="h3" weight="semiBold">Bitbucket</MpText>
          </div>
          <MpBadge v-if="!overview.bitbucket.configured" variant="subtle" variant-color="gray">Not configured</MpBadge>
          <MpBadge v-else-if="overview.bitbucket.uuid" variant="subtle" variant-color="green">Connected</MpBadge>
          <MpBadge v-else variant="subtle" variant-color="orange">Not connected</MpBadge>
        </div>

        <template v-if="overview.bitbucket.configured">
          <div v-if="overview.bitbucket.uuid" :class="[muted, between]">
            <div>
              <MpText weight="semiBold">{{ overview.bitbucket.displayName }}</MpText>
              <MpText size="label-small" color="text.secondary">
                {{ overview.bitbucket.nickname ? `@${overview.bitbucket.nickname} · ` : '' }}workspace {{ overview.bitbucket.workspace }}
              </MpText>
            </div>
            <MpButton variant="ghost" size="sm" :is-loading="busy === 'bb-off'"
              @click="act('bb-off', () => unwrap(api.connections.bitbucket.delete()), 'Bitbucket disconnected')">Disconnect</MpButton>
          </div>

          <div v-else :class="css({ display: 'flex', flexDirection: 'column', gap: '3' })">
            <MpButton :is-loading="busy === 'bb-auto'" left-icon="data-connect"
              @click="act('bb-auto', () => unwrap(api.connections.bitbucket.auto.post()), 'Bitbucket connected')">
              Connect automatically (by Atlassian account)
            </MpButton>
            <MpText size="label-small" color="text.secondary">Connect Jira first so automatic matching is accurate, or search manually:</MpText>
            <div :class="row">
              <MpInput v-model="bbQuery" placeholder="Name or username" @keyup.enter="searchBb" />
              <MpButton variant="secondary" @click="searchBb">Search</MpButton>
            </div>
            <div v-if="bbResults.length" :class="list">
              <div v-for="m in bbResults" :key="m.uuid" :class="listItem">
                <MpAvatar :name="m.displayName" :src="m.avatarUrl ?? undefined" size="sm" />
                <div :class="css({ flex: 1 })">
                  <MpText>{{ m.displayName }}</MpText>
                  <MpText v-if="m.nickname" size="label-small" color="text.secondary">@{{ m.nickname }}</MpText>
                </div>
                <MpButton size="sm" variant="secondary"
                  @click="act('bb-set', () => unwrap(api.connections.bitbucket.put({ uuid: m.uuid })), 'Bitbucket connected')">Select</MpButton>
              </div>
            </div>
          </div>
        </template>
        <MpText v-else size="label" color="text.secondary">An admin needs to set BITBUCKET_WORKSPACE and a Bitbucket token.</MpText>
      </section>
    </div>
  </AsyncState>
</template>
