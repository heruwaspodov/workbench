<script setup lang="ts">
import { MpAvatar, MpBadge, MpButton, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import UserPicker from '@/components/UserPicker.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'

const auth = useAuth()

const { data, loading, error, run } = useAsync(() => unwrap(api.org.me.get()))
onMounted(run)

const busy = ref<string | null>(null)
async function act(key: string, fn: () => Promise<unknown>, success: string) {
  busy.value = key
  try { await fn(); notifySuccess(success); await Promise.all([run(), auth.load()]) } catch (e) { notifyError(e) } finally { busy.value = null }
}

const accept = (id: string) => act(`acc-${id}`, () => unwrap(api.org.requests({ id }).accept.post()), 'Request accepted')
const reject = (id: string) => act(`rej-${id}`, () => unwrap(api.org.requests({ id }).reject.post()), 'Request declined')
const cancel = (id: string) => act(`can-${id}`, () => unwrap(api.org.requests({ id }).delete()), 'Request cancelled')
const dropReport = (userId: string) => act(`rep-${userId}`, () => unwrap(api.org.reports({ userId }).delete()), 'Direct report removed')
const dropLeader = () => act('leader', () => unwrap(api.org.leader.delete()), 'Direct leader removed')
const proposeLeader = (userId: string) => act(`lead-${userId}`, () => unwrap(api.org.requests.leader.post({ userId })), 'Request sent, awaiting confirmation')
const proposeReport = (userId: string) => act(`add-${userId}`, () => unwrap(api.org.requests.report.post({ userId })), 'Request sent, awaiting confirmation')

const outgoingAsReport = computed(() => data.value?.outgoing.filter((r) => r.direction === 'as_report') ?? [])
const outgoingAsLeader = computed(() => data.value?.outgoing.filter((r) => r.direction === 'as_leader') ?? [])
const busyOf = (prefix: string) => (busy.value?.startsWith(prefix) ? busy.value.slice(prefix.length) : null)

const grid = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' }, gap: '4', alignItems: 'start' })
const card = `${ui.card} ${css({ display: 'flex', flexDirection: 'column', gap: '3' })}`
const banner = css({ bg: 'background.information', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', p: '4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', flexWrap: 'wrap' })
const row = css({ display: 'flex', alignItems: 'center', gap: '3' })
const rowBetween = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })
const stack = css({ display: 'flex', flexDirection: 'column', gap: '3', mb: '6' })
</script>

<template>
  <AsyncState :loading="loading && !data" :error="error" @retry="run">
    <div v-if="data" :class="stack">
      <div v-for="r in data.incoming" :key="r.requestId" :class="banner">
        <div :class="row">
          <MpAvatar :name="r.user.name" :src="r.user.avatarUrl ?? undefined" size="sm" />
          <MpText>
            <b>{{ r.user.name }}</b>
            {{ r.direction === 'as_leader' ? 'wants you to be their direct leader' : 'wants to add you as their direct report' }}
          </MpText>
        </div>
        <div :class="row">
          <MpButton size="sm" :is-loading="busy === `acc-${r.requestId}`" @click="accept(r.requestId)">Accept</MpButton>
          <MpButton size="sm" variant="secondary" :is-loading="busy === `rej-${r.requestId}`" @click="reject(r.requestId)">Decline</MpButton>
        </div>
      </div>

      <div :class="grid">
        <section :class="card">
          <MpText size="h3" weight="semiBold">My direct leader</MpText>
          <div v-if="data.leader" :class="rowBetween">
            <div :class="row">
              <MpAvatar :name="data.leader.name" :src="data.leader.avatarUrl ?? undefined" size="sm" />
              <div>
                <MpText weight="semiBold">{{ data.leader.name }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ data.leader.email }}</MpText>
              </div>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === 'leader'" @click="dropLeader">Remove</MpButton>
          </div>
          <MpText v-else size="label" color="text.secondary">None yet. Request your leader so they can view your PGP (read-only).</MpText>

          <div v-for="r in outgoingAsReport" :key="r.requestId" :class="rowBetween">
            <div :class="row">
              <MpText>{{ r.user.name }}</MpText>
              <MpBadge variant="subtle" variant-color="orange">Awaiting confirmation</MpBadge>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `can-${r.requestId}`" @click="cancel(r.requestId)">Cancel request</MpButton>
          </div>

          <UserPicker v-if="!data.leader" placeholder="Search your leader by name or email" action-label="Request as leader"
            :busy-id="busyOf('lead-')" @pick="proposeLeader" />
        </section>

        <section :class="card">
          <MpText size="h3" weight="semiBold">My direct reports</MpText>
          <MpText v-if="!data.reports.length && !outgoingAsLeader.length" size="label" color="text.secondary">No direct reports yet.</MpText>

          <div v-for="u in data.reports" :key="u.id" :class="rowBetween">
            <div :class="row">
              <MpAvatar :name="u.name" :src="u.avatarUrl ?? undefined" size="sm" />
              <div>
                <MpText weight="semiBold">{{ u.name }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ u.email }}</MpText>
              </div>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `rep-${u.id}`" @click="dropReport(u.id)">Remove</MpButton>
          </div>

          <div v-for="r in outgoingAsLeader" :key="r.requestId" :class="rowBetween">
            <div :class="row">
              <MpText>{{ r.user.name }}</MpText>
              <MpBadge variant="subtle" variant-color="orange">Awaiting confirmation</MpBadge>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `can-${r.requestId}`" @click="cancel(r.requestId)">Cancel request</MpButton>
          </div>

          <UserPicker placeholder="Search a report by name or email" action-label="Add as report"
            :busy-id="busyOf('add-')" @pick="proposeReport" />
        </section>
      </div>
    </div>
  </AsyncState>
</template>
