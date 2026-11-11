// Visual e2e (OD-31): mock Jira/Bitbucket + local Postgres + built monolith + Playwright (system Chrome).
// Prereq: `bun run build`, Postgres on localhost. Run: bun run e2e
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { chromium, type Page } from 'playwright-core'

const ROOT = join(import.meta.dir, '..')
const OUT = join(import.meta.dir, 'out')
const SERVER_DIR = join(ROOT, 'apps/server')
const MOCK_PORT = 4010
const APP_PORT = 3100
const APP = `http://localhost:${APP_PORT}`
const DB_NAME = 'one-desk-e2e'
const DB_URL = process.env.E2E_DATABASE_URL ?? `postgres://localhost:5432/${DB_NAME}`
const EMAIL = 'dev@mekari.com'

if (!existsSync(join(ROOT, 'apps/web/dist/index.html'))) throw new Error('apps/web/dist missing. Run `bun run build` first.')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

if (!process.env.E2E_DATABASE_URL) {
  const admin = postgres('postgres://localhost:5432/postgres', { max: 1 })
  const [row] = await admin`select 1 as ok from pg_database where datname = ${DB_NAME}`
  if (!row) await admin.unsafe(`create database "${DB_NAME}"`)
  await admin.end()
}

const children: Bun.Subprocess[] = []
const stop = () => children.forEach((c) => c.kill())
process.on('exit', stop)

const spawn = (cmd: string[], cwd: string, env: Record<string, string>) => {
  const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  children.push(p)
  return p
}

const serverEnv = {
  DATABASE_URL: DB_URL,
  PORT: String(APP_PORT),
  APP_URL: APP,
  ADMIN_EMAILS: EMAIL,
  JIRA_BASE_URL: `http://localhost:${MOCK_PORT}`,
  JIRA_EMAIL: 'mock@example.test',
  JIRA_API_TOKEN: 'mock-token',
  BITBUCKET_API_URL: `http://localhost:${MOCK_PORT}/2.0`,
  BITBUCKET_WORKSPACE: 'mekari',
  BITBUCKET_ACCESS_TOKEN: 'mock-token',
}

const waitFor = async (url: string) => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url)).status < 500) return } catch {}
    await Bun.sleep(250)
  }
  throw new Error(`Timeout waiting for ${url}`)
}

spawn(['bun', 'e2e/mock-atlassian.ts'], ROOT, { MOCK_PORT: String(MOCK_PORT), MOCK_USER_EMAIL: EMAIL })
const migrate = Bun.spawn(['bun', 'src/db/migrate.ts'], { cwd: SERVER_DIR, env: { ...process.env, ...serverEnv }, stdout: 'ignore', stderr: 'inherit' })
if ((await migrate.exited) !== 0) throw new Error('migration failed')
spawn(['bun', 'src/index.ts'], SERVER_DIR, serverEnv)
await Promise.all([waitFor(`http://localhost:${MOCK_PORT}/rest/api/3/user`), waitFor(`${APP}/api/auth/config`)])

// There is no login shortcut in the app: the test signs in with a real session row created in the e2e database.
Object.assign(process.env, { DATABASE_URL: DB_URL, ADMIN_EMAILS: EMAIL })
const { AuthService } = await import('../apps/server/src/modules/auth/service')
const testUser = await AuthService.upsertUser({ subject: 'e2e', email: EMAIL, name: 'dev' })
const session = await AuthService.createSession(testUser.id)
// The e2e database is reused between runs and a user may hold only one plan per quarter: start from none.
{
  const { db } = await import('../apps/server/src/db/client')
  const { plans } = await import('../apps/server/src/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.delete(plans).where(eq(plans.userId, testUser.id))
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([{ name: 'od_session', value: session.token, url: APP }])
const page = await context.newPage()

const jsErrors: string[] = []
// Pixel icons come from cdn.mekari.design; they may be blocked in sandboxes.
// The 409 is the expected answer when a quarter is created twice (checked in its own step).
const ignorable = (s: string) => s.includes('cdn.mekari.design') || s.includes('status of 409')
page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text() + (m.location().url ?? ''))) jsErrors.push(`console: ${m.text()}`) })

