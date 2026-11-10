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
  DEV_LOGIN_EMAIL: EMAIL,
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

const jsErrors: string[] = []
// Pixel icons come from cdn.mekari.design; they may be blocked in sandboxes.
const ignorable = (s: string) => s.includes('cdn.mekari.design')
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

await step('login (dev) lands on PGP home', async () => {
  await page.goto(`${APP}/auth/dev-login`)
  await page.waitForURL(/\/pgp$/)
  await text(page, 'Personal Growth Plan')
  await shot('01-pgp-home')
})

await step('admin creates & publishes template (API), shown on home', async () => {
  const t = await api('POST', '/api/pgp/templates', {
    title, period: '2026-Q4',
    items: [
      { objective: 'Reliability', keyResult: 'SLO 99.9%', weight: 60, initiative: 'Fix noisy alerts' },
      { objective: 'Delivery', keyResult: 'Ship 3 features', weight: 40, initiative: 'Sprint planning' },
    ],
  })
  await api('PATCH', `/api/pgp/templates/${t.id}`, { status: 'published' })
  await page.reload()
  await text(page, title)
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
  await page.goto(`${APP}/pgp`)
  await page.getByRole('button', { name: 'Fill in this PGP' }).first().click()
  await page.waitForURL(/\/pgp\/plans\/[0-9a-f-]{36}$/)
  planId = page.url().split('/').pop()!
  const input = page.locator('input[type=number][max]').first()
  await input.waitFor()
  await input.fill('5')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async (id) => (await (await fetch(`/api/pgp/plans/${id}`)).json()).score > 0, planId, { timeout: 10_000 })
  await shot('02-plan-editor')
})

await step('plan editor shows Confluence evidence card (no page body)', async () => {
  await page.goto(`${APP}/pgp/plans/${planId}`)
  await text(page, 'Your Confluence pages')
  await text(page, 'Runbook Signing')
  if (await page.getByText('CONFIDENTIAL BODY TEXT').count()) throw new Error('page body/excerpt leaked into the UI')
  await shot('02b-plan-confluence')
})

await step('My Confluence lists, searches and links my pages', async () => {
  await page.goto(`${APP}/confluence`)
  await text(page, 'Postmortem SEV1')
  await text(page, 'Roadmap Q4')
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
  await page.getByPlaceholder('Search page titles').fill('runbook')
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
