<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpBannerTitle, MpButton, MpFormControl, MpFormHelpText, MpFormLabel, MpInput,
  MpSelect, MpTab, MpTabList, MpTabPanel, MpTabPanels, MpTabs, MpTable, MpTableBody, MpTableCell, MpTableContainer,
  MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import ItemsEditor from '@/components/ItemsEditor.vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { type EditableItem, guessPeriod, stripKeys, toEditable, totals } from '@/lib/pgp'
import { useAsync } from '@/lib/use-async'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const isNew = computed(() => !props.id)

const title = ref('')
const period = ref(guessPeriod())
const status = ref<'draft' | 'published' | 'archived'>('draft')
const source = ref<'scratch' | 'google_sheet' | 'xlsx'>('scratch')
const sourceRef = ref<string | undefined>()
const items = ref<EditableItem[]>([])
const warnings = ref<string[]>([])
const saving = ref(false)
const sum = computed(() => totals(items.value))

// ----- load existing -----
const { loading, error, run } = useAsync(async () => {
  if (!props.id) return null
  const tpl = await unwrap(api.pgp.templates({ id: props.id }).get())
  title.value = tpl.title
  period.value = tpl.period
  status.value = tpl.status
  source.value = tpl.source
  items.value = toEditable(tpl.items)
  return tpl
})
const { data: planList, loading: plansLoading, error: plansError, run: runPlans } =
  useAsync(() => (props.id ? unwrap(api.pgp.templates({ id: props.id }).plans.get()) : Promise.resolve([])))
onMounted(() => { run(); runPlans() })

// ----- import: Google Sheet -----
const sheetUrl = ref('')
const sheetTabs = ref<{ id: number; title: string }[]>([])
const sheetTab = ref('')
const serviceAccount = ref<string | null>(null)
const importing = ref(false)

async function loadTabs() {
  importing.value = true
  try {
    const res = await unwrap(api.pgp.templates.import.sheet.tabs.get({ query: { url: sheetUrl.value } }))
    sheetTabs.value = res.tabs
    serviceAccount.value = res.serviceAccount
    sheetTab.value = res.tabs[0]?.title ?? ''
    if (!title.value) title.value = res.title
  } catch (e) { notifyError(e) } finally { importing.value = false }
}

type Preview = {
  items: Pick<EditableItem, 'companyOkr' | 'objective' | 'keyResult' | 'weight' | 'initiative'>[]
  warnings: string[]
  meta: { period?: string }
  sourceRef: string
}
function applyPreview(p: Preview, from: 'google_sheet' | 'xlsx') {
  items.value = toEditable(p.items.map(({ companyOkr, objective, keyResult, weight, initiative }) => ({ companyOkr, objective, keyResult, weight, initiative })))
  warnings.value = p.warnings
  source.value = from
  sourceRef.value = p.sourceRef
  if (p.meta.period) period.value = guessPeriod(`${p.meta.period} ${sheetTab.value}`)
  notifySuccess(`${p.items.length} item di-import, silakan review`)
}

async function previewSheet() {
  importing.value = true
  try {
    applyPreview(await unwrap(api.pgp.templates.import.sheet.preview.get({ query: { url: sheetUrl.value, tab: sheetTab.value } })), 'google_sheet')
  } catch (e) { notifyError(e) } finally { importing.value = false }
}

// ----- import: xlsx -----
const xlsxFile = ref<File | null>(null)
const xlsxTabs = ref<string[]>([])
const xlsxTab = ref('')
async function previewXlsx(tab?: string) {
  if (!xlsxFile.value) return
  importing.value = true
  try {
    const res = await unwrap(api.pgp.templates.import.xlsx.preview.post({ file: xlsxFile.value, tab }))
    xlsxTabs.value = res.tabs
    xlsxTab.value = res.selectedTab
    sheetTab.value = res.selectedTab
    applyPreview(res, 'xlsx')
  } catch (e) { notifyError(e) } finally { importing.value = false }
}
function onFile(e: Event) {
  xlsxFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
  if (!title.value && xlsxFile.value) title.value = xlsxFile.value.name.replace(/\.xlsx$/i, '')
  previewXlsx()
}