page.on('response', (r) => { if (r.status() >= 400) console.log(`  [http ${r.status()}] ${new URL(r.url()).pathname}`) })

const results: { name: string; ok: boolean; err?: string }[] = []
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (e) {
    results.push({ name, ok: false, err: (e as Error).message.split('\n')[0] })
    console.log(`  FAIL ${name}: ${(e as Error).message.split('\n')[0]}`)
    await page.screenshot({ path: join(OUT, `FAIL-${results.length}.png`) }).catch(() => {})
  }
}
const shot = (n: string) => page.screenshot({ path: join(OUT, `${n}.png`), fullPage: true })
const text = (p: Page, s: string) => p.getByText(s).first().waitFor({ timeout: 10_000 })
const api = async (method: string, path: string, data?: unknown) => {
  const r = await page.request.fetch(APP + path, { method, data: data as never, headers: { origin: APP, ...(data ? { 'content-type': 'application/json' } : {}) } })
  if (!r.ok()) throw new Error(`${method} ${path} -> ${r.status()}`)
  return r.json().catch(() => null)
}

console.log(`e2e against ${APP}`)
const title = `PGP e2e ${Date.now()}`
let planId = ''
let templateId = ''

await step('signed-in session lands on PGP home', async () => {
  await page.goto(`${APP}/`)
  await page.waitForURL(/\/pgp$/)
  await text(page, 'Personal Growth Plan')
  await shot('01-pgp-home')
})

await step('admin creates & publishes template (API), shown on Create PGP', async () => {
  const t = await api('POST', '/api/pgp/templates', {
    title, period: '2026-Q4',
    items: [
      { objective: 'Reliability', keyResult: 'SLO 99.9% on every customer-facing signing endpoint, measured monthly over a rolling window and reported to the leadership team with a written root cause for each breach', weight: 60, initiative: 'Fix noisy alerts and write the runbook for every page-worthy alert, including the escalation path, the owner and the exact commands an on-call engineer should run first, so that nobody needs to ask in the channel at night' },
      { objective: 'Delivery', keyResult: 'Ship 3 features', weight: 40, initiative: 'Sprint planning' },
    ],
  })
  templateId = t.id
  await api('PATCH', `/api/pgp/templates/${t.id}`, { status: 'published' })
  await page.goto(`${APP}/pgp/new`)
  await text(page, title)
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(200)
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length }))
    if (m.page > 1 || m.wide > 0) throw new Error(`Create PGP overflows at ${width}px (page +${m.page}px, ${m.wide} elements past the edge)`)
    if (width === 1024) await shot('01b-pgp-home-1024')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)
  await shot('01a-pgp-home')
})

await step('connect Jira, Bitbucket and board (API), connections page', async () => {
  await api('POST', '/api/connections/jira/auto')
  await api('POST', '/api/connections/bitbucket/auto')
  await api('PUT', '/api/connections/jira/board', { boardId: 7 })
  await page.goto(`${APP}/connections`)
  await text(page, 'Dev Mekari')
  await shot('03-connections')
})

await step('pick the Kanban board by pasting its Jira URL (Connections)', async () => {
  await api('PUT', '/api/connections/jira/board', { boardId: null })
  await page.goto(`${APP}/connections`)
  const box = page.getByPlaceholder('Name, project key (MESIGN) or board URL')
  await box.fill('https://example.atlassian.net/jira/software/c/projects/MESIGN/boards/7?assignee=abc')
  await box.press('Enter')
  await page.waitForFunction(async () => (await (await fetch('/api/connections')).json()).jira.boardName === 'MESIGN board', undefined, { timeout: 10_000 })
  await shot('03b-connections-board')
})

