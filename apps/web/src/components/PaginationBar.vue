<script setup lang="ts">
import { MpButton, MpSelect, MpText, css } from '@mekari/pixel3'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  page: number
  pageSize: number
  /** Items on the current page. */
  shown: number
  total?: number | null
  hasNext: boolean
  pageSizes?: number[]
}>(), { total: null, pageSizes: () => [10, 20, 50] })
const emit = defineEmits<{ 'update:page': [page: number]; 'update:pageSize': [size: number] }>()

const from = computed(() => (props.shown ? (props.page - 1) * props.pageSize + 1 : 0))
const to = computed(() => (props.shown ? from.value + props.shown - 1 : 0))
const label = computed(() => (props.shown ? `Showing ${from.value}-${to.value}${props.total != null ? ` of ${props.total}` : ''}` : 'Showing 0'))

const bar = css({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '3', px: '4', py: '3',
})
const left = css({ display: 'flex', alignItems: 'center', gap: '3', flexWrap: 'wrap' })
const sizeSelect = css({ width: '84px' })
const arrows = css({ display: 'flex', gap: '1' })
</script>

<template>
  <div :class="bar">
    <div :class="left">
      <MpText size="label" color="text.secondary">Rows per page</MpText>
      <div :class="sizeSelect">
        <MpSelect size="sm" :model-value="pageSize" aria-label="Rows per page"
          @change="(e: Event) => emit('update:pageSize', Number((e.target as HTMLSelectElement).value))">
          <option v-for="n in pageSizes" :key="n" :value="n">{{ n }}</option>
        </MpSelect>
      </div>
      <MpText size="label" color="text.secondary">{{ label }}</MpText>
    </div>
    <div :class="arrows">
      <MpButton variant="ghost" size="sm" left-icon="chevrons-left" aria-label="Previous page" title="Previous page"
        :is-disabled="page <= 1" @click="emit('update:page', page - 1)" />
      <MpButton variant="ghost" size="sm" left-icon="chevrons-right" aria-label="Next page" title="Next page"
        :is-disabled="!hasNext" @click="emit('update:page', page + 1)" />
    </div>
  </div>
</template>
