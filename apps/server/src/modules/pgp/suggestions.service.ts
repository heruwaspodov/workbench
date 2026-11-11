import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { plans, type User } from '../../db/schema'
import { jira, jiraConfigured, type JiraIssue } from '../../integrations/jira.client'
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { cached } from '../../shared/cache'
import { monthRange, quarterRange } from '../../shared/period'
import { ConfluenceService } from '../confluence/service'
import { ConnectionsService } from '../connections/service'

/**
 * Evidence suggestions for one plan, computed from the owner's own Jira and Confluence activity.
 * Metadata only (key, title, status, dates, url): no issue descriptions and no page bodies.
 * Only the plan's owner may read them, because they are derived from the owner's Atlassian account.
 */
const SP = env.jira.storyPointField
const TTL = 5 * 60_000
const ISSUE_CAP = 500

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** JQL reference for the story point field. "Story Points" is not unique in this site, so use the id form `cf[10005]`. */
export const spField = (field = SP) => (/^customfield_(\d+)$/.test(field) ? `cf[${field.slice(12)}]` : quote('Story Points'))

export const deliveryJql = (accountId: string, from: string, to: string) =>
  `assignee = ${quote(accountId)} AND resolutiondate >= ${quote(from)} AND resolutiondate < ${quote(to)} AND ${spField()} > 0 ORDER BY resolutiondate ASC`

export const jqlUrl = (jql: string) => `${jira.baseUrl}/issues?jql=${encodeURIComponent(jql)}`

export type PageKind = 'rfc' | 'rca' | 'tech-doc' | 'other'
/** Classified from the title only; the body is never read. */
export const pageKind = (title: string): PageKind => {
  if (/\brfc\b/i.test(title)) return 'rfc'
  if (/\b(rca|post-?mortem|incident review)\b/i.test(title)) return 'rca'
  if (/\b(tech(nical)?\s+(design|doc|spec)|design doc|architecture|runbook|adr)\b/i.test(title)) return 'tech-doc'
  return 'other'
}

const sp = (i: JiraIssue) => (typeof i.fields[SP] === 'number' ? (i.fields[SP] as number) : 0)
const dayOf = (iso: unknown) => String(iso ?? '').slice(0, 10)

const toEpic = (i: JiraIssue, source: 'assigned' | 'child') => ({
  key: i.key,
  summary: String(i.fields.summary ?? ''),
  status: String(i.fields.status?.name ?? ''),
  statusCategory: String(i.fields.status?.statusCategory?.key ?? 'new'),
  resolvedAt: (i.fields.resolutiondate as string | null) ?? null,
  url: jira.browseUrl(i.key),
  source,
})

