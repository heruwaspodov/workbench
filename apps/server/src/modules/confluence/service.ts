import type { User } from '../../db/schema'
import { confluence, type ConfluenceSearchResult } from '../../integrations/confluence.client'
import { cached } from '../../shared/cache'
import { ConnectionsService } from '../connections/service'
import type { ConfluencePage } from './model'

const DEFAULT_PAGELEN = 20

/** Quote a value for a CQL string literal. */
const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// The search API wraps matched terms in highlight markers.
const clean = (s: string) => s.replace(/@@@(?:end)?hl@@@/g, '')

const toPage = (r: ConfluenceSearchResult): ConfluencePage | null => {
  if (!r.content?.id || !r.url?.startsWith('/')) return null
  return {
    id: r.content.id,
    title: clean(r.title),
    space: r.resultGlobalContainer?.title ? clean(r.resultGlobalContainer.title) : null,
    url: `${confluence.wikiUrl()}${r.url}`,
    lastModified: r.lastModified ?? null,
  }
}

export abstract class ConfluenceService {
  /**
   * Pages the user created or contributed to. Metadata only: no body or excerpt ever leaves this service,
   * and the filter is the user's own Atlassian accountId (the service account sees more than one person should).
   */
  static async pages(user: User, opts: { role?: 'creator' | 'contributor'; days?: number; q?: string; page?: number; pagelen?: number }) {
    const { accountId } = await ConnectionsService.requireJira(user)
    const role = opts.role ?? 'creator'
    const page = opts.page ?? 1
    const pagelen = opts.pagelen ?? DEFAULT_PAGELEN
    const term = opts.q?.trim()

    const cql = [
      'type = page',
      `${role} = ${quote(accountId)}`,
      opts.days ? `lastmodified >= now("-${Math.floor(opts.days)}d")` : null,
      term ? `title ~ ${quote(term)}` : null,
    ].filter(Boolean).join(' AND ') + ' ORDER BY lastmodified DESC'

    const start = (page - 1) * pagelen
    const res = await cached(`cf:${accountId}:${cql}:${start}:${pagelen}`, 60_000, () => confluence.search(cql, start, pagelen))
    const items = res.results.map(toPage).filter((p): p is ConfluencePage => p !== null)
    const total = res.totalSize ?? start + res.results.length
    return { items, total, page, pagelen, hasNext: start + res.results.length < total }
  }
}