await step('open plan, fill achievement, save', async () => {
  await page.goto(`${APP}/pgp/new`)
  await page.getByRole('button', { name: 'Fill in this PGP' }).first().click()
  await page.waitForURL(/\/pgp\/plans\/[0-9a-f-]{36}$/)
  planId = page.url().split('/').pop()!
  const input = page.locator('[data-field="achievement"] input').first()
  await input.waitFor()
  await input.fill('5')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async (id) => (await (await fetch(`/api/pgp/plans/${id}`)).json()).score > 0, planId, { timeout: 10_000 })
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length }))
    if (m.page > 1 || m.wide > 0) throw new Error(`Plan editor overflows at ${width}px (page +${m.page}px, ${m.wide} elements past the edge)`)
    if (width === 1024) await shot('02a-plan-editor-1024')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)
  await shot('02-plan-editor')
})

await step('Create PGP from an uploaded Excel file, then the same quarter is refused', async () => {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Q1 - 2025')
  const head = ['Company OKR', 'Objective', 'Key Results', 'Weightage', 'Initiatives', 'Start Value', 'Target Value', 'Current Value', '% Achievement', 'Status', 'Hyperlink to key results']
  ws.addRow(['Division Name', 'Your Name', 'SBU (Scope Product)', 'SBU (Detail)', 'Direct Leader', 'Period'])
  ws.addRow(['Engineering', 'Test Person', 'ESIGN', '', 'Test Leader', 'Q1'])
  ws.addRow([])
  ws.addRow(head)
  ws.addRow(['', 'Delivery', 'Ship stories', 0.6, 'Average 40 story points', '', '', 'AVG 44', 0.6, 'Done'])
  ws.getRow(5).getCell(11).value = { text: 'July (162 SP)', hyperlink: 'https://jira.example.test/issues?jql=e2e' }
  ws.addRow(['', 'Quality', 'No regressions', 0.4, 'Zero P0 bugs'])
  const xlsx = join(OUT, 'e2e-plan.xlsx')
  await wb.xlsx.writeFile(xlsx)

  await page.goto(`${APP}/pgp`)
  await page.getByRole('button', { name: 'Create PGP' }).click()
  await page.waitForURL(/\/pgp\/new$/)
  await page.getByRole('button', { name: 'Upload Excel' }).click()
  await page.locator('[data-test="xlsx-file"]').setInputFiles(xlsx)
  await page.locator('[data-test="create-plan"]').waitFor() // initiatives sit in textareas, which getByText cannot match
  if ((await page.getByPlaceholder('2026').inputValue()) !== '2025') throw new Error('year was not read from the tab name')
  await shot('04-create-from-upload')
  await page.locator('[data-test="create-plan"]').click()
  await page.waitForURL(/\/pgp\/plans\/[0-9a-f-]{36}$/)
  await text(page, 'PGP 2025-Q1')
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((t) => t.value.includes('https://jira.example.test/issues?jql=e2e')), undefined, { timeout: 10_000 })

  await page.goto(`${APP}/pgp/new`)
  await page.getByRole('button', { name: 'Upload Excel' }).click()
  await page.locator('[data-test="xlsx-file"]').setInputFiles(xlsx)
  await page.locator('[data-test="create-plan"]').waitFor() // initiatives sit in textareas, which getByText cannot match
  await page.locator('[data-test="create-plan"]').click()
  await text(page, 'You already have a PGP for 2025-Q1')
  await text(page, 'Open existing PGP')
  await shot('04b-create-quarter-taken')
})

