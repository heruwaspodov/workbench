// Mock Jira Cloud + Bitbucket Cloud for e2e. Synthetic data only, no real people or credentials.
// Jira lives at "/", Bitbucket at "/2.0". Run: MOCK_PORT=4010 bun e2e/mock-atlassian.ts

const PORT = Number(process.env.MOCK_PORT ?? 4010)
const WS = 'mekari'
const DEV_EMAIL = process.env.MOCK_USER_EMAIL ?? 'dev@mekari.com'
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

const json = (data: unknown, status = 200) => Response.json(data, { status })
const adf = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

// ---------- Jira ----------
const jiraUser = { accountId: 'acc-dev', displayName: 'Dev Mekari', emailAddress: DEV_EMAIL, active: true, avatarUrls: {} }
const board = { id: 7, name: 'MESIGN board', type: 'scrum', location: { projectKey: 'MESIGN', displayName: 'Mekari Sign' } }
const boardConfig = {
  id: 7,
  name: board.name,
  columnConfig: {
    columns: [
      { name: 'To Do', statuses: [{ id: '1' }] },
      { name: 'In Progress', statuses: [{ id: '2' }] },
      { name: 'Done', statuses: [{ id: '3' }] },
    ],
  },
}
const status = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } })
const S = { todo: status('1', 'To Do', 'new'), doing: status('2', 'In Progress', 'indeterminate'), done: status('3', 'Done', 'done') }

const issue = (n: number, summary: string, st: typeof S.todo, sp: number | null, resolvedDaysAgo?: number) => ({
  id: String(10000 + n),
  key: `MESIGN-${n}`,
  fields: {
    summary,
    status: st,
    issuetype: { name: 'Story', iconUrl: '' },
    priority: { name: 'Medium' },
    labels: ['backend'],
    updated: iso(1),
    created: iso(10),
    customfield_10016: sp,
    customfield_10020: [{ name: 'Sprint 42' }],
    resolutiondate: resolvedDaysAgo === undefined ? null : iso(resolvedDaysAgo),
    description: adf(`Deskripsi sintetis untuk ${summary}.`),
    assignee: jiraUser,
    reporter: { ...jiraUser, displayName: 'Reporter Uji' },
    parent: null,
    subtasks: [{ key: `MESIGN-${n}1`, fields: { summary: 'Subtask uji', status: S.todo } }],
    components: [{ name: 'api' }],
    fixVersions: [],
  },
})
const issues = [
  issue(101, 'Rapikan endpoint signing', S.todo, 3),
  issue(102, 'Tambah retry webhook', S.doing, 5),
  issue(103, 'Perbaiki alert SLO', S.doing, 2),
  issue(104, 'Migrasi template email', S.done, 8, 2),
  issue(105, 'Hapus flag lama', S.done, 1, 5),
]

// ---------- Confluence (search only; excerpt included on purpose, the app must never forward it) ----------
const wikiPages = [
  { id: '5001', title: 'Runbook Signing', space: 'Engineering' },
  { id: '5002', title: 'Postmortem SEV1', space: 'Engineering' },
  { id: '5003', title: 'Roadmap Q4', space: 'Product' },
]
function wikiSearch(url: URL): Response {
  const cql = url.searchParams.get('cql') ?? ''
  const term = cql.match(/title ~ "([^"]*)"/)?.[1]?.toLowerCase()
  // Only the signed-in user's own pages: the filter must carry their account id.
  const mine = cql.includes('"acc-dev"') ? wikiPages.filter((p) => !term || p.title.toLowerCase().includes(term)) : []
  return json({
    results: mine.map((p) => ({
      content: { id: p.id, type: 'page' },
      title: p.title,
      excerpt: 'CONFIDENTIAL BODY TEXT',
      url: `/spaces/${p.space.slice(0, 3).toUpperCase()}/pages/${p.id}/${p.title.replaceAll(' ', '+')}`,
      lastModified: iso(2),
      resultGlobalContainer: { title: p.space },
    })),
    totalSize: mine.length,
    size: mine.length,
  })
}

function jiraRoute(path: string, url: URL, method: string): Response | null {
  if (path === '/wiki/rest/api/search') return wikiSearch(url)
  if (path === '/rest/api/3/user/search') {
    const q = (url.searchParams.get('query') ?? '').toLowerCase()
    const hit = q === DEV_EMAIL.toLowerCase() || jiraUser.displayName.toLowerCase().includes(q)
    return json(hit ? [jiraUser] : [])
  }
  if (path === '/rest/api/3/user') return json(jiraUser)
  if (path === '/rest/agile/1.0/board') return json({ values: [board] })
  if (path === '/rest/agile/1.0/board/7') return json(board)
  if (path === '/rest/agile/1.0/board/7/configuration') return json(boardConfig)
  if (path === '/rest/agile/1.0/board/7/issue') return json({ issues, total: issues.length })
  if (path === '/rest/api/3/search/jql' && method === 'POST') return json({ issues: issues.filter((i) => i.fields.resolutiondate) })
  const m = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/comment)?$/)
  if (m) {
    const found = issues.find((i) => i.key === m[1])
    if (!found) return json({ errorMessages: ['Issue does not exist'] }, 404)
    if (m[2]) return json({ comments: [{ id: '1', author: jiraUser, body: adf('Komentar sintetis.'), created: iso(1) }] })
    return json(found)
  }
  return null
}