// ----- save -----
async function save() {
  if (!title.value.trim() || !period.value.trim()) return notifyError(new Error('Title dan period wajib diisi'))
  saving.value = true
  try {
    if (isNew.value) {
      const tpl = await unwrap(api.pgp.templates.post({
        title: title.value, period: period.value, source: source.value, sourceRef: sourceRef.value, items: stripKeys(items.value),
      }))
      notifySuccess('Template dibuat')
      await router.replace(`/pgp/templates/${tpl.id}`)
    } else {
      await unwrap(api.pgp.templates({ id: props.id! }).patch({ title: title.value, period: period.value }))
      const tpl = await unwrap(api.pgp.templates({ id: props.id! }).items.put({ items: stripKeys(items.value) }))
      items.value = toEditable(tpl.items)
      notifySuccess('Template disimpan')
    }
  } catch (e) { notifyError(e) } finally { saving.value = false }
}

async function setStatus(next: 'draft' | 'published' | 'archived') {
  try { status.value = (await unwrap(api.pgp.templates({ id: props.id! }).patch({ status: next }))).status; notifySuccess(`Template ${next}`) } catch (e) { notifyError(e) }
}

const card = css({ bg: 'background.surface', rounded: 'lg', borderWidth: '1px', borderColor: 'border.default', p: '5', mb: '4' })
const twoCol = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: '2fr 1fr' }, gap: '4' })
const row = css({ display: 'flex', gap: '2', alignItems: 'flex-end', flexWrap: 'wrap' })
</script>

