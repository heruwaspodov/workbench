import type { User } from '../../db/schema'
import { bitbucket, type BbPullRequest } from '../../integrations/bitbucket.client'
import { cached } from '../../shared/cache'
import { ConnectionsService } from '../connections/service'
import { PR_STATES, type PullRequestSummary } from './model'

const JIRA_KEY = /\b[A-Z][A-Z0-9_]+-\d+\b/g
const repoSlug = (pr: BbPullRequest) => pr.destination.repository.full_name.split('/')[1] ?? pr.destination.repository.name
const jiraKeys = (...texts: (string | undefined)[]) => [...new Set(texts.join(' ').match(JIRA_KEY) ?? [])]

const toSummary = (pr: BbPullRequest): PullRequestSummary => {
  const participants = pr.participants ?? []
  const reviewers = participants.filter((p) => p.role === 'REVIEWER')
  return {
    id: pr.id,
    repo: repoSlug(pr),
    title: pr.title,
    state: pr.state,
    draft: Boolean(pr.draft),
    author: { name: pr.author.display_name, avatarUrl: pr.author.links?.avatar?.href ?? null },
    sourceBranch: pr.source.branch.name,
    destinationBranch: pr.destination.branch.name,
    commentCount: pr.comment_count ?? 0,
    taskCount: pr.task_count ?? 0,
    approvals: participants.filter((p) => p.approved).length,
    reviewers: (reviewers.length ? reviewers : (pr.reviewers ?? []).map((u) => ({ user: u, approved: false, state: null, role: 'REVIEWER' })))
      .map((p) => ({ name: p.user.display_name, avatarUrl: p.user.links?.avatar?.href ?? null, approved: p.approved, state: p.state ?? null })),
    jiraKeys: jiraKeys(pr.title, pr.source.branch.name),
    createdOn: pr.created_on,
    updatedOn: pr.updated_on,
    url: pr.links.html.href,
  }
}

const DEFAULT_PAGELEN = 20

export abstract class PullRequestsService {
  /** Repos the user has authored PRs in recently = "repos I'm involved in". */
  static async involvedRepos(user: User): Promise<string[]> {
    const { uuid } = await ConnectionsService.requireBitbucket(user)
    return cached(`bb:repos:${uuid}`, 15 * 60_000, async () => {
      const pages = await Promise.all([1, 2].map((p) => bitbucket.userPullRequests(uuid, [...PR_STATES], p, 50).catch(() => ({ values: [] as BbPullRequest[] }))))
      return [...new Set(pages.flatMap((p) => p.values).map(repoSlug))].sort()
    })
  }

  static async list(user: User, opts: { role?: 'author' | 'reviewer'; state?: string; repo?: string; page?: number; pagelen?: number }) {
    const { uuid } = await ConnectionsService.requireBitbucket(user)
    const states = !opts.state || opts.state === 'ALL' ? [...PR_STATES] : [opts.state]
    const page = opts.page ?? 1
    const pagelen = opts.pagelen ?? DEFAULT_PAGELEN

    if ((opts.role ?? 'author') === 'author') {
      const res = await bitbucket.userPullRequests(uuid, states, page, pagelen)
      let items = res.values.map(toSummary)
      if (opts.repo) items = items.filter((p) => p.repo === opts.repo)
      // The repository filter is applied after the page was fetched, so the workspace total no longer describes the list.
      return { items, page, pagelen, total: opts.repo ? null : res.size ?? null, hasNext: Boolean(res.next) }
    }

    // Reviewer: Bitbucket has no workspace-wide reviewer endpoint, so fan out over involved repos.
    const repos = opts.repo ? [opts.repo] : (await this.involvedRepos(user)).slice(0, 20)
    const stateQ = states.map((s) => `state="${s}"`).join(' OR ')
    const q = `reviewers.uuid="${uuid}" AND (${stateQ})`
    const results = await Promise.all(repos.map((r) => bitbucket.repoPullRequests(r, q, 25).catch(() => ({ values: [] as BbPullRequest[] }))))
    const items = results.flatMap((r) => r.values).map(toSummary).sort((a, b) => b.updatedOn.localeCompare(a.updatedOn))
    return { items: items.slice((page - 1) * pagelen, page * pagelen), page, pagelen, total: items.length, hasNext: items.length > page * pagelen }
  }

  static async detail(user: User, repo: string, id: number) {
    await ConnectionsService.requireBitbucket(user)
    const [pr, diffstat, commits, comments, statuses] = await Promise.all([
      bitbucket.pullRequest(repo, id),
      bitbucket.diffstat(repo, id).catch(() => ({ values: [] })),
      bitbucket.commits(repo, id).catch(() => ({ values: [] })),
      bitbucket.comments(repo, id).catch(() => ({ values: [] })),
      bitbucket.statuses(repo, id).catch(() => ({ values: [] })),
    ])
    const files = diffstat.values.map((f) => ({
      path: f.new?.path ?? f.old?.path ?? '',
      oldPath: f.old?.path && f.new?.path && f.old.path !== f.new.path ? f.old.path : null,
      status: f.status,
      added: f.lines_added,
      removed: f.lines_removed,
    }))
    return {
      ...toSummary(pr),
      jiraKeys: jiraKeys(pr.title, pr.source.branch.name, pr.description),
      description: pr.description ?? '',
      mergeCommit: pr.merge_commit?.hash ?? null,
      files,
      totals: {
        files: files.length,
        added: files.reduce((s, f) => s + f.added, 0),
        removed: files.reduce((s, f) => s + f.removed, 0),
      },
      commits: commits.values.map((c) => ({
        hash: c.hash.slice(0, 10),
        message: c.message.split('\n')[0] ?? '',
        author: c.author.user?.display_name ?? c.author.raw.replace(/<.*>/, '').trim(),
        date: c.date,
      })),
      comments: comments.values.filter((c) => !c.deleted).map((c) => ({
        id: c.id,
        author: c.user.display_name,
        avatarUrl: c.user.links?.avatar?.href ?? null,
        body: c.content.raw,
        createdOn: c.created_on,
        inline: c.inline ? { path: c.inline.path, line: c.inline.to ?? null } : null,
      })),
      builds: statuses.values.map((s) => ({ key: s.key, name: s.name ?? s.key, state: s.state, url: s.url ?? null })),
    }
  }

  /** Raw unified diff, capped to protect the browser. */
  static async diff(user: User, repo: string, id: number) {
    await ConnectionsService.requireBitbucket(user)
    const raw = await bitbucket.diff(repo, id)
    const LIMIT = 400_000
    return { diff: raw.length > LIMIT ? raw.slice(0, LIMIT) : raw, truncated: raw.length > LIMIT }
  }
}
