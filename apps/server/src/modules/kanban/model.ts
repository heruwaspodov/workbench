import { t } from 'elysia'

export const KanbanModel = {
  boardQuery: t.Object({
    scope: t.Optional(t.Union([t.Literal('sprint'), t.Literal('active')])),
  }),
  issueParams: t.Object({ key: t.String({ pattern: '^[A-Z][A-Z0-9_]+-\\d+$' }) }),
}

export interface KanbanCard {
  key: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done' | string
  issueType: string
  issueTypeIcon: string | null
  priority: string | null
  storyPoints: number | null
  sprint: string | null
  labels: string[]
  updated: string
  url: string
}