<template>
  <AsyncState :loading="loading" :error="error" @retry="run">
    <PageHeader :title="isNew ? 'Template baru' : title || 'Template'" subtitle="Item bisa diedit, ditambah, dan diurutkan. Total weight harus 100% sebelum publish.">
      <template #before-title>
        <RouterLink to="/pgp/templates"><MpButton variant="textLink" size="sm" left-icon="chevrons-left">Templates</MpButton></RouterLink>
      </template>
      <MpBadge v-if="!isNew" variant="subtle" :variant-color="status === 'published' ? 'green' : status === 'archived' ? 'orange' : 'gray'">{{ status }}</MpBadge>
      <template v-if="!isNew">
        <MpButton v-if="status !== 'published'" variant="secondary" :is-disabled="sum.weight !== 100" @click="setStatus('published')">Publish</MpButton>
        <MpButton v-else variant="secondary" @click="setStatus('archived')">Archive</MpButton>
      </template>
      <MpButton :is-loading="saving" @click="save">{{ isNew ? 'Buat template' : 'Simpan' }}</MpButton>
    </PageHeader>

    <div :class="card">
      <div :class="twoCol">
        <MpFormControl is-required>
          <MpFormLabel>Title</MpFormLabel>
          <MpInput v-model="title" placeholder="Growth Plan Q4 2026 — Technology Engineering" />
        </MpFormControl>
        <MpFormControl is-required>
          <MpFormLabel>Period</MpFormLabel>
          <MpInput v-model="period" placeholder="2026-Q4" />
          <MpFormHelpText>Format YYYY-Qn, dipakai untuk urutan dan nama sheet export.</MpFormHelpText>
        </MpFormControl>
      </div>
    </div>

    <div v-if="isNew" :class="card">
      <MpTabs :default-value="0">
        <MpTabList>
          <MpTab>From scratch</MpTab>
          <MpTab>Import Google Sheet</MpTab>
          <MpTab>Upload Excel (.xlsx)</MpTab>
        </MpTabList>
        <MpTabPanels>
          <MpTabPanel>
            <MpText color="text.secondary">Mulai dengan tabel kosong, tambahkan item lewat tombol "Tambah item" di bawah.</MpText>
          </MpTabPanel>
          <MpTabPanel>
            <div :class="css({ display: 'flex', flexDirection: 'column', gap: '3' })">
              <div :class="row">
                <MpFormControl :class="css({ flex: 1, minWidth: '320px' })">
                  <MpFormLabel>URL Google Sheet</MpFormLabel>
                  <MpInput v-model="sheetUrl" placeholder="https://docs.google.com/spreadsheets/d/…" />
                </MpFormControl>
                <MpButton variant="secondary" :is-loading="importing && !sheetTabs.length" @click="loadTabs">Ambil tab</MpButton>
              </div>
              <div v-if="sheetTabs.length" :class="row">
                <MpFormControl :class="css({ minWidth: '240px' })">
                  <MpFormLabel>Tab</MpFormLabel>
                  <MpSelect v-model="sheetTab">
                    <option v-for="t in sheetTabs" :key="t.id" :value="t.title">{{ t.title }}</option>
                  </MpSelect>
                </MpFormControl>
                <MpButton :is-loading="importing" @click="previewSheet">Import tab ini</MpButton>
              </div>
              <MpText v-if="serviceAccount" size="label-small" color="text.secondary">
                Pastikan sheet di-share (Viewer) ke {{ serviceAccount }}.
              </MpText>
            </div>
          </MpTabPanel>
          <MpTabPanel>
            <div :class="row">
              <MpFormControl>
                <MpFormLabel>File .xlsx (Google Sheets → File → Download → Microsoft Excel)</MpFormLabel>
                <input type="file" accept=".xlsx" @change="onFile" />
              </MpFormControl>
              <MpFormControl v-if="xlsxTabs.length > 1" :class="css({ minWidth: '220px' })">
                <MpFormLabel>Sheet</MpFormLabel>
                <MpSelect :model-value="xlsxTab" @change="(e: Event) => previewXlsx((e.target as HTMLSelectElement).value)">
                  <option v-for="t in xlsxTabs" :key="t" :value="t">{{ t }}</option>
                </MpSelect>
              </MpFormControl>
            </div>
          </MpTabPanel>
        </MpTabPanels>
      </MpTabs>
    </div>

    <MpBanner v-if="warnings.length" variant="warning" :class="css({ mb: '4' })">
      <MpBannerTitle>Perlu dicek</MpBannerTitle>
      <MpBannerDescription><div v-for="w in warnings" :key="w">• {{ w }}</div></MpBannerDescription>
    </MpBanner>

    <ItemsEditor v-model="items" mode="template" />

    <div v-if="!isNew" :class="[card, css({ mt: '6' })]">
      <MpText size="h3" weight="semiBold" :class="css({ mb: '3' })">PGP yang memakai template ini</MpText>
      <AsyncState :loading="plansLoading" :error="plansError" :empty="!planList?.length" empty-text="Belum ada yang mengisi.">
        <MpTableContainer>
          <MpTable>
            <MpTableHead>
              <MpTableRow>
                <MpTableCell as="th">Nama</MpTableCell>
                <MpTableCell as="th">Status</MpTableCell>
                <MpTableCell as="th">Score</MpTableCell>
                <MpTableCell as="th" />
              </MpTableRow>
            </MpTableHead>
            <MpTableBody>
              <MpTableRow v-for="p in planList" :key="p.planId">
                <MpTableCell>{{ p.userName }}</MpTableCell>
                <MpTableCell><MpBadge variant="subtle" :variant-color="p.status === 'submitted' ? 'green' : 'gray'">{{ p.status }}</MpBadge></MpTableCell>
                <MpTableCell>{{ p.score }}%</MpTableCell>
                <MpTableCell><RouterLink :to="`/pgp/plans/${p.planId}`" :class="css({ color: 'text.link' })">Lihat</RouterLink></MpTableCell>
              </MpTableRow>
            </MpTableBody>
          </MpTable>
        </MpTableContainer>
      </AsyncState>
    </div>
  </AsyncState>
</template>