// ---------- Bitbucket ----------
const DEV = '{00000000-0000-4000-8000-000000000001}'
const OTHER = '{00000000-0000-4000-8000-000000000002}'
const bbUser = (uuid: string, name: string, account?: string) => ({ uuid, display_name: name, nickname: name, account_id: account, links: { avatar: { href: '' } } })
const dev = bbUser(DEV, 'Dev Mekari', 'acc-dev')
const other = bbUser(OTHER, 'Rekan Uji', 'acc-other')

const pr = (id: number, repo: string, title: string, author: typeof dev, state: 'OPEN' | 'MERGED', reviewers: (typeof dev)[]) => ({
  id,
  title,
  description: `Deskripsi sintetis PR ${id}. Terkait MESIGN-10${id % 5}.`,
  state,
  draft: false,
  author,
  created_on: iso(3),
  updated_on: iso(1),
  comment_count: 1,
  task_count: 0,
  source: { branch: { name: `feature/MESIGN-10${id % 5}-uji` }, repository: { full_name: `${WS}/${repo}`, name: repo } },
  destination: { branch: { name: 'main' }, repository: { full_name: `${WS}/${repo}`, name: repo } },
  reviewers,
  participants: reviewers.map((u) => ({ user: u, role: 'REVIEWER', approved: false, state: null })),
  links: { html: { href: `https://bitbucket.example.test/${WS}/${repo}/pull-requests/${id}` } },
  merge_commit: null,
})
const prs = [
  pr(101, 'msign-backend', 'MESIGN-101 Rapikan endpoint signing', dev, 'OPEN', [other]),
  pr(102, 'msign-web', 'MESIGN-102 Tambah retry webhook', dev, 'OPEN', [other]),
  pr(103, 'msign-web', 'MESIGN-103 Hapus flag lama', dev, 'MERGED', [other]),
  pr(201, 'msign-web', 'MESIGN-104 Migrasi template email', other, 'OPEN', [dev]),
]

const diff = `diff --git a/app/signing.rb b/app/signing.rb
--- a/app/signing.rb
+++ b/app/signing.rb
@@ -1,3 +1,4 @@
 class Signing
-  def call; end
+  def call
+    :ok
+  end
 end
`
const paged = <T>(values: T[]) => json({ values, page: 1, pagelen: 50, size: values.length })

function bbRoute(path: string, url: URL): Response | null {
  const p = decodeURIComponent(path)
  if (p === `/workspaces/${WS}/members`) return paged([{ user: dev }, { user: other }])
  let m = p.match(new RegExp(`^/workspaces/${WS}/pullrequests/(.+)$`))
  if (m) {
    const states = url.searchParams.getAll('state')
    return paged(prs.filter((x) => x.author.uuid === m![1] && (!states.length || states.includes(x.state))))
  }
  m = p.match(new RegExp(`^/repositories/${WS}/([^/]+)/pullrequests$`))
  if (m) {
    const q = url.searchParams.get('q') ?? ''
    const inRepo = prs.filter((x) => x.destination.repository.name === m![1])
    return paged(q.includes('reviewers.uuid') ? inRepo.filter((x) => x.reviewers.some((r) => q.includes(r.uuid))) : inRepo)
  }
  m = p.match(new RegExp(`^/repositories/${WS}/([^/]+)/pullrequests/(\\d+)(?:/(diffstat|commits|comments|statuses|diff))?$`))
  if (m) {
    const found = prs.find((x) => x.id === Number(m![2]) && x.destination.repository.name === m![1])
    if (!found) return json({ error: { message: 'Not found' } }, 404)
    switch (m[3]) {
      case undefined: return json(found)
      case 'diffstat': return paged([{ status: 'modified', lines_added: 3, lines_removed: 1, old: { path: 'app/signing.rb' }, new: { path: 'app/signing.rb' } }])
      case 'commits': return paged([{ hash: 'abc1234def5678', message: 'Uji commit', date: iso(2), author: { raw: 'Dev Mekari <dev@mekari.com>', user: dev } }])
      case 'comments': return paged([
        { id: 1, content: { raw: 'Komentar umum sintetis.' }, user: other, created_on: iso(1) },
        { id: 2, content: { raw: 'Komentar inline sintetis.' }, user: other, created_on: iso(1), inline: { path: 'app/signing.rb', to: 2 } },
      ])
      case 'statuses': return paged([{ key: 'ci', name: 'CI', state: 'SUCCESSFUL', url: 'https://ci.example.test/1', updated_on: iso(1) }])
      case 'diff': return new Response(diff, { headers: { 'content-type': 'text/plain' } })
    }
  }
  return null
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    const res = path.startsWith('/2.0/') ? bbRoute(path.slice(4), url) : jiraRoute(path, url, req.method)
    if (res) return res
    console.warn(`[mock] unhandled ${req.method} ${path}`)
    return json({ error: 'not mocked', path }, 404)
  },
})
console.log(`[mock] Jira + Bitbucket on :${PORT}`)
