<script setup lang="ts">
/**
 * File picker + sheet selector for importing a growth-plan .xlsx. Shared by Create PGP and the template editor:
 * both read the file through the same server extractor, so the same file gives the same items.
 */
import { MpFormControl, MpFormHelpText, MpFormLabel, MpSelect, MpText, css } from '@mekari/pixel3'
import { ref } from 'vue'
import { notifyError } from '@/lib/api'
import type { XlsxLoader, XlsxPreview } from '@/lib/xlsx-import'

const props = defineProps<{ load: XlsxLoader }>()
const emit = defineEmits<{ loaded: [preview: XlsxPreview, file: File]; cleared: [] }>()

const file = ref<File | null>(null)
const tabs = ref<string[]>([])
const selected = ref('')
const reading = ref(false)

async function read(tab?: string) {
  if (!file.value) return
  reading.value = true
  try {
    const p = await props.load(file.value, tab)
    tabs.value = p.tabs
    selected.value = p.selectedTab
    emit('loaded', p, file.value)
  } catch (e) {
    tabs.value = []
    emit('cleared')
    notifyError(e)
  } finally { reading.value = false }
}
function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
  tabs.value = []
  emit('cleared')
  read()
}

const row = css({ display: 'flex', gap: '4', alignItems: 'flex-end', flexWrap: 'wrap' })
</script>

<template>
  <div :class="row">
    <MpFormControl>
      <MpFormLabel>Excel file (.xlsx, up to 10 MB)</MpFormLabel>
      <input type="file" accept=".xlsx" data-test="xlsx-file" @change="onFile" />
      <MpFormHelpText>Google Sheets: File, Download, Microsoft Excel (.xlsx).</MpFormHelpText>
    </MpFormControl>
    <MpFormControl v-if="tabs.length > 1" :class="css({ minWidth: '220px' })">
      <MpFormLabel>Sheet</MpFormLabel>
      <MpSelect :model-value="selected" @change="(e: Event) => read((e.target as HTMLSelectElement).value)">
        <option v-for="t in tabs" :key="t" :value="t">{{ t }}</option>
      </MpSelect>
    </MpFormControl>
    <MpText v-if="reading" size="label" color="text.secondary">Reading the file…</MpText>
  </div>
</template>