await step('items are grouped per objective in accordions (collapse, expand all, add objective)', async () => {
  await page.goto(`${APP}/pgp/new`)
  await page.getByRole('button', { name: 'Upload Excel' }).click()
  await page.locator('[data-test="xlsx-file"]').setInputFiles(join(OUT, 'e2e-plan.xlsx'))
  await page.locator('[data-test="create-plan"]').waitFor()
  const panels = page.locator('[data-test="objective"]')
  if ((await panels.count()) !== 2) throw new Error(`expected 2 objective panels, got ${await panels.count()}`)
  const first = panels.first()
  const chevron = first.getByRole('button', { name: /^Collapse Delivery/ })
  if ((await chevron.getAttribute('aria-expanded')) !== 'true') throw new Error('first objective should start open')
  const initiative = first.locator('textarea').nth(1)
  await chevron.click()
  if (await initiative.isVisible()) throw new Error('collapsed objective still shows its initiatives')
  if ((await first.getByRole('button', { name: /^Expand Delivery/ }).getAttribute('aria-expanded')) !== 'false') throw new Error('aria-expanded did not flip')
  await first.getByText('1 KR · 1 initiative').first().waitFor()
  await page.locator('[data-test="toggle-all"]').click() // some are closed, so this expands all
  await page.getByRole('button', { name: 'Collapse all' }).waitFor()
  await initiative.waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Add objective' }).click()
  if ((await panels.count()) !== 3) throw new Error('Add objective did not add a panel')
  const added = panels.last().locator('input').first()
  if (!(await added.evaluate((el) => el === document.activeElement))) throw new Error('new objective input is not focused')
  await panels.last().getByText('Needs attention').waitFor()
  await page.locator('[data-test="toggle-all"]').click() // collapse all; the unnamed objective must stay open
  if (!(await panels.last().locator('textarea').first().isVisible())) throw new Error('an objective that needs attention was collapsed')
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(200)
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length }))
    if (m.page > 1 || m.wide > 0) throw new Error(`Objective accordions overflow at ${width}px (page +${m.page}px, ${m.wide} elements past the edge)`)
    if (width === 768) await shot('04d-accordion-768')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(200)
  await shot('04e-accordion')
})

await step('template editor imports the same Excel file with the same extractor', async () => {
  await page.goto(`${APP}/pgp/templates/new`)
  await page.getByRole('tab', { name: 'Upload Excel (.xlsx)' }).click()
  await page.locator('[data-test="xlsx-file"]').setInputFiles(join(OUT, 'e2e-plan.xlsx'))
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((t) => t.value === 'Average 40 story points'), undefined, { timeout: 10_000 })
  if ((await page.getByPlaceholder('2026-Q4').inputValue()) !== '2025-Q1') throw new Error('template period was not read from the tab name')
  await page.getByRole('button', { name: 'Create template' }).click()
  await page.waitForURL(/\/pgp\/templates\/[0-9a-f-]{36}$/)
  const tpl = await api('GET', `/api/pgp/templates/${page.url().split('/').pop()}`)
  const got = tpl.items.map((i: { weight: number; initiative: string }) => `${i.weight}:${i.initiative}`).join('|')
  if (tpl.period !== '2025-Q1' || got !== '60:Average 40 story points|40:Zero P0 bugs') throw new Error(`unexpected template ${tpl.period} ${got}`)
  await shot('04c-template-from-upload')
})

await step('plan editor shows Confluence evidence card (no page body)', async () => {
  await page.goto(`${APP}/pgp/plans/${planId}`)
  await text(page, 'Created or edited in the last 90 days')
  await text(page, 'Runbook Signing')
  if (await page.getByText('CONFIDENTIAL BODY TEXT').count()) throw new Error('page body/excerpt leaked into the UI')
  await shot('02b-plan-confluence')
})

await step('My Confluence lists, searches and links my pages', async () => {
  await page.goto(`${APP}/confluence`)
  await text(page, 'Postmortem SEV1')
  await text(page, 'Roadmap Q4')
  await text(page, 'Rows per page')
  await text(page, 'Showing 1-4 of 4')
  const cfReq = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/confluence/pages')).at(-1) ?? '')
  if (!cfReq.includes('pagelen=20') || !cfReq.includes('role=creator')) throw new Error(`Confluence request is not the 20-row creator list: ${cfReq}`)
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const m = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - innerWidth,
      rows: [...document.querySelectorAll('[data-row]')].filter((r) => r.scrollWidth > r.clientWidth + 1).length,
    }))
    if (m.page > 1 || m.rows > 0) throw new Error(`My Confluence scrolls sideways at ${width}px (page +${m.page}px, ${m.rows} rows)`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)
  const href = await page.getByRole('link', { name: 'Runbook Signing' }).first().getAttribute('href')
  if (!href?.startsWith('http://localhost:4010/wiki/spaces/')) throw new Error(`unexpected link ${href}`)
  await page.getByPlaceholder('Search your pages by title').fill('runbook')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByText('Postmortem SEV1').first().waitFor({ state: 'detached', timeout: 8000 })
  await text(page, 'Runbook Signing')
  if (await page.getByText('CONFIDENTIAL BODY TEXT').count()) throw new Error('page body/excerpt leaked into the UI')
  await shot('02c-my-confluence')
})

