<script setup lang="ts">
import {
  MpBadge, MpButton, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

const { data, loading, error, run } = useAsync(() => unwrap(api.pgp.templates.get()))
onMounted(run)

const STATUS = { draft: { label: 'Draft', color: 'gray' }, published: { label: 'Published', color: 'green' }, archived: { label: 'Archived', color: 'orange' } } as const
const SOURCE = { scratch: 'Manual', google_sheet: 'Google Sheet', xlsx: 'Excel' } as const

async function setStatus(id: string, status: 'draft' | 'published' | 'archived') {
  try { await unwrap(api.pgp.templates({ id }).patch({ status })); notifySuccess('Status template diubah'); run() } catch (e) { notifyError(e) }
}

const wrap = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', overflowX: 'auto' })
const actions = css({ display: 'flex', gap: '2', justifyContent: 'flex-end' })
</script>

<template>
  <PageHeader title="PGP Templates" subtitle="Format PGP per quarter dari management. Member hanya melihat template yang published.">
    <RouterLink to="/pgp/templates/new"><MpButton left-icon="add">Template baru</MpButton></RouterLink>
  </PageHeader>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.length === 0" empty-text="Belum ada template." @retry="run">
    <template #empty>
      <RouterLink to="/pgp/templates/new"><MpButton variant="secondary">Buat atau import template</MpButton></RouterLink>
    </template>
    <div :class="wrap">
      <MpTableContainer>
        <MpTable is-hoverable>
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Period</MpTableCell>
              <MpTableCell as="th">Title</MpTableCell>
              <MpTableCell as="th">Source</MpTableCell>
              <MpTableCell as="th">Items</MpTableCell>
              <MpTableCell as="th">Total weight</MpTableCell>
              <MpTableCell as="th">Status</MpTableCell>
              <MpTableCell as="th">Updated</MpTableCell>
              <MpTableCell as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="t in data" :key="t.id">
              <MpTableCell><MpText weight="semiBold">{{ t.period }}</MpText></MpTableCell>
              <MpTableCell>
                <RouterLink :to="`/pgp/templates/${t.id}`" :class="css({ color: 'text.link' })">{{ t.title }}</RouterLink>
              </MpTableCell>
              <MpTableCell>{{ SOURCE[t.source] }}</MpTableCell>
              <MpTableCell>{{ t.itemCount }}</MpTableCell>
              <MpTableCell>
                <MpText :color="t.totalWeight === 100 ? 'text.default' : 'text.danger'">{{ t.totalWeight }}%</MpText>
              </MpTableCell>
              <MpTableCell>
                <MpBadge variant="subtle" :variant-color="STATUS[t.status].color">{{ STATUS[t.status].label }}</MpBadge>
              </MpTableCell>
              <MpTableCell>{{ timeAgo(t.updatedAt) }}</MpTableCell>
              <MpTableCell>
                <div :class="actions">
                  <MpButton v-if="t.status !== 'published'" size="sm" variant="secondary" :is-disabled="t.totalWeight !== 100" @click="setStatus(t.id, 'published')">Publish</MpButton>
                  <MpButton v-if="t.status === 'published'" size="sm" variant="ghost" @click="setStatus(t.id, 'archived')">Archive</MpButton>
                  <RouterLink :to="`/pgp/templates/${t.id}`"><MpButton size="sm" variant="ghost" left-icon="edit">Edit</MpButton></RouterLink>
                </div>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
    </div>
  </AsyncState>
</template>
