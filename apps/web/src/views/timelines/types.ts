import type { api } from '@/lib/api'

/** One initiative as the API returns it (dates arrive as Date objects, see `isoDay`). */
export type Initiative = NonNullable<Awaited<ReturnType<typeof api.initiatives.get>>['data']>[number]

export const STATUS_COLOR = { done: 'green', active: 'blue', todo: 'gray' } as const

/** The status shown on cards and rows: the project status when there is one, otherwise the Jira epic status. */
export const statusText = (r: Pick<Initiative, 'projectStatus' | 'epicStatus'>) => r.projectStatus || r.epicStatus

export const progressText = (r: Pick<Initiative, 'doneItems' | 'totalItems'>) =>
  r.totalItems ? `${r.doneItems ?? 0}/${r.totalItems} · ${Math.round(((r.doneItems ?? 0) / r.totalItems) * 100)}%` : '-'

export const remarkOf = (r: Pick<Initiative, 'remark' | 'remarkProposed'>) => r.remark || r.remarkProposed || ''
