import type { api } from './api'

/** What every uploaded-workbook preview has in common: the readable tabs and the one that was read. */
export interface XlsxTabs { tabs: string[]; selectedTab: string }

/** What the server returns when it reads an uploaded growth-plan workbook (same for plans and templates). */
export type XlsxPreview = NonNullable<Awaited<ReturnType<typeof api.pgp.plans.import.xlsx.preview.post>>['data']>
export type XlsxLoader<T extends XlsxTabs = XlsxPreview> = (file: File, tab?: string) => Promise<T>
