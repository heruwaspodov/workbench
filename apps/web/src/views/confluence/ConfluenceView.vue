<script setup lang="ts">
import {
  MpBadge, MpButton, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/SearchInput.vue'
import { api, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import { ui } from '@/lib/ui'
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

const bar = css({ display: 'flex', gap: '3', mb: '5', maxWidth: '520px' })
const actions = css({ display: 'flex', justifyContent: 'flex-end' })
const pager = css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: '3', borderTopWidth: '1px', borderColor: 'border.default.subtle' })
</script>

<template>
  <PageHeader title="My Confluence" subtitle="Confluence pages you have created. Only the title, space and link are shown; page content is never displayed." />

  <div :class="bar">
    <SearchInput v-model="query" placeholder="Search page titles" @enter="search" />
    <MpButton variant="secondary" @click="search">Search</MpButton>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0"
    :empty-text="applied ? 'No pages match your search.' : 'You have not created any pages yet.'" @retry="run">
    <div v-if="data" :class="ui.flat">
      <MpTableContainer>
        <MpTable is-hoverable :class="ui.table">
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Page</MpTableCell>
              <MpTableCell as="th">Space</MpTableCell>
              <MpTableCell as="th">Last modified</MpTableCell>
              <MpTableCell as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="p in data.items" :key="p.id">
              <MpTableCell :style="{ minWidth: '320px' }">
                <a v-if="isHttpUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer" :class="ui.link">{{ p.title }}</a>
                <MpText v-else weight="semiBold">{{ p.title }}</MpText>
              </MpTableCell>
              <MpTableCell><MpBadge v-if="p.space" variant="subtle" variant-color="gray">{{ p.space }}</MpBadge></MpTableCell>
              <MpTableCell>{{ formatDate(p.lastModified) }}</MpTableCell>
              <MpTableCell>
                <div :class="actions">
                  <MpButton size="sm" variant="ghost" left-icon="copy" @click="copyText(p.url)">Copy link</MpButton>
                </div>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
      <div :class="pager">
        <MpText size="label" color="text.secondary">{{ data.total }} {{ data.total === 1 ? 'page' : 'pages' }} · page {{ data.page }}</MpText>
        <div :class="css({ display: 'flex', gap: '2' })">
          <MpButton size="sm" variant="secondary" :is-disabled="page === 1" @click="page--">Previous</MpButton>
          <MpButton size="sm" variant="secondary" :is-disabled="!data.hasNext" @click="page++">Next</MpButton>
        </div>
      </div>
    </div>
  </AsyncState>
</template>
