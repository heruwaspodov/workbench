import type { api } from './api'

/** What the server returns when it reads an uploaded growth-plan workbook (same for plans and templates). */
export type XlsxPreview = NonNullable<Awaited<ReturnType<typeof api.pgp.plans.import.xlsx.preview.post>>['data']>
export type XlsxLoader = (file: File, tab?: string) => Promise<XlsxPreview>
