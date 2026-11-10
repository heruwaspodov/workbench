import { env } from '../config/env'
import { AppError } from '../shared/errors'
import { basicAuth, createHttpClient } from './http'

/** Bitbucket Cloud client — workspace access token (Bearer) or email + API token (Basic). */
export const bitbucketConfigured = () =>
  Boolean(env.bitbucket.workspace && (env.bitbucket.accessToken || (env.bitbucket.email && env.bitbucket.apiToken)))

const http = createHttpClient({
  service: 'Bitbucket',
  baseUrl: () => env.bitbucket.apiUrl,
  authorization: () => {
    if (!bitbucketConfigured()) throw new AppError(503, 'Bitbucket service account is not configured', 'BITBUCKET_NOT_CONFIGURED')
    return env.bitbucket.accessToken
      ? `Bearer ${env.bitbucket.accessToken}`
      : basicAuth(env.bitbucket.email!, env.bitbucket.apiToken!)
  },
})

export interface Paged<T> { values: T[]; next?: string; page?: number; size?: number; pagelen?: number }
export interface BbUser {
  uuid: string
  display_name: string
  nickname?: string
  account_id?: string
  links?: { avatar?: { href: string } }
}
export interface BbPullRequest {
  id: number
  title: string
  description?: string
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
  draft?: boolean
  author: BbUser
  created_on: string
  updated_on: string
  comment_count?: number
  task_count?: number
  source: { branch: { name: string }; repository?: { full_name: string; name: string } }
  destination: { branch: { name: string }; repository: { full_name: string; name: string } }
  reviewers?: BbUser[]
  participants?: { user: BbUser; role: string; approved: boolean; state?: string | null }[]
  links: { html: { href: string } }
  merge_commit?: { hash: string } | null
}

const ws = () => encodeURIComponent(env.bitbucket.workspace ?? '')
const repoPath = (repo: string) => `/repositories/${ws()}/${encodeURIComponent(repo)}`

/** Follow `next` links up to `maxPages`. */
async function collect<T>(first: Paged<T>, maxPages: number): Promise<T[]> {
  const out = [...first.values]
  let next = first.next
  for (let i = 1; next && i < maxPages; i++) {
    const page = await http<Paged<T>>(next)
    out.push(...page.values)
    next = page.next
  }
  return out
}

export const bitbucket = {
  workspace: () => env.bitbucket.workspace,

  async members(): Promise<BbUser[]> {
    const first = await http<Paged<{ user: BbUser }>>(`/workspaces/${ws()}/members`, { query: { pagelen: 100 } })
    return (await collect(first, 20)).map((m) => m.user)
  },

  /** PRs authored by a user across every repo in the workspace. */
  userPullRequests: (userUuid: string, states: string[], page = 1, pagelen = 50) =>
    http<Paged<BbPullRequest>>(`/workspaces/${ws()}/pullrequests/${encodeURIComponent(userUuid)}`, {
      query: { state: states, page, pagelen, sort: '-updated_on' },
    }),

  /** PRs in a repo matching a BBQL filter. */
  repoPullRequests: (repo: string, q: string, pagelen = 50) =>
    http<Paged<BbPullRequest>>(`${repoPath(repo)}/pullrequests`, { query: { q, pagelen, sort: '-updated_on' } }),

  pullRequest: (repo: string, id: number) => http<BbPullRequest>(`${repoPath(repo)}/pullrequests/${id}`),

  diffstat: (repo: string, id: number) =>
    http<Paged<{ status: string; lines_added: number; lines_removed: number; old?: { path: string } | null; new?: { path: string } | null }>>(
      `${repoPath(repo)}/pullrequests/${id}/diffstat`, { query: { pagelen: 500 } }),

  commits: (repo: string, id: number) =>
    http<Paged<{ hash: string; message: string; date: string; author: { raw: string; user?: BbUser } }>>(
      `${repoPath(repo)}/pullrequests/${id}/commits`, { query: { pagelen: 50 } }),

  comments: (repo: string, id: number) =>
    http<Paged<{ id: number; content: { raw: string }; user: BbUser; created_on: string; deleted?: boolean; inline?: { path: string; to?: number | null } }>>(
      `${repoPath(repo)}/pullrequests/${id}/comments`, { query: { pagelen: 100 } }),

  statuses: (repo: string, id: number) =>
    http<Paged<{ key: string; name?: string; state: string; url?: string; updated_on?: string }>>(
      `${repoPath(repo)}/pullrequests/${id}/statuses`, { query: { pagelen: 50 } }),

  diff: (repo: string, id: number) => http<string>(`${repoPath(repo)}/pullrequests/${id}/diff`, { headers: { accept: 'text/plain' } }),
}