export abstract class SuggestionsService {
  /** Owner only. Returns the plan period; 403 for anyone else (leaders and admins included). */
  private static async owned(id: string, user: User) {
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, id), columns: { id: true, userId: true, year: true, quarter: true } })
    if (!plan) throw new NotFoundError('Plan')
    if (plan.userId !== user.id) throw new ForbiddenError('Suggestions are only available to the plan owner')
    if (!jiraConfigured()) throw new AppError(503, 'Atlassian service account is not configured', 'JIRA_NOT_CONFIGURED')
    const { accountId } = await ConnectionsService.requireJira(user)
    return { plan, accountId, range: quarterRange(plan.year, plan.quarter) }
  }

  static async get(id: string, user: User) {
    const { plan, accountId, range } = await this.owned(id, user)
    const key = `sg:${plan.id}:${accountId}`
    const guard = async <T>(run: () => Promise<T>, empty: T): Promise<{ value: T; error: string | null }> => {
      try { return { value: await run(), error: null } } catch (e) { return { value: empty, error: e instanceof Error ? e.message : 'Request failed' } }
    }
    const [epics, pages, delivery, bugs] = await Promise.all([
      guard(() => cached(`${key}:epics`, TTL, () => this.epics(accountId, plan.year, plan.quarter, range)), []),
      guard(() => cached(`${key}:pages`, TTL, () => this.pages(user)), []),
      guard(() => cached(`${key}:delivery`, TTL, () => this.delivery(accountId, range)), []),
      guard(() => cached(`${key}:bugs`, TTL, () => this.bugs(accountId, range)), null),
    ])
    return {
      period: `${plan.year}-Q${plan.quarter}`,
      epics: epics.value,
      pages: pages.value,
      delivery: delivery.value,
      bugs: bugs.value,
      errors: { epics: epics.error, pages: pages.error, delivery: delivery.error, bugs: bugs.error },
    }
  }

  /** Epics worked on in the quarter: assigned to the user, open during it and touched in it, plus parent epics of issues the user resolved in it. */
  private static async epics(accountId: string, year: number, quarter: number, range: ReturnType<typeof quarterRange>) {
    const assignedJql = `assignee = ${quote(accountId)} AND issuetype = Epic AND created < ${quote(range.to)} AND updated >= ${quote(range.from)} AND (statusCategory != Done OR resolutiondate >= ${quote(range.from)}) ORDER BY created DESC`
    const childJql = `assignee = ${quote(accountId)} AND resolutiondate >= ${quote(range.from)} AND resolutiondate < ${quote(range.to)} AND parent is not EMPTY`
    const epicFields = ['summary', 'status', 'resolutiondate']
    const [assigned, children] = await Promise.all([
      jira.search(assignedJql, epicFields, 100),
      jira.search(childJql, ['parent'], ISSUE_CAP),
    ])
    const out = new Map<string, ReturnType<typeof toEpic>>()
    for (const i of assigned.issues) out.set(i.key, toEpic(i, 'assigned'))
    for (const c of children.issues) {
      const p = c.fields.parent
      if (!p?.key || out.has(p.key) || p.fields?.issuetype?.name !== 'Epic') continue
      out.set(p.key, toEpic({ id: p.id ?? p.key, key: p.key, fields: p.fields ?? {} }, 'child'))
    }
    const label = new RegExp(`^\\s*${String(year).slice(2)}Q${quarter}\\b`, 'i')
    return [...out.values()].sort((a, b) => Number(label.test(b.summary)) - Number(label.test(a.summary)))
  }

  /** Pages the user created or edited in the last 3 months (metadata only). */
  private static async pages(user: User) {
    const res = await ConfluenceService.pages(user, { role: 'contributor', days: 92, pagelen: 25 })
    return res.items.map((p) => ({ ...p, kind: pageKind(p.title) }))
  }

  /** Story points and tickets the user resolved in each month of the quarter. */
  private static async delivery(accountId: string, range: ReturnType<typeof quarterRange>) {
    const { issues } = await jira.search(deliveryJql(accountId, range.from, range.to), ['resolutiondate', SP], ISSUE_CAP)
    return range.months.map((month) => {
      const inMonth = issues.filter((i) => String(i.fields.resolutiondate ?? '').startsWith(month))
      const { from, to } = monthRange(month)
      const jql = deliveryJql(accountId, from, to)
      return { month, tickets: inMonth.length, storyPoints: inMonth.reduce((s, i) => s + sp(i), 0), jql, url: jqlUrl(jql) }
    })
  }

  /**
   * Bugs assigned to the user and created in the quarter, counted per priority.
   * Checked against the Q3 2026 sheet: "P2: 7" matches. Other bug counts in the sheet (leaked to staging,
   * production bugs from PIC initiatives) follow internal definitions that Jira alone does not carry, so they are not offered.
   */
  private static async bugs(accountId: string, range: ReturnType<typeof quarterRange>) {
    const jql = `assignee = ${quote(accountId)} AND issuetype = Bug AND created >= ${quote(range.from)} AND created < ${quote(range.to)} ORDER BY created ASC`
    const { issues } = await jira.search(jql, ['priority'], ISSUE_CAP)
    const byPriority = new Map<string, number>()
    for (const i of issues) {
      const name = String(i.fields.priority?.name ?? 'No priority')
      byPriority.set(name, (byPriority.get(name) ?? 0) + 1)
    }
    // "Medium - P2" is shown as "P2": the sheet counts by the P-level.
    const short = (name: string) => name.match(/\bP\d\b/i)?.[0].toUpperCase() ?? name
    const items = [...byPriority].map(([priority, count]) => ({ priority, label: short(priority), count })).sort((a, b) => a.label.localeCompare(b.label))
    return { total: issues.length, items, value: items.map((i) => `${i.label}: ${i.count}`).join(', '), jql, url: jqlUrl(jql) }
  }

  /** Tickets behind one month's numbers, for the detail modal. */
  static async deliveryMonth(id: string, user: User, month: string) {
    const { plan, accountId, range } = await this.owned(id, user)
    if (!range.months.includes(month)) throw new BadRequestError(`Month must be one of ${range.months.join(', ')}`)
    const { from, to } = monthRange(month)
    const jql = deliveryJql(accountId, from, to)
    const issues = await cached(`sg:${plan.id}:${accountId}:month:${month}`, TTL, async () =>
      (await jira.search(jql, ['summary', 'resolutiondate', SP], 100)).issues)
    return {
      month, jql, url: jqlUrl(jql),
      tickets: issues.length,
      storyPoints: issues.reduce((s, i) => s + sp(i), 0),
      issues: issues.map((i) => ({
        key: i.key, summary: String(i.fields.summary ?? ''), storyPoints: sp(i), resolvedAt: (i.fields.resolutiondate as string | null) ?? null, url: jira.browseUrl(i.key),
      })),
    }
  }

  /**
   * Team delivery rate for a label over the plan's quarter (whole team, not only the owner's tickets).
   * total = labelled tickets active in the quarter (created before its end, and unresolved or resolved on/after its start);
   * done = those resolved inside the quarter. Reported by ticket count and by story points.
   */
  static async deliveryRate(id: string, user: User, rawLabel: string) {
    const { plan, accountId, range } = await this.owned(id, user)
    const label = rawLabel.trim()
    if (!label) throw new BadRequestError('Label is required')
    const jql = `labels = ${quote(label)} AND created < ${quote(range.to)} AND (resolution is EMPTY OR resolutiondate >= ${quote(range.from)})`
    const cap = 1000
    const { issues, truncated } = await cached(`sg:${plan.id}:${accountId}:rate:${label}`, TTL, () => jira.search(jql, ['resolutiondate', SP], cap))
    const isDone = (i: JiraIssue) => {
      const d = dayOf(i.fields.resolutiondate)
      return d >= range.from && d < range.to
    }
    const done = issues.filter(isDone)
    const rate = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10)
    const spSum = (list: JiraIssue[]) => list.reduce((s, i) => s + sp(i), 0)
    return {
      label, from: range.from, to: range.to, jql, url: jqlUrl(jql), truncated,
      tickets: { done: done.length, total: issues.length, rate: rate(done.length, issues.length) },
      storyPoints: { done: spSum(done), total: spSum(issues), rate: rate(spSum(done), spSum(issues)) },
    }
  }
}