await step('kanban shows columns and cards', async () => {
  await page.goto(`${APP}/kanban`)
  await text(page, 'Tidy up the signing endpoint')
  await text(page, 'In Progress')
  await shot('04-kanban')
})

await step('issue drawer opens with panel and overlay', async () => {
  await page.getByText('Add webhook retries').first().click()
  await text(page, 'Synthetic description for Add webhook retries')
  await page.waitForTimeout(800)
  const layout = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent?.includes('Synthetic description for'))
    let panel: Element | null = el ?? null
    while (panel && getComputedStyle(panel).position !== 'fixed') panel = panel.parentElement
    const overlay = [...document.querySelectorAll('div')].some((d) => {
      const s = getComputedStyle(d)
      return s.position === 'fixed' && d.clientWidth >= innerWidth - 1 && d.clientHeight >= innerHeight - 1 && s.backgroundColor !== 'rgba(0, 0, 0, 0)'
    })
    const r = panel?.getBoundingClientRect()
    return { panelWidth: r && r.left < innerWidth ? Math.min(r.right, innerWidth) - Math.max(r.left, 0) : 0, overlay }
  })
  if (layout.panelWidth < 300) throw new Error(`drawer panel missing or too narrow (${layout.panelWidth}px)`)
  if (!layout.overlay) throw new Error('drawer overlay missing')
  await shot('05-issue-drawer')
  await page.keyboard.press('Escape')
})

await step('PR list (author and reviewer)', async () => {
  await page.goto(`${APP}/pull-requests`)
  await text(page, 'MESIGN-101 Tidy up the signing endpoint')
  await text(page, 'Rows per page')
  await text(page, 'Showing 1-3 of 3')
  const prReq = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/pull-requests?')).at(-1) ?? '')
  if (!prReq.includes('pagelen=20')) throw new Error(`PR list did not ask for 20 rows: ${prReq}`)
  await page.waitForTimeout(600) // avatars and icons load after the first paint
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const m = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - innerWidth,
      rows: [...document.querySelectorAll('main a[href^="/pull-requests/"], a[href^="/pull-requests/"]')].filter((a) => a.scrollWidth > a.clientWidth + 1).length,
    }))
    if (m.page > 1 || m.rows > 0) throw new Error(`PR list scrolls sideways at ${width}px (page +${m.page}px, ${m.rows} rows)`)
    if (width === 1024) await shot('06b-pr-1024')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await shot('06-pr-author')
  await page.getByRole('button', { name: 'Needs my review' }).click()
  await text(page, 'MESIGN-104 Migrate the email template')
  await shot('07-pr-reviewer')
})

await step('PR detail shows files and diff', async () => {
  await page.getByRole('button', { name: 'Created by me' }).click()
  await page.getByText('MESIGN-101 Tidy up the signing endpoint').first().click()
  await page.waitForURL(/\/pull-requests\/msign-backend\/101$/)
  await page.getByRole('tab', { name: /^Files/ }).click()
  await text(page, 'app/signing.rb')
  await page.getByRole('button', { name: 'Show diff' }).first().click()
  await text(page, 'class Signing')
  await shot('08-pr-detail-diff')
})

await step('templates list and new template page', async () => {
  await page.goto(`${APP}/pgp/templates`)
  await text(page, title)
  await shot('09-templates')
  await page.goto(`${APP}/pgp/templates/${templateId}`)
  await text(page, 'Add initiative')
  await page.waitForTimeout(400)
  await shot('09b-template-editor')
  await page.goto(`${APP}/pgp/templates/new`)
  await text(page, 'Create template')
  await shot('10-template-new')
})

await step('no JS errors collected', async () => {
  if (jsErrors.length) throw new Error(`${jsErrors.length} error(s): ${jsErrors.slice(0, 3).join(' | ')}`)
})

await browser.close()
stop()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Screenshots: ${OUT}`)
process.exit(failed.length ? 1 : 0)
