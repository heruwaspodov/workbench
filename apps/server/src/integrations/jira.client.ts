import { env } from '../config/env'
import { AppError } from '../shared/errors'
import { basicAuth, createHttpClient } from './http'

/** Jira Cloud client authenticated as a service account (email + API token). */
export const jiraConfigured = () => Boolean(env.jira.baseUrl && env.jira.email && env.jira.apiToken)

const http = createHttpClient({
  service: 'Jira',
  baseUrl: () => env.jira.baseUrl,
  authorization: () => {
    if (!jiraConfigured()) throw new AppError(503, 'Jira service account is not configured', 'JIRA_NOT_CONFIGURED')
    return basicAuth(env.jira.email!, env.jira.apiToken!)
  },
})

export interface JiraUser {
  accountId: string
  displayName: string
  emailAddress?: string
  active?: boolean
  avatarUrls?: Record<string, string>
}
export interface JiraBoard { id: number; name: string; type: string; location?: { projectKey?: string; displayName?: string } }
export interface JiraBoardConfig {
  id: number
  name: string
  columnConfig: { columns: { name: string; statuses: { id: string }[] }[] }
  /** Board sub-filter. Jira's UI applies it; the Agile board-issues API does not. */
  subQuery?: { query?: string }
}
export interface JiraIssue {
  id: string
  key: string
  fields: Record<string, any>
}

export const jira = {
  baseUrl: env.jira.baseUrl,
  browseUrl: (key: string) => `${env.jira.baseUrl}/browse/${key}`,

  searchUsers: (query: string) =>
    http<JiraUser[]>('/rest/api/3/user/search', { query: { query, maxResults: 20 } }),

  getUser: (accountId: string) => http<JiraUser>('/rest/api/3/user', { query: { accountId } }),

  listBoards: (name?: string, projectKeyOrId?: string) =>
    http<{ values: JiraBoard[] }>('/rest/agile/1.0/board', { query: { name, projectKeyOrId, maxResults: 50 } }),

  getBoard: (boardId: number) => http<JiraBoard>(`/rest/agile/1.0/board/${boardId}`),

  boardConfig: (boardId: number) => http<JiraBoardConfig>(`/rest/agile/1.0/board/${boardId}/configuration`),

  boardIssues: (boardId: number, jql: string, fields: string[]) =>
    http<{ issues: JiraIssue[]; total: number }>(`/rest/agile/1.0/board/${boardId}/issue`, {
      query: { jql, fields: fields.join(','), maxResults: 200 },
    }),

  /** Enhanced JQL search (the legacy /search endpoint is deprecated). */
  search: (jql: string, fields: string[], maxResults = 100) =>
    http<{ issues: JiraIssue[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults }),
    }),

  getIssue: (key: string, fields: string[]) =>
    http<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields: fields.join(',') } }),

  getComments: (key: string) =>
    http<{ comments: { id: string; author?: JiraUser; body: unknown; created: string }[] }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { query: { maxResults: 50, orderBy: '-created' } }),
}
