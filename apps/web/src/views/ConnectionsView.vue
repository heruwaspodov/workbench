<script setup lang="ts">
import { MpAvatar, MpBadge, MpButton, MpIcon, MpInput, MpSelect, MpText, css } from '@mekari/pixel3'
import { onMounted, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
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
  try { boards.value = await unwrap(api.connections.jira.boards.get({ query: { q: boardQuery.value } })) } catch (e) { notifyError(e) }
}
const onBoardChange = (value: string | number) =>
  act('board', () => unwrap(api.connections.jira.board.put({ boardId: value ? Number(value) : null })), 'Board tersimpan')

// Bitbucket
const bbQuery = ref('')
const bbResults = ref<{ uuid: string; displayName: string; nickname: string | null; avatarUrl: string | null }[]>([])
const searchBb = async () => {
  try { bbResults.value = await unwrap(api.connections.bitbucket.members.get({ query: { q: bbQuery.value } })) } catch (e) { notifyError(e) }
}

onMounted(run)

const grid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', lg: '1fr 1fr' }, gap: '5', alignItems: 'start' })
const card = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', p: '5', display: 'flex', flexDirection: 'column', gap: '4' })
const row = css({ display: 'flex', alignItems: 'center', gap: '3' })
const between = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })
const list = css({ display: 'flex', flexDirection: 'column', gap: '1', maxHeight: '260px', overflowY: 'auto' })
const listItem = css({ display: 'flex', alignItems: 'center', gap: '3', p: '2', rounded: 'md', _hover: { bg: 'background.neutral' } })
const muted = css({ bg: 'background.neutral.subtle', rounded: 'md', p: '3' })
</script>

