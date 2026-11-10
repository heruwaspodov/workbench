import { t } from 'elysia'

export const PR_STATES = ['OPEN', 'MERGED', 'DECLINED'] as const

export const PullRequestsModel = {
  listQuery: t.Object({
    role: t.Optional(t.Union([t.Literal('author'), t.Literal('reviewer')])),
    state: t.Optional(t.Union([t.Literal('OPEN'), t.Literal('MERGED'), t.Literal('DECLINED'), t.Literal('ALL')])),
    repo: t.Optional(t.String()),
    page: t.Optional(t.Numeric({ minimum: 1 })),
    pagelen: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  }),
  detailParams: t.Object({
    repo: t.String({ pattern: '^[A-Za-z0-9._-]+$' }),
    id: t.String({ pattern: '^[1-9]\\d{0,9}$' }),
  }),
}

export interface PullRequestSummary {
  id: number
  repo: string
  title: string
  state: string
  draft: boolean
  author: { name: string; avatarUrl: string | null }
  sourceBranch: string
  destinationBranch: string
  commentCount: number
  taskCount: number
  approvals: number
  reviewers: { name: string; avatarUrl: string | null; approved: boolean; state: string | null }[]
  jiraKeys: string[]
  createdOn: string
  updatedOn: string
  url: string
}
