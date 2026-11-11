<script setup lang="ts">
/** Confirmation for deleting a PGP. Used by the plan page and the My PGP list so both say the same thing. */
import { MpButton, MpModal, MpModalBody, MpModalCloseButton, MpModalContent, MpModalFooter, MpModalHeader, MpModalOverlay, MpText, css } from '@mekari/pixel3'

defineProps<{ open: boolean; title: string; period: string; submitted: boolean; loading: boolean }>()
const emit = defineEmits<{ close: []; confirm: [] }>()
</script>

<template>
  <MpModal :is-open="open" size="md" @close="!loading && emit('close')">
    <MpModalOverlay />
    <MpModalContent>
      <MpModalHeader>Delete this PGP?<MpModalCloseButton /></MpModalHeader>
      <MpModalBody>
        <MpText :class="css({ wordBreak: 'break-word' })">
          <b>{{ title }}</b> ({{ period }}) and everything in it will be deleted: all items, current values, achievements and evidence links.
          This cannot be undone.
        </MpText>
        <MpText v-if="submitted" color="text.danger" :class="css({ mt: '3' })" data-test="delete-submitted-warning">
          This plan was submitted. Deleting it removes the submitted version too.
        </MpText>
        <MpText size="label" color="text.secondary" :class="css({ mt: '3' })">You can create a PGP for {{ period }} again afterwards.</MpText>
      </MpModalBody>
      <MpModalFooter>
        <MpButton variant="ghost" :is-disabled="loading" @click="emit('close')">Cancel</MpButton>
        <MpButton variant="danger" :is-loading="loading" data-test="confirm-delete" @click="emit('confirm')">Delete PGP</MpButton>
      </MpModalFooter>
    </MpModalContent>
  </MpModal>
</template>
