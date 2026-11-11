import { env } from '../../config/env'
import type { User } from '../../db/schema'
import { jira, type JiraIssue } from '../../integrations/jira.client'
import { adfToText } from '../../shared/adf'
import { cached } from '../../shared/cache'
import { NotFoundError } from '../../shared/errors'
import { ConnectionsService } from '../connections/service'
import type { KanbanCard } from './model'

const SP = env.jira.storyPointField
const CARD_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'labels', 'updated', 'sprint', 'customfield_10020', SP]

const sprintName = (f: Record<string, any>) => {
  const s = f.sprint ?? (Array.isArray(f.customfield_10020) ? f.customfield_10020.at(-1) : null)
  return s?.name ?? null
}

const toCard = (i: JiraIssue): KanbanCard => ({
  key: i.key,
  summary: i.fields.summary,
  status: i.fields.status?.name ?? 'Unknown',
  statusCategory: i.fields.status?.statusCategory?.key ?? 'new',
  issueType: i.fields.issuetype?.name ?? '',
  issueTypeIcon: i.fields.issuetype?.iconUrl ?? null,
  priority: i.fields.priority?.name ?? null,
  storyPoints: typeof i.fields[SP] === 'number' ? i.fields[SP] : null,
  sprint: sprintName(i.fields),
  labels: i.fields.labels ?? [],
  updated: i.fields.updated,
  url: jira.browseUrl(i.key),
})

const CATEGORY_COLUMNS = [
  { name: 'To Do', category: 'new' },
  { name: 'In Progress', category: 'indeterminate' },
  { name: 'Done', category: 'done' },
] as const

/**
 * How long a finished issue stays visible. Jira's Kanban Done column hides issues not updated for 7 days
 * (matched against the Jira UI: 18 = 18 on board 2508); `resolved >= -14d` showed 44.
 */
export const DONE_WINDOW = 'updated >= -7d'

/** Applies the board's own sub-filter so the dashboard shows what the Jira board shows. */
export const withSubQuery = (jql: string, subQuery?: string) => {
  const sub = subQuery?.replace(/\s+order\s+by[\s\S]*$/i, '').trim()
  return sub ? `${jql} AND (${sub})` : jql
}

export abstract class KanbanService {
  static async board(user: User, scope: 'sprint' | 'active' = 'sprint') {
    const { accountId, boardId } = await ConnectionsService.requireJira(user)
    const mine = `assignee = "${accountId}"`
    const activeJql = `${mine} AND (statusCategory != Done OR ${DONE_WINDOW})`

    if (boardId) {
      const [config, meta] = await Promise.all([
        cached(`jira:board-config:${boardId}`, 30 * 60_000, () => jira.boardConfig(boardId)),
        cached(`jira:board:${boardId}`, 30 * 60_000, () => jira.getBoard(boardId)),
      ])
      const isScrum = meta.type === 'scrum'
      const effectiveScope = isScrum ? scope : 'active'
      const base = effectiveScope === 'sprint' ? `${mine} AND sprint in openSprints()` : activeJql
      const jql = withSubQuery(base, config.subQuery?.query)
      const { issues } = await jira.boardIssues(boardId, `${jql} ORDER BY Rank ASC`, CARD_FIELDS)

      // A column without statuses is Jira's Kanban "Backlog" placeholder, which the board view never shows.
      const boardColumns = config.columnConfig.columns.filter((c) => c.statuses.length > 0)
      const columnOf = new Map<string, string>()
      for (const col of boardColumns) for (const s of col.statuses) columnOf.set(s.id, col.name)
      const columns = boardColumns.map((c) => ({ name: c.name, cards: [] as KanbanCard[] }))
      const other: KanbanCard[] = []
      for (const issue of issues) {
        const name = columnOf.get(issue.fields.status?.id)
        const target = columns.find((c) => c.name === name)
        ;(target ? target.cards : other).push(toCard(issue))
      }
      if (other.length) columns.push({ name: 'Other', cards: other })
      return { board: { id: boardId, name: config.name, scrum: isScrum }, scope: effectiveScope, columns }
    }

    // No board selected: group by status category.
    const { issues } = await jira.search(`${activeJql} ORDER BY updated DESC`, CARD_FIELDS, 200)
    const cards = issues.map(toCard)
    return {
      board: null,
      scope: 'active' as const,
      columns: CATEGORY_COLUMNS.map((c) => ({ name: c.name, cards: cards.filter((x) => x.statusCategory === c.category) })),
    }
  }

  /** Only issues the user is assigned to or reported: the service account can read far more than one person should see. */
  static async issue(user: User, key: string) {
    const { accountId } = await ConnectionsService.requireJira(user)
    const [issue, comments] = await Promise.all([
      jira.getIssue(key, [...CARD_FIELDS, 'description', 'assignee', 'reporter', 'created', 'parent', 'subtasks', 'fixVersions', 'components']),
      jira.getComments(key).catch(() => ({ comments: [] })),
    ])
    const f = issue.fields
    if (f.assignee?.accountId !== accountId && f.reporter?.accountId !== accountId) throw new NotFoundError('Issue')
    return {
      ...toCard(issue),
      description: adfToText(f.description),
      assignee: f.assignee?.displayName ?? null,
      reporter: f.reporter?.displayName ?? null,
      created: f.created,
      parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary ?? '' } : null,
      subtasks: (f.subtasks ?? []).map((s: any) => ({ key: s.key, summary: s.fields?.summary, status: s.fields?.status?.name })),
      components: (f.components ?? []).map((c: any) => c.name),
      fixVersions: (f.fixVersions ?? []).map((v: any) => v.name),
      comments: comments.comments.slice(0, 20).map((c) => ({
        id: c.id, author: c.author?.displayName ?? 'Unknown', created: c.created, body: adfToText(c.body),
      })),
    }
  }

  /** Story points & tickets resolved per month — handy evidence for PGP delivery KRs. */
  static async monthlyStats(user: User, months = 3) {
    const { accountId } = await ConnectionsService.requireJira(user)
    const jql = `assignee = "${accountId}" AND statusCategory = Done AND resolved >= startOfMonth(-${months - 1}) ORDER BY resolved DESC`
    const { issues } = await jira.search(jql, ['resolutiondate', SP], 500)
    const buckets = new Map<string, { month: string; tickets: number; storyPoints: number }>()
    for (const i of issues) {
      const month = String(i.fields.resolutiondate ?? '').slice(0, 7)
      if (!month) continue
      const b = buckets.get(month) ?? { month, tickets: 0, storyPoints: 0 }
      b.tickets++
      b.storyPoints += typeof i.fields[SP] === 'number' ? i.fields[SP] : 0
      buckets.set(month, b)
    }
    return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month))
  }
}
