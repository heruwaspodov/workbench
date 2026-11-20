<script setup lang="ts">
import {
  MpBadge, MpBanner, MpBannerDescription, MpBannerTitle, MpButton, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter,
  MpModalHeader, MpModalOverlay, MpTable, MpTableBody, MpTableCell, MpTableContainer, MpTableHead, MpTableRow, MpText, css,
} from '@mekari/pixel3'
import { onMounted, ref, watch } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import SearchInput from '@/components/SearchInput.vue'
import { api, notifyError, notifySuccess, unwrap } from '@/lib/api'
import { formatDate, timeAgo } from '@/lib/format'
import { ui } from '@/lib/ui'
import { useAsync } from '@/lib/use-async'
import { useAuth } from '@/stores/auth'

const auth = useAuth()

const query = ref('')
const applied = ref('')
const page = ref(1)
const pageSize = ref(20)

const { data, loading, error, run } = useAsync(() =>
  unwrap(api.users.get({ query: { q: applied.value || undefined, page: page.value, pagelen: pageSize.value } })),
)
onMounted(run)
watch(page, run)
watch(pageSize, () => { if (page.value === 1) run(); else page.value = 1 })
function search() {
  applied.value = query.value.trim()
  if (page.value === 1) run()
  else page.value = 1
}

type Row = NonNullable<typeof data.value>['items'][number]

/** The person a confirmation is open for, and whether the change would grant or remove admin. */
const target = ref<{ row: Row; admin: boolean } | null>(null)
const saving = ref(false)
async function confirm() {
  if (!target.value) return
  saving.value = true
  try {
    await unwrap(api.users({ id: target.value.row.id }).admin.put({ admin: target.value.admin }))
    notifySuccess(target.value.admin ? `${target.value.row.name} is now an admin` : `${target.value.row.name} is no longer an admin`)
    target.value = null
    await run()
  } catch (e) { notifyError(e) } finally { saving.value = false }
}

const bar = css({ display: 'flex', gap: '3', mb: '5', maxWidth: '520px' })
const who = css({ display: 'flex', flexDirection: 'column', gap: '1', minWidth: 0 })
</script>

<template>
  <PageHeader title="Users" subtitle="People who have signed in to Workbench. Admins can manage templates, SLA goals, initiatives and other admins." />

  <MpBanner v-if="data?.fallback" variant="info" :class="css({ mb: '5' })" data-test="env-fallback">
    <MpBannerTitle>Admins currently come from the ADMIN_EMAILS setting</MpBannerTitle>
    <MpBannerDescription>
      No one has been made admin here yet. When you make the first admin, the people listed in that setting who have signed in move into this list,
      and the setting is no longer used.
    </MpBannerDescription>
  </MpBanner>

  <div :class="bar">
    <SearchInput v-model="query" placeholder="Search by name or email" @enter="search" />
    <MpButton variant="secondary" @click="search">Search</MpButton>
  </div>

  <AsyncState :loading="loading && !data" :error="error" :empty="data?.items.length === 0" :empty-text="applied ? 'No one matches your search.' : 'No one has signed in yet.'" @retry="run">
    <div v-if="data" :class="ui.panel">
      <MpTableContainer>
        <MpTable is-hoverable :class="ui.table">
          <MpTableHead>
            <MpTableRow>
              <MpTableCell as="th">Name</MpTableCell>
              <MpTableCell as="th">Role</MpTableCell>
              <MpTableCell as="th">Admin since</MpTableCell>
              <MpTableCell as="th">Last sign-in</MpTableCell>
              <MpTableCell as="th" />
            </MpTableRow>
          </MpTableHead>
          <MpTableBody>
            <MpTableRow v-for="u in data.items" :key="u.id" data-row :data-email="u.email">
              <MpTableCell>
                <div :class="who">
                  <MpText weight="semiBold">{{ u.name }}<MpText v-if="u.id === auth.me?.id" as="span" size="label-small" color="text.secondary"> (you)</MpText></MpText>
                  <MpText size="label-small" color="text.secondary">{{ u.email }}</MpText>
                </div>
              </MpTableCell>
              <MpTableCell>
                <MpBadge v-if="u.isAdmin" variant="subtle" variant-color="blue" data-test="badge-admin">{{ u.adminSource === 'env' ? 'Admin (ADMIN_EMAILS)' : 'Admin' }}</MpBadge>
                <MpBadge v-else variant="subtle" variant-color="gray">Member</MpBadge>
              </MpTableCell>
              <MpTableCell>
                <div v-if="u.adminSince" :class="who">
                  <MpText size="label">{{ formatDate(u.adminSince) }}</MpText>
                  <MpText v-if="u.grantedBy" size="label-small" color="text.secondary">by {{ u.grantedBy }}</MpText>
                </div>
                <span v-else>-</span>
              </MpTableCell>
              <MpTableCell>{{ timeAgo(u.lastLoginAt) }}</MpTableCell>
              <MpTableCell>
                <MpButton v-if="!u.isAdmin" size="sm" variant="secondary" data-test="make-admin" @click="target = { row: u, admin: true }">Make admin</MpButton>
                <MpButton v-else-if="u.adminSource === 'table' && u.id !== auth.me?.id" size="sm" variant="ghost" data-test="remove-admin" @click="target = { row: u, admin: false }">Remove admin</MpButton>
              </MpTableCell>
            </MpTableRow>
          </MpTableBody>
        </MpTable>
      </MpTableContainer>
      <PaginationBar v-model:page="page" v-model:page-size="pageSize" :shown="data.items.length" :total="data.total" :has-next="data.hasNext" />
    </div>
  </AsyncState>

  <MpModal :is-open="target != null" size="md" @close="!saving && (target = null)">
    <MpModalOverlay />
    <MpModalContent>
      <MpModalHeader>{{ target?.admin ? 'Make this person an admin?' : 'Remove admin access?' }}<MpModalCloseButton /></MpModalHeader>
      <MpModalBody>
        <MpText :class="css({ wordBreak: 'break-word' })">
          <template v-if="target?.admin">
            <b>{{ target.row.name }}</b> will be able to manage PGP templates, SLA goals, initiatives and other admins, and to read every PGP.
          </template>
          <template v-else-if="target">
            <b>{{ target.row.name }}</b> will lose admin access straight away. They can be made an admin again later.
          </template>
        </MpText>
      </MpModalBody>
      <MpModalFooter>
        <MpButton variant="ghost" :is-disabled="saving" @click="target = null">Cancel</MpButton>
        <MpButton :variant="target?.admin ? 'primary' : 'danger'" :is-loading="saving" data-test="confirm-admin" @click="confirm">
          {{ target?.admin ? 'Make admin' : 'Remove admin' }}
        </MpButton>
      </MpModalFooter>
    </MpModalContent>
  </MpModal>
</template>
