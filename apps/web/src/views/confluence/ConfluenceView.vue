<script setup lang="ts">
import {
  MpBadge, MpButton, MpInput, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

const query = ref('')
const applied = ref('')
const page = ref(1)

const { data, loading, error, run } = useAsync(() =>
  unwrap(api.confluence.pages.get({ query: { role: 'creator', q: applied.value || undefined, page: page.value } })),
)
onMounted(run)
watch(page, run)

function search() {
  applied.value = query.value.trim()
  if (page.value === 1) run()
  else page.value = 1
}

const bar = css({ display: 'flex', gap: '3', mb: '4', maxWidth: '520px' })
const wrap = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', overflow: 'hidden' })
const link = css({ color: 'text.link', fontWeight: 'semiBold', textDecoration: 'none', _hover: { textDecoration: 'underline' } })
const actions = css({ display: 'flex', justifyContent: 'flex-end' })
const pager = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: '3', borderTopWidth: '1px', borderColor: 'border.default' })
</script>

<template>
  <PageHeader title="My Confluence" subtitle="Halaman Confluence yang pernah kamu buat. Hanya judul, space, dan link; isi halaman tidak ditampilkan." />

  <div :class="bar">
    <MpInput v-model="query" placeholder="Cari judul halaman" @keyup.enter="search" />
    <MpButton variant="secondary" @click="search">Cari</MpButton>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0"
    :empty-text="applied ? 'Tidak ada halaman yang cocok.' : 'Belum ada halaman yang kamu buat.'" @retry="run">
    <div v-if="data" :class="wrap">
      <MpTableContainer>
        <MpTable is-hoverable>
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Halaman</MpTableCell>
              <MpTableCell as="th">Space</MpTableCell>
              <MpTableCell as="th">Terakhir diubah</MpTableCell>
              <MpTableCell as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="p in data.items" :key="p.id">
              <MpTableCell :style="{ minWidth: '320px' }">
                <a v-if="isHttpUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer" :class="link">{{ p.title }}</a>
                <MpText v-else weight="semiBold">{{ p.title }}</MpText>
              </MpTableCell>
              <MpTableCell><MpBadge v-if="p.space" variant="subtle" variant-color="gray">{{ p.space }}</MpBadge></MpTableCell>
              <MpTableCell>{{ formatDate(p.lastModified) }}</MpTableCell>
              <MpTableCell>
                <div :class="actions">
                  <MpButton size="sm" variant="ghost" left-icon="link" @click="copyText(p.url)">Salin link</MpButton>
                </div>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
      <div :class="pager">
        <MpText size="label" color="text.secondary">{{ data.total }} halaman · halaman {{ data.page }}</MpText>
        <div :class="css({ display: 'flex', gap: '2' })">
          <MpButton size="sm" variant="secondary" :is-disabled="page === 1" @click="page--">Sebelumnya</MpButton>
          <MpButton size="sm" variant="secondary" :is-disabled="!data.hasNext" @click="page++">Berikutnya</MpButton>
        </div>
      </div>
    </div>
  </AsyncState>
</template>
