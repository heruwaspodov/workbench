<script setup lang="ts">
import { MpAvatar, MpBadge, MpButton, MpText, css } from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import UserPicker from '@/components/UserPicker.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { useAsync } from '@/lib/use-async'

const { data, loading, error, run } = useAsync(() => unwrap(api.org.me.get()))
onMounted(run)

const busy = ref<string | null>(null)
async function act(key: string, fn: () => Promise<unknown>, success: string) {
  busy.value = key
  try { await fn(); notifySuccess(success); await run() } catch (e) { notifyError(e) } finally { busy.value = null }
}

const accept = (id: string) => act(`acc-${id}`, () => unwrap(api.org.requests({ id }).accept.post()), 'Permintaan diterima')
const reject = (id: string) => act(`rej-${id}`, () => unwrap(api.org.requests({ id }).reject.post()), 'Permintaan ditolak')
const cancel = (id: string) => act(`can-${id}`, () => unwrap(api.org.requests({ id }).delete()), 'Permintaan dibatalkan')
const dropReport = (userId: string) => act(`rep-${userId}`, () => unwrap(api.org.reports({ userId }).delete()), 'Direct report dilepas')
const dropLeader = () => act('leader', () => unwrap(api.org.leader.delete()), 'Direct leader dilepas')
const proposeLeader = (userId: string) => act(`lead-${userId}`, () => unwrap(api.org.requests.leader.post({ userId })), 'Permintaan dikirim, menunggu konfirmasi')
const proposeReport = (userId: string) => act(`add-${userId}`, () => unwrap(api.org.requests.report.post({ userId })), 'Permintaan dikirim, menunggu konfirmasi')

const outgoingAsReport = computed(() => data.value?.outgoing.filter((r) => r.direction === 'as_report') ?? [])
const outgoingAsLeader = computed(() => data.value?.outgoing.filter((r) => r.direction === 'as_leader') ?? [])
const busyOf = (prefix: string) => (busy.value?.startsWith(prefix) ? busy.value.slice(prefix.length) : null)

const grid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', lg: '1fr 1fr' }, gap: '4', alignItems: 'start' })
const card = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', p: '5', display: 'flex', flexDirection: 'column', gap: '3' })
const banner = css({ bg: 'background.neutral.subtle', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', p: '4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', flexWrap: 'wrap' })
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
            {{ r.direction === 'as_leader' ? 'mengajukan kamu sebagai direct leader' : 'ingin menambahkan kamu sebagai direct report' }}
          </MpText>
        </div>
        <div :class="row">
          <MpButton size="sm" :is-loading="busy === `acc-${r.requestId}`" @click="accept(r.requestId)">Terima</MpButton>
          <MpButton size="sm" variant="secondary" :is-loading="busy === `rej-${r.requestId}`" @click="reject(r.requestId)">Tolak</MpButton>
        </div>
      </div>

      <div :class="grid">
        <section :class="card">
          <MpText size="h3" weight="semiBold">Direct leader saya</MpText>
          <div v-if="data.leader" :class="rowBetween">
            <div :class="row">
              <MpAvatar :name="data.leader.name" :src="data.leader.avatarUrl ?? undefined" size="sm" />
              <div>
                <MpText weight="semiBold">{{ data.leader.name }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ data.leader.email }}</MpText>
              </div>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === 'leader'" @click="dropLeader">Lepas</MpButton>
          </div>
          <MpText v-else size="label" color="text.secondary">Belum ada. Ajukan atasanmu agar dia bisa melihat PGP-mu (hanya baca).</MpText>

          <div v-for="r in outgoingAsReport" :key="r.requestId" :class="rowBetween">
            <div :class="row">
              <MpText>{{ r.user.name }}</MpText>
              <MpBadge variant="subtle" variant-color="orange">Menunggu konfirmasi</MpBadge>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `can-${r.requestId}`" @click="cancel(r.requestId)">Batalkan</MpButton>
          </div>

          <UserPicker v-if="!data.leader" placeholder="Cari nama atau email atasan" action-label="Ajukan sebagai atasan"
            :busy-id="busyOf('lead-')" @pick="proposeLeader" />
        </section>

        <section :class="card">
          <MpText size="h3" weight="semiBold">Direct report saya</MpText>
          <MpText v-if="!data.reports.length && !outgoingAsLeader.length" size="label" color="text.secondary">Belum ada bawahan.</MpText>

          <div v-for="u in data.reports" :key="u.id" :class="rowBetween">
            <div :class="row">
              <MpAvatar :name="u.name" :src="u.avatarUrl ?? undefined" size="sm" />
              <div>
                <MpText weight="semiBold">{{ u.name }}</MpText>
                <MpText size="label-small" color="text.secondary">{{ u.email }}</MpText>
              </div>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `rep-${u.id}`" @click="dropReport(u.id)">Lepas</MpButton>
          </div>

          <div v-for="r in outgoingAsLeader" :key="r.requestId" :class="rowBetween">
            <div :class="row">
              <MpText>{{ r.user.name }}</MpText>
              <MpBadge variant="subtle" variant-color="orange">Menunggu konfirmasi</MpBadge>
            </div>
            <MpButton size="sm" variant="ghost" :is-loading="busy === `can-${r.requestId}`" @click="cancel(r.requestId)">Batalkan</MpButton>
          </div>

          <UserPicker placeholder="Cari nama atau email bawahan" action-label="Tambah sebagai bawahan"
            :busy-id="busyOf('add-')" @pick="proposeReport" />
        </section>
      </div>
    </div>
  </AsyncState>
</template>
