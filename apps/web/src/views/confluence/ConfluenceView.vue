<script setup lang="ts">
import { MpBadge, MpButton, MpIcon, MpText, css } from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import SearchInput from '@/components/SearchInput.vue'
import { api, unwrap } from '@/lib/api'
import { copyText, isHttpUrl } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'

const query = ref('')
const applied = ref('')
const page = ref(1)
const pageSize = ref(20)

const { data, loading, error, run } = useAsync(() =>
  unwrap(api.confluence.pages.get({ query: { role: 'creator', q: applied.value || undefined, page: page.value, pagelen: pageSize.value } })),
)
onMounted(run)
watch(page, run)
watch(pageSize, () => { if (page.value === 1) run(); else page.value = 1 })

function search() {
  applied.value = query.value.trim()
  if (page.value === 1) run()
  else page.value = 1
}

const bar = css({ display: 'flex', gap: '3', mb: '5', maxWidth: '520px' })
// One compact block per page (same pattern as the pull request list): nothing needs sideways scrolling.
const list = css({ borderTopWidth: '1px', borderColor: 'border.default.subtle' })
const row = css({
  display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: '3', alignItems: 'center',
  px: '4', py: '3', borderBottomWidth: '1px', borderColor: 'border.default.subtle', _hover: { bg: 'background.surface' },
})
const tile = css({ width: '9', height: '9', rounded: 'full', bg: 'background.surface', display: 'grid', placeItems: 'center', flexShrink: 0 })
const main = css({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1' })
const title = css({ display: 'block', truncate: true })
const meta = css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '2', rowGap: '1' })
</script>

<template>
  <PageHeader title="My Confluence" subtitle="Confluence pages you have created. Only the title, space and link are shown; page content is never displayed." />

  <div :class="bar">
    <SearchInput v-model="query" placeholder="Search your pages by title" @enter="search" />
    <MpButton variant="secondary" @click="search">Search</MpButton>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0"
    :empty-text="applied ? 'No pages match your search.' : 'You have not created any pages yet.'" @retry="run">
    <div v-if="data">
      <div :class="list">
        <div v-for="p in data.items" :key="p.id" :class="row" data-row>
          <div :class="tile"><MpIcon name="draft" size="sm" /></div>
          <div :class="main">
            <a v-if="isHttpUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer" :title="p.title" :class="[ui.link, title]">{{ p.title }}</a>
            <MpText v-else weight="semiBold" :class="title" :title="p.title">{{ p.title }}</MpText>
            <div :class="meta">
              <MpBadge v-if="p.space" size="sm" variant="subtle" variant-color="gray">{{ p.space }}</MpBadge>
              <MpText size="label-small" color="text.secondary">Last modified {{ formatDate(p.lastModified) }}</MpText>
            </div>
          </div>
          <MpButton size="sm" variant="ghost" left-icon="copy" @click="copyText(p.url)">Copy link</MpButton>
        </div>
      </div>
      <PaginationBar v-model:page="page" v-model:page-size="pageSize" :shown="data.items.length" :total="data.total" :has-next="data.hasNext" />
    </div>
  </AsyncState>
</template>
