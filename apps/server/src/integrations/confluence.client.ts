import { env } from '../config/env'
import { AppError } from '../shared/errors'
import { basicAuth, createHttpClient } from './http'
import { jiraConfigured } from './jira.client'

/** Confluence Cloud client. Same Atlassian service account as Jira; the site is `{JIRA_BASE_URL}/wiki`. */
const http = createHttpClient({
  service: 'Confluence',
  baseUrl: '',
  authorization: () => {
    if (!jiraConfigured()) throw new AppError(503, 'Atlassian service account is not configured', 'JIRA_NOT_CONFIGURED')
    return basicAuth(env.jira.email!, env.jira.apiToken!)
  },
})

export interface ConfluenceSearchResult {
  content?: { id: string; type: string }
  title: string
  url: string
  lastModified?: string
  resultGlobalContainer?: { title?: string }
}
export interface ConfluenceSearch { results: ConfluenceSearchResult[]; totalSize?: number; size?: number }

export const confluence = {
  /** Base of the wiki site, read per call so it follows the current config. */
  wikiUrl: () => `${env.jira.baseUrl}/wiki`,

  search: (cql: string, start: number, limit: number) =>
    http<ConfluenceSearch>(`${env.jira.baseUrl}/wiki/rest/api/search`, { query: { cql, start, limit } }),
}