<template>
  <PageHeader title="Connections" subtitle="Hubungkan akun Jira dan Bitbucket kamu. Data diambil lewat service account, akun kamu dipakai untuk filter." />

  <AsyncState :loading="loading && !overview" :error="error" @retry="run">
    <div v-if="overview" :class="grid">
      <!-- Jira -->
      <section :class="card">
        <div :class="between">
          <div :class="row">
            <MpIcon name="table-view-column" />
            <MpText size="h3" weight="semiBold">Jira</MpText>
          </div>
          <MpBadge v-if="!overview.jira.configured" variant="subtle" variant-color="gray">Belum dikonfigurasi</MpBadge>
          <MpBadge v-else-if="overview.jira.accountId" variant="subtle" variant-color="green">Terhubung</MpBadge>
          <MpBadge v-else variant="subtle" variant-color="orange">Belum terhubung</MpBadge>
        </div>

        <template v-if="overview.jira.configured">
          <div v-if="overview.jira.accountId" :class="[muted, between]">
            <div>
              <MpText weight="semiBold">{{ overview.jira.displayName }}</MpText>
              <MpText size="label-small" color="text.secondary">{{ overview.jira.baseUrl }}</MpText>
            </div>
            <MpButton variant="ghost" size="sm" :is-loading="busy === 'jira-off'"
              @click="act('jira-off', () => unwrap(api.connections.jira.delete()), 'Jira diputus')">Putuskan</MpButton>
          </div>

          <div v-else :class="css({ display: 'flex', flexDirection: 'column', gap: '3' })">
            <MpButton :is-loading="busy === 'jira-auto'" left-icon="data-connect"
              @click="act('jira-auto', () => unwrap(api.connections.jira.auto.post()), 'Jira terhubung')">
              Hubungkan otomatis (via email Mekari)
            </MpButton>
            <MpText size="label-small" color="text.secondary">Tidak ketemu? Cari manual:</MpText>
            <div :class="row">
              <MpInput v-model="jiraQuery" placeholder="Nama atau email" @keyup.enter="searchJira" />
              <MpButton variant="secondary" @click="searchJira">Cari</MpButton>
            </div>
            <div v-if="jiraResults.length" :class="list">
              <div v-for="u in jiraResults" :key="u.accountId" :class="listItem">
                <MpAvatar :name="u.displayName" :src="u.avatarUrl ?? undefined" size="sm" />
                <MpText :class="css({ flex: 1 })">{{ u.displayName }}</MpText>
                <MpButton size="sm" variant="secondary"
                  @click="act('jira-set', () => unwrap(api.connections.jira.put({ accountId: u.accountId })), 'Jira terhubung')">Pilih</MpButton>
              </div>
            </div>
          </div>

          <div v-if="overview.jira.accountId" :class="css({ display: 'flex', flexDirection: 'column', gap: '2' })">
            <MpText weight="semiBold">Board untuk Kanban</MpText>
            <MpText size="label-small" color="text.secondary">
              Opsional. Tanpa board, kanban dikelompokkan per status category (To Do / In Progress / Done).
            </MpText>
            <div :class="row">
              <MpInput v-model="boardQuery" placeholder="Cari nama board, mis. MESIGN" @keyup.enter="searchBoards" />
              <MpButton variant="secondary" @click="searchBoards">Cari</MpButton>
            </div>
            <MpSelect :model-value="overview.jira.boardId ?? ''" placeholder="Tanpa board" is-clearable @change="(e: Event) => onBoardChange((e.target as HTMLSelectElement).value)" @clear="onBoardChange('')">
              <option v-if="overview.jira.boardId && !boards.some((b) => b.id === overview?.jira.boardId)" :value="overview.jira.boardId">
                Board #{{ overview.jira.boardId }}
              </option>
              <option v-for="b in boards" :key="b.id" :value="b.id">{{ b.name }} ({{ b.type }}{{ b.project ? ` · ${b.project}` : '' }})</option>
            </MpSelect>
          </div>
        </template>
        <MpText v-else size="label" color="text.secondary">Admin perlu mengisi JIRA_BASE_URL, JIRA_EMAIL dan JIRA_API_TOKEN.</MpText>
      </section>

      <!-- Bitbucket -->
      <section :class="card">
        <div :class="between">
          <div :class="row">
            <MpIcon name="file-code" />
            <MpText size="h3" weight="semiBold">Bitbucket</MpText>
          </div>
          <MpBadge v-if="!overview.bitbucket.configured" variant="subtle" variant-color="gray">Belum dikonfigurasi</MpBadge>
          <MpBadge v-else-if="overview.bitbucket.uuid" variant="subtle" variant-color="green">Terhubung</MpBadge>
          <MpBadge v-else variant="subtle" variant-color="orange">Belum terhubung</MpBadge>
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
              @click="act('bb-off', () => unwrap(api.connections.bitbucket.delete()), 'Bitbucket diputus')">Putuskan</MpButton>
          </div>

          <div v-else :class="css({ display: 'flex', flexDirection: 'column', gap: '3' })">
            <MpButton :is-loading="busy === 'bb-auto'" left-icon="data-connect"
              @click="act('bb-auto', () => unwrap(api.connections.bitbucket.auto.post()), 'Bitbucket terhubung')">
              Hubungkan otomatis (via akun Atlassian)
            </MpButton>
            <MpText size="label-small" color="text.secondary">Hubungkan Jira dulu agar pencocokan otomatis akurat. Atau cari manual:</MpText>
            <div :class="row">
              <MpInput v-model="bbQuery" placeholder="Nama atau username" @keyup.enter="searchBb" />
              <MpButton variant="secondary" @click="searchBb">Cari</MpButton>
            </div>
            <div v-if="bbResults.length" :class="list">
              <div v-for="m in bbResults" :key="m.uuid" :class="listItem">
                <MpAvatar :name="m.displayName" :src="m.avatarUrl ?? undefined" size="sm" />
                <div :class="css({ flex: 1 })">
                  <MpText>{{ m.displayName }}</MpText>
                  <MpText v-if="m.nickname" size="label-small" color="text.secondary">@{{ m.nickname }}</MpText>
                </div>
                <MpButton size="sm" variant="secondary"
                  @click="act('bb-set', () => unwrap(api.connections.bitbucket.put({ uuid: m.uuid })), 'Bitbucket terhubung')">Pilih</MpButton>
              </div>
            </div>
          </div>
        </template>
        <MpText v-else size="label" color="text.secondary">Admin perlu mengisi BITBUCKET_WORKSPACE dan token Bitbucket.</MpText>
      </section>
    </div>
  </AsyncState>
</template>
