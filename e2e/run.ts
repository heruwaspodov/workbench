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
const DB_NAME = 'workbench-e2e'
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
// The 409 is the expected answer when a quarter is created twice, and the 400 when an SLA goal gets a target that is not a duration (each checked in its own step).
const ignorable = (s: string) => s.includes('cdn.mekari.design') || s.includes('status of 409') || s.includes('status of 400')
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
  // Nobody may link someone else's account by hand any more.
  for (const [method, path, data] of [['PUT', '/api/connections/jira', { accountId: 'acc-other' }], ['GET', '/api/connections/jira/users?q=a', undefined], ['PUT', '/api/connections/bitbucket', { uuid: 'x' }]] as const) {
    const r = await page.request.fetch(APP + path, { method, data: data as never, headers: { origin: APP, ...(data ? { 'content-type': 'application/json' } : {}) } })
    if (r.status() !== 404) throw new Error(`${method} ${path} should be gone, got ${r.status()}`)
  }
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
  if (!(await page.locator('[data-test="xlsx-choose"]').isVisible())) throw new Error('Choose file button is not visible')
  await shot('04a-upload-choose-button')
  await page.locator('[data-test="xlsx-file"]').setInputFiles(xlsx)
  await page.getByText('e2e-plan.xlsx').waitFor().catch(() => { throw new Error('chosen file name not shown') })
  await page.locator('[data-test="create-plan"]').waitFor() // initiatives sit in textareas, which getByText cannot match
  if ((await page.getByPlaceholder('2026').inputValue()) !== '2025') throw new Error('year was not read from the tab name')
  await shot('04-create-from-upload')
  await page.locator('[data-test="create-plan"]').click()
  await page.waitForURL(/\/pgp\/plans\/[0-9a-f-]{36}$/)
  await text(page, 'PGP 2025-Q1')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-test="evidence"] input')].some((t) => (t as HTMLInputElement).value.includes('https://jira.example.test/issues?jql=e2e')), undefined, { timeout: 10_000 })

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

await step('evidence is a list of link inputs: add, Enter, paste several, remove, save', async () => {
  await page.goto(`${APP}/pgp/plans/${planId}`)
  const first = page.locator('[data-test="evidence"]').first()
  await first.waitFor()
  const inputs = first.locator('input')
  const start = await inputs.count()
  await first.locator('[data-test="evidence-add"]').click()
  if ((await inputs.count()) !== start + 1) throw new Error('Add link did not add an input')
  if (!(await inputs.last().evaluate((el) => el === document.activeElement))) throw new Error('the new input is not focused')
  await inputs.last().fill('https://example.test/one')
  await inputs.last().press('Enter')
  if ((await inputs.count()) !== start + 2) throw new Error('Enter did not add a row below')
  // Paste two URLs at once into the empty row: they become two rows.
  await inputs.last().evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text', 'https://example.test/two\nhttps://example.test/three')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction((n) => document.querySelectorAll('[data-test="evidence"]')[0]!.querySelectorAll('input').length === n, start + 3)
  await inputs.nth(start + 1).fill('not a url')
  await first.getByText('Links should start with http').waitFor()
  await first.getByRole('button', { name: `Remove evidence link ${start + 2}` }).click() // drop "not a url"
  await shot('02e-evidence-list')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async (id) => {
    const p = await (await fetch(`/api/pgp/plans/${id}`)).json()
    const all = p.items.flatMap((i: { evidenceLinks: string[] }) => i.evidenceLinks)
    return all.includes('https://example.test/one') && all.includes('https://example.test/three') && !all.includes('not a url') && !all.includes('')
  }, planId, { timeout: 10_000 })
  const m = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  if (m > 1) throw new Error('evidence list overflows')
})

await step('team label is saved in Connections', async () => {
  await page.goto(`${APP}/connections`)
  await page.getByLabel('Team label').fill('team-x')
  await page.locator('[data-test="team-label-form"]').getByRole('button', { name: 'Save' }).click()
  await page.waitForFunction(async () => (await (await fetch('/api/connections')).json()).jira.teamLabel === 'team-x', undefined, { timeout: 10_000 })
  await shot('03c-connections-team-label')
})

await step('plan suggestions: epics, Confluence, monthly delivery modal, Add to…, team rate', async () => {
  await page.goto(`${APP}/pgp/plans/${planId}`)
  await text(page, 'Pages you created or edited')
  // Cards are collapsed except the epics; open every other one first.
  let rateRequests = 0
  const countRate = (r: { url(): string }) => { if (r.url().includes('/suggestions/delivery-rate')) rateRequests++ }
  page.on('request', countRate)
  for (const id of ['pages', 'delivery', 'bugs', 'sla', 'rate']) {
    if (id === 'rate') {
      await page.waitForTimeout(1500)
      if (rateRequests !== 0) throw new Error('the team delivery rate was requested while its card was closed')
    }
    const head = page.locator(`section[data-test="${id}"] > button[aria-expanded]`)
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  }
  await text(page, 'Tickets done')
  if (rateRequests !== 1) throw new Error(`opening the card should load the rate once, got ${rateRequests}`)
  await page.locator('section[data-test="rate"] > button[aria-expanded]').click() // close
  await page.locator('section[data-test="rate"] > button[aria-expanded]').click() // open again
  await page.waitForTimeout(800)
  if (rateRequests !== 1) throw new Error(`reopening the card must not reload the same label, got ${rateRequests}`)
  page.off('request', countRate)
  await text(page, 'Runbook Signing')
  if (await page.getByText('CONFIDENTIAL BODY TEXT').count()) throw new Error('page body/excerpt leaked into the UI')
  await text(page, 'Mock epic for e2e')
  await page.locator('[data-test="bugs"]').getByText('P2', { exact: true }).waitFor()
  if (!(await page.locator('[data-test="bugs"]').innerText()).replace(/\s+/g, ' ').includes('P2 2')) throw new Error('bugs by priority should show P2 2')
  await shot('02b-plan-suggestions')

  // Month row -> modal with the tickets, a Jira JQL link, and "Use as current value".
  const row = page.locator('[data-month]').first()
  await row.waitFor()
  await row.click()
  await text(page, 'Delivered story')
  const total = (await page.locator('[data-test="month-total"]').innerText()).replace(/\s+/g, ' ')
  if (!/^8 SP · 2 tickets/.test(total)) throw new Error(`unexpected month total: ${total}`)
  const jira = await page.getByRole('link', { name: 'Open in Jira' }).last().getAttribute('href') // the modal renders last
  if (!jira?.includes('/issues?jql=') || !jira.includes('resolutiondate')) throw new Error(`unexpected Jira link: ${jira}`)
  await shot('02c-month-modal')
  await page.getByRole('button', { name: 'Add to…' }).last().click()
  await page.locator('input[name="target-initiative"]').first().check()
  await page.locator('[data-test="use-current"]').click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async (id) => {
    const p = await (await fetch(`/api/pgp/plans/${id}`)).json()
    return p.items.some((i: { currentValue: string | null }) => /^8 SP · 2 tickets/.test(i.currentValue ?? ''))
  }, planId, { timeout: 10_000 })

  // Epics -> initiatives, confirmed in a modal, deduplicated on a second run.
  await page.locator('[data-test="add-epics"]').click()
  await page.locator('[data-test="confirm-epics"]').click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(async (id) => {
    const p = await (await fetch(`/api/pgp/plans/${id}`)).json()
    return p.items.some((i: { initiative: string; evidenceLinks: string[]; weight: number }) => i.initiative === 'Mock epic for e2e' && i.weight === 0 && i.evidenceLinks.some((l) => l.endsWith('/browse/MESIGN-901')))
  }, planId, { timeout: 10_000 })
  await page.locator('[data-test="add-epics"]').click()
  await text(page, 'already linked in this plan')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Fast Track SLA: judged against the seeded goals (P2 5 working days, P1 2 working days; one ticket matches no goal).
  await text(page, 'Within SLA')
  const slaText = (await page.locator('[data-test="sla"]').innerText()).replace(/\s+/g, ' ')
  for (const part of ['2/3 tickets', 'P2 General', 'P1 General', '1 no goal', 'Fast Track ticket 2']) {
    if (!slaText.includes(part)) throw new Error(`Fast Track SLA card is missing "${part}": ${slaText}`)
  }
  await page.waitForTimeout(500)
  await page.locator('[data-test="sla"]').screenshot({ path: join(OUT, '02i-fast-track-sla.png') })

  // Team delivery rate: the default label from Connections is used without typing.
  await text(page, 'Tickets done')
  await text(page, 'Default: team-x')
  await page.getByPlaceholder('Jira label').fill('team-y')
  await page.locator('[data-test="save-default-label"]').click()
  await page.waitForFunction(async () => (await (await fetch('/api/connections')).json()).jira.teamLabel === 'team-y', undefined, { timeout: 10_000 })
  await text(page, 'Default: team-y')
  await page.getByPlaceholder('Jira label').fill('team-x')
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  await text(page, 'Tickets done')
  const rateText = (await page.locator('[data-test="rate"]').innerText()).replace(/\s+/g, ' ')
  if (!rateText.includes('50%') || !rateText.includes('1/2 tickets')) throw new Error(`unexpected team rate: ${rateText}`)
  for (const part of ['Tickets released', '100%', '1/1 done tickets', 'Label epic number 1', 'Epics delivered: 1/11', 'No children']) {
    if (!rateText.includes(part)) throw new Error(`team rate card is missing "${part}": ${rateText}`)
  }
  await shot('02f-team-rate')
  // "Show all" on every list: the panel must stay inside the viewport and its content must stay reachable (internal scroll).
  const showAll = page.getByRole('button', { name: /^Show all \d+/ })
  while (await showAll.count()) await showAll.first().click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(250)
  const fit = await page.evaluate(() => {
    const a = document.querySelector('aside[aria-label="Suggestions"]') as HTMLElement
    const r = a.getBoundingClientRect()
    const wide = [...a.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > r.right + 1 && getComputedStyle(e).position !== 'fixed').length
    return { height: r.height, view: innerHeight, canScroll: a.scrollHeight > a.clientHeight || a.scrollHeight <= innerHeight, wide }
  })
  if (fit.height > fit.view || fit.wide > 0) throw new Error(`suggestions panel is taller than the screen or spills sideways: ${JSON.stringify(fit)}`)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(OUT, '02g-suggestions-show-all.png') }) // viewport only: a full-page shot distorts a sticky panel
  await page.locator('aside[aria-label="Suggestions"]').evaluate((a) => a.scrollTo(0, a.scrollHeight))
  await page.screenshot({ path: join(OUT, '02h-suggestions-bottom.png') })
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length }))
    if (m.page > 1 || m.wide > 0) throw new Error(`Plan with suggestions overflows at ${width}px (page +${m.page}px, ${m.wide} elements past the edge)`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(200)
  await shot('02d-plan-suggestions-after')
})

await step('admin edits the SLA goals', async () => {
  await page.goto(`${APP}/admin/sla`)
  await page.locator('[data-test="sla-goal-row"]').first().waitFor()
  const n = await page.locator('[data-test="sla-goal-row"]').count()
  if (n !== 8) throw new Error(`expected the 8 seeded goals, got ${n}`)
  const target = page.locator('[data-test="sla-goal-row"]').first().getByLabel('Target')
  await target.fill('soon')
  await page.locator('[data-test="save-sla-goals"]').click()
  await text(page, 'is not a duration') // rejected with the reason, nothing saved
  await target.fill('9h')
  await page.locator('[data-test="save-sla-goals"]').click()
  await page.waitForFunction(async () => (await (await fetch('/api/sla/goals')).json())[0].target === '9h', undefined, { timeout: 10_000 })
  await shot('03d-sla-goals')
  await target.fill('8h')
  await page.locator('[data-test="save-sla-goals"]').click()
  await page.waitForFunction(async () => (await (await fetch('/api/sla/goals')).json())[0].target === '8h', undefined, { timeout: 10_000 })
})

await step('My Confluence lists, searches and links my pages', async () => {
  await page.goto(`${APP}/confluence`)
  await text(page, 'Postmortem SEV1')
  await text(page, 'Roadmap Q4')
  await text(page, 'Rows per page')
  await text(page, 'Showing 1-12 of 12')
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

await step('Timelines menu in the sidebar opens the Timelines page', async () => {
  await page.goto(`${APP}/pgp`)
  await page.getByRole('link', { name: 'Timelines' }).click()
  await page.waitForURL('**/timelines')
  await text(page, 'Delivery timeline and releases')
  const title = await page.title()
  if (title !== 'Timelines · Workbench') throw new Error(`Unexpected tab title: ${title}`)
  const active = await page.getByRole('link', { name: 'Timelines' }).evaluate((el) => getComputedStyle(el).fontWeight)
  if (Number(active) < 600) throw new Error(`Timelines menu is not highlighted (font-weight ${active})`)
  await shot('02d-timelines')
})

await step('admin uploads an initiatives .xlsx, previews it, saves it for a chosen year', async () => {
  const ExcelJS = (await import('exceljs')).default
  const head = ['Squad', 'Jira Key', 'Initiative', 'Criticality', 'Est. Delivery Date', 'Jira Epic Status', 'Jira Owner Assigned', 'Jira Progress (Done/Total)',
    ...new Array(12).fill('').map((_, i) => `W${(i % 4) + 1}\n${['5-9 Oct', '12-16 Oct', '19-23 Oct', '26-30 Oct', '2-6 Nov', '9-13 Nov', '16-20 Nov', '23-27 Nov', '30 Nov - 4 Dec', '7-11 Dec', '14-18 Dec', '21-25 Dec'][i]}`)]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('26Q4 Initiatives')
  ws.addRow([])
  ws.addRow(head)
  const week = (label: string) => head.findIndex((h) => h.endsWith(label))
  const a = ['Escape', 'MESIGN-99001', 'E2E signing flow', 'Strategic', '2026-11-30', 'In Progress', 'Synthetic Owner', '3/10', ...new Array(12).fill('')]
  a[week('19-23 Oct')] = 'Release\n19 Oct'
  const b = ['Intact', 'MESIGN-99002', 'E2E stamp tool', 'BaU', '', 'To Do', '', '', ...new Array(12).fill('')]
  b[week('30 Nov - 4 Dec')] = 'Release\n30 Nov'
  ws.addRow(a)
  ws.addRow(b)
  const xlsx = join(OUT, 'e2e-initiatives.xlsx')
  await wb.xlsx.writeFile(xlsx)
  const year = 2010 + Math.floor(Math.random() * 89) // a year nothing else uses, so every run starts from an empty quarter

  await page.goto(`${APP}/timelines`)
  await page.getByRole('link', { name: 'Import initiatives' }).click()
  await page.waitForURL('**/timelines/import')
  await page.locator('[data-test="xlsx-file"]').setInputFiles(xlsx)
  await text(page, 'Read from the sheet name or file name')
  const prefilled = await page.getByPlaceholder('2026').inputValue()
  if (prefilled !== '2026') throw new Error(`Year was not read from the sheet name: "${prefilled}"`)
  await page.getByPlaceholder('2026').fill(String(year))
  await page.locator('[data-test="import-counts"]').getByText('2 new').waitFor()
  await text(page, 'MESIGN-99001')
  await text(page, 'E2E stamp tool')
  await shot('02e-initiatives-import')
  await page.locator('[data-test="import-save"]').click()
  await page.waitForURL('**/timelines')
  const saved = await page.evaluate(async (y) => (await fetch(`/api/initiatives?year=${y}&quarter=4`, { credentials: 'include' })).json(), year)
  if (saved.length !== 2) throw new Error(`Expected 2 saved initiatives, got ${saved.length}`)
  const first = saved.find((r: { jiraKey: string }) => r.jiraKey === 'MESIGN-99001')
  if (first.milestones[0]?.date !== `${year}-10-19`) throw new Error(`Release marker not saved with the chosen year: ${JSON.stringify(first.milestones)}`)
  await page.evaluate(async (y) => {
    for (const r of await (await fetch(`/api/initiatives?year=${y}&quarter=4`, { credentials: 'include' })).json()) {
      await fetch(`/api/initiatives/${r.id}`, { method: 'DELETE', credentials: 'include', headers: { origin: location.origin } })
    }
  }, year)
})

await step('Timelines dashboard: quarter, KPIs, filters, grid, and admin add / edit / delete', async () => {
  const YEAR = 2099 // newest quarter, so it is the default one; cleaned before and after
  const api = (method: string, path: string, body?: unknown) => page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, { method: m as string, credentials: 'include', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, [method, path, body] as const)
  const clean = async () => {
    for (const r of (await api('GET', `/api/initiatives?year=${YEAR}&quarter=4`)).json ?? []) await api('DELETE', `/api/initiatives/${r.id}`)
  }
  await page.goto(`${APP}/timelines`)
  await clean()
  const seed = (o: Record<string, unknown>) => api('POST', '/api/initiatives', { year: YEAR, quarter: 4, criticality: 'Strategic', ...o })
  await seed({ jiraKey: 'MESIGN-98001', title: 'E2E signing flow', squad: 'Escape', epicStatus: 'In Progress', ownerName: 'Synthetic Owner', estDeliveryDate: `${YEAR}-11-30`, doneItems: 3, totalItems: 10, remarkProposed: 'Tail is in QA.', remark: 'Full TPM remark line one.\nLine two stays visible in the detail panel.', sheetAnomalies: '1) Epic reads Done but 8 child item(s) are still open.', sheetResolution: 'Open', repoNote: '01-tribes/esign/squads/escape/initiatives/26q4/e2e-signing-flow.md', milestones: [{ kind: 'self_test', date: `${YEAR}-11-16` }, { kind: 'release', date: `${YEAR}-11-30` }] })
  await seed({ jiraKey: 'MESIGN-98002', title: 'E2E stamp tool', squad: 'Intact', criticality: 'BaU', epicStatus: 'Done', ownerName: 'Synthetic Owner', estDeliveryDate: `${YEAR}-10-16`, actualDeliveryDate: `${YEAR}-10-19`, doneItems: 5, totalItems: 5, prdUrl: 'https://docs.example.test/prd', rfcUrl: 'https://docs.example.test/rfc', milestones: [{ kind: 'release', date: `${YEAR}-10-19` }] })
  await seed({ jiraKey: 'MESIGN-98003', title: 'E2E backlog item', squad: 'Utmost', epicStatus: 'To Do', needsReview: true })
  await page.goto(`${APP}/timelines`)

  // Delivery timeline (the default view): 12 weeks, markers in the week their date falls in.
  await page.locator('[data-test="view-timeline"]').waitFor()
  if ((await page.locator('[data-week]').count()) !== 12) throw new Error('The timeline does not show 12 weeks')
  const firstMonday = (() => { const d = new Date(Date.UTC(YEAR, 9, 1)); return Date.UTC(YEAR, 9, 1 + ((8 - d.getUTCDay()) % 7)) })()
  const weekOf = (iso: string) => Math.floor((Date.parse(iso) - firstMonday) / (7 * 86_400_000))
  for (const [key, kind, iso, shown] of [
    ['MESIGN-98001', 'self_test', `${YEAR}-11-16`, '16 Nov'], ['MESIGN-98001', 'release', `${YEAR}-11-30`, '30 Nov'], ['MESIGN-98002', 'release', `${YEAR}-10-19`, '19 Oct'],
  ] as const) {
    const marker = page.locator(`[data-cell="${key}:${weekOf(iso)}"] [data-marker="${kind}"]`)
    if ((await marker.count()) !== 1 || !(await marker.innerText()).includes(shown)) throw new Error(`${kind} marker for ${key} is not in week ${weekOf(iso) + 1} (${shown})`)
  }
  if ((await page.locator('[data-marker]').count()) !== 3) throw new Error('The timeline shows markers that were not seeded')
  await text(page, 'Goal risk')
  await shot('02g-timeline')

  // Kanban: one column per epic status, a card per initiative.
  await page.getByRole('button', { name: 'Kanban board' }).click()
  await page.locator('[data-test="view-kanban"]').waitFor()
  for (const [column, title] of [['To Do', 'E2E backlog item'], ['In Progress', 'E2E signing flow'], ['Done', 'E2E stamp tool']] as const) {
    const cards = page.locator(`[data-column="${column}"] [data-card]`)
    if ((await cards.count()) !== 1 || !(await cards.innerText()).includes(title)) throw new Error(`Kanban column ${column} should hold only "${title}"`)
  }
  await shot('02h-kanban')

  // Health: only initiatives with something to resolve, and the badge count matches the list.
  await page.getByRole('button', { name: /^Health & anomalies/ }).click()
  await page.locator('[data-test="view-health"]').waitFor()
  await text(page, 'Health & anomalies (1)')
  if ((await page.locator('[data-test="view-health"] [data-row]').count()) !== 1) throw new Error('Health should list exactly the one initiative with anomalies')
  await text(page, 'No epic owner (assignee).')
  await shot('02i-health')
  await page.getByRole('button', { name: /^All initiatives/ }).click()
  if ((await page.locator('[data-test="view-health"] [data-row]').count()) !== 3) throw new Error('Health "All initiatives" should list all 3')
  const url = new URL(page.url())
  if (url.searchParams.get('tab') !== 'health') throw new Error(`The chosen view is not kept in the URL: ${page.url()}`)
  await page.reload()
  await page.locator('[data-test="view-health"]').waitFor()

  // Grid
  await page.getByRole('button', { name: /^Grid view/ }).click()
  await page.locator('[data-test="view-grid"]').waitFor()
  await text(page, 'Grid view (3)')
  const kpi = async (id: string) => (await page.locator(`[data-test="${id}"]`).innerText()).replace(/\s+/g, ' ')
  for (const [id, expected] of [['kpi-total', '3'], ['kpi-done', '1'], ['kpi-active', '1'], ['kpi-review', '1']] as const) {
    if (!(await kpi(id)).includes(` ${expected} `) && !(await kpi(id)).match(new RegExp(`\\b${expected}\\b`))) throw new Error(`KPI ${id} is not ${expected}: ${await kpi(id)}`)
  }
  const period = await page.locator('select[data-test="period-select"], [data-test="period-select"] select').first().inputValue()
  if (period !== `${YEAR}-4`) throw new Error(`Newest quarter is not selected: ${period}`)
  // The server refuses non-http links outright (see the server tests), so here only the http ones appear.
  if ((await page.getByRole('link', { name: 'PRD' }).count()) !== 1 || (await page.getByRole('link', { name: 'RFC' }).count()) !== 1) throw new Error('The PRD / RFC links are missing')
  await text(page, 'Full TPM remark line one.') // the grid shows the TPM remark first (the proposed one is in the detail panel)
  await shot('02f-timelines-grid')

  const pick = (id: string, value: string) => page.locator(`select[data-test="${id}"], [data-test="${id}"] select`).first().selectOption(value)
  await pick('f-squad', 'Intact')
  await text(page, 'Grid view (1)')
  await pick('f-squad', '')
  await pick('f-status', 'Done')
  await text(page, 'Grid view (1)')
  await pick('f-status', '')
  await pick('f-criticality', 'BaU')
  await text(page, 'Grid view (1)')
  await pick('f-criticality', '')
  await pick('f-month', `${YEAR}-11`)
  await text(page, 'Grid view (1)')
  await pick('f-month', '')
  await page.getByPlaceholder('Search initiatives').fill('backlog')
  await text(page, 'Grid view (1)')
  await page.getByPlaceholder('Search initiatives').fill('nothing matches this')
  await text(page, 'No initiatives match these filters.')
  await page.getByPlaceholder('Search initiatives').fill('')
  await text(page, 'Grid view (3)')

  // Detail panel (everyone): opens from every view, shows the full remark, the sheet's anomalies and the app's own, and the repo note.
  const expectDetail = async (p: Page, admin: boolean) => {
    const detail = p.locator('[data-test="initiative-detail"]')
    await detail.waitFor()
    await p.waitForTimeout(600) // let the drawer finish sliding in (screenshots and reads)
    for (const [id, want] of [
      ['detail-remark', 'Line two stays visible in the detail panel.'], ['detail-remark-proposed', 'Tail is in QA.'],
      ['detail-sheet-anomalies', 'Epic reads Done but 8 child item(s) are still open.'], ['detail-sheet-resolution', 'Sheet: Open'],
      ['detail-app-resolution', 'Workbench: Nothing to resolve'], ['detail-repo-note', 'e2e-signing-flow.md'],
    ] as const) {
      const got = await detail.locator(`[data-test="${id}"]`).innerText()
      if (!got.includes(want)) throw new Error(`Detail ${id} should contain "${want}", got "${got}"`)
    }
    const edit = await p.locator('[data-test="detail-edit"]').count()
    if (admin && edit !== 1) throw new Error('An admin should see Edit in the detail panel')
    if (!admin && edit !== 0) throw new Error('A member must not see Edit in the detail panel')
  }
  const closeDetail = async (p: Page) => { await p.getByRole('button', { name: 'Close', exact: true }).first().click(); await p.locator('[data-test="initiative-detail"]').waitFor({ state: 'detached' }) }
  await page.getByRole('button', { name: 'Delivery timeline & releases' }).click()
  await page.locator('[data-test="view-timeline"] [data-test="open-initiative"]', { hasText: 'E2E signing flow' }).click()
  await expectDetail(page, true)
  await page.screenshot({ path: join(OUT, '02k-detail.png') })
  await closeDetail(page)
  await page.getByRole('button', { name: 'Kanban board' }).click()
  await page.locator('[data-column="In Progress"] [data-card]').click()
  await expectDetail(page, true)
  await closeDetail(page)
  await page.getByRole('button', { name: /^Health & anomalies/ }).click()
  await page.getByRole('button', { name: /^All initiatives/ }).click()
  await page.locator('[data-test="view-health"] [data-row]', { hasText: 'E2E signing flow' }).locator('[data-test="open-initiative"]').click()
  await expectDetail(page, true)
  await page.locator('[data-test="detail-edit"]').click() // admin: Edit opens the form, with the sheet columns in it
  await page.locator('[data-test="initiative-form"]').waitFor()
  const formText = await page.locator('[data-test="initiative-form"]').innerText()
  if (!formText.includes('Repo note')) throw new Error('The form has no Repo note field')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: /^Grid view/ }).click()
  const gridRow = page.locator('[data-test="view-grid"] [data-row]', { hasText: 'E2E signing flow' })
  if (!(await gridRow.locator('[data-test="sheet-resolution"]').innerText()).includes('Open')) throw new Error('Grid should show the resolution written in the sheet')
  await gridRow.locator('[data-test="open-initiative"]').click()
  await expectDetail(page, true)
  await closeDetail(page)

  // A member sees the same panel, without Edit and without write buttons.
  const viewer = await AuthService.upsertUser({ subject: 'e2e-viewer', email: 'e2e-viewer@mekari.com', name: 'E2E Viewer' })
  const viewerSession = await AuthService.createSession(viewer.id)
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await viewerContext.addCookies([{ name: 'od_session', value: viewerSession.token, url: APP }])
    const vp = await viewerContext.newPage()
    vp.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text() + (m.location().url ?? ''))) jsErrors.push(`member console: ${m.text()}`) })
    await vp.goto(`${APP}/timelines?tab=grid`)
    await vp.locator('[data-test="view-grid"] [data-test="open-initiative"]', { hasText: 'E2E signing flow' }).click()
    await expectDetail(vp, false)
    if ((await vp.locator('[data-test="new-initiative"]').count()) !== 0 || (await vp.locator('[data-test="edit-initiative"]').count()) !== 0) throw new Error('A member must not see write buttons')
    await vp.screenshot({ path: join(OUT, '02l-detail-member.png') })
  } finally {
    await viewerContext.close()
    const { db: appDb } = await import('../apps/server/src/db/client')
    const { users: usersTable } = await import('../apps/server/src/db/schema')
    const { eq: eqOp } = await import('drizzle-orm')
    await appDb.delete(usersTable).where(eqOp(usersTable.id, viewer.id))
  }

  // add
  await page.locator('[data-test="new-initiative"]').click()
  await page.locator('[data-test="f-key"]').fill('MESIGN-98004')
  await page.locator('[data-test="f-title"]').fill('E2E added by form')
  await page.locator('[data-test="add-marker"]').click()
  await page.locator('[data-test="initiative-form"] input[type="date"]').last().fill(`${YEAR}-12-11`)
  await page.locator('[data-test="save-initiative"]').click()
  await text(page, 'Grid view (4)')
  await text(page, 'E2E added by form')
  // edit
  await page.locator('[data-row]', { hasText: 'E2E added by form' }).locator('[data-test="edit-initiative"]').click()
  await page.locator('[data-test="f-title"]').fill('E2E edited by form')
  await page.locator('[data-test="save-initiative"]').click()
  await text(page, 'E2E edited by form')
  const marks = (await api('GET', `/api/initiatives?year=${YEAR}&quarter=4&q=98004`)).json[0].milestones
  if (marks.length !== 1 || !String(marks[0].date).startsWith(`${YEAR}-12-11`)) throw new Error(`Release marker not saved: ${JSON.stringify(marks)}`)
  // delete
  await page.locator('[data-row]', { hasText: 'E2E edited by form' }).locator('[data-test="edit-initiative"]').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('[data-test="confirm-delete-initiative"]').click()
  await text(page, 'Grid view (3)')
  await clean()
})

await step('Timelines: long titles wrap inside their cells in every view', async () => {
  const YEAR = 2098 // a quarter of its own, so the other Timelines steps are unaffected
  const call = (method: string, path: string, body?: unknown) => page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, { method: m as string, credentials: 'include', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, [method, path, body] as const)
  const clean = async () => { for (const r of (await call('GET', `/api/initiatives?year=${YEAR}&quarter=4`)).json ?? []) await call('DELETE', `/api/initiatives/${r.id}`) }
  await page.goto(`${APP}/timelines`)
  await clean()
  const long = 'Autosign Management Page and Configuration for Partner Portal Phase 1: Portal Setup, Sending with Quota and Embedded Mode'
  for (const [key, title, squad] of [['MESIGN-97001', long, 'Escape'], ['MESIGN-97002', `X${'a'.repeat(90)}`, 'Intact']] as const) {
    await call('POST', '/api/initiatives', { year: YEAR, quarter: 4, jiraKey: key, title, squad, criticality: 'BaU', milestones: [{ kind: 'release', date: `${YEAR}-12-23` }] })
  }
  for (let i = 0; i < 26; i++) { // enough rows that the table has to scroll
    await call('POST', '/api/initiatives', { year: YEAR, quarter: 4, jiraKey: `MESIGN-97${String(100 + i)}`, title: `Filler initiative number ${i + 1}`, squad: 'Utmost', criticality: 'BaU' })
  }
  await page.goto(`${APP}/timelines`)
  await page.locator('select[data-test="period-select"], [data-test="period-select"] select').first().selectOption(`${YEAR}-4`)
  await page.locator('[data-test="view-timeline"]').waitFor()
  // The week header stays visible while the rows scroll.
  const scroll = page.locator('[data-test="timeline-scroll"]')
  if (!(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 20))) throw new Error('The timeline should scroll inside its card when there are many rows')
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const headerTop = await page.evaluate(() => {
    const box = document.querySelector('[data-test="timeline-scroll"]')!.getBoundingClientRect()
    const head = document.querySelector('[data-week="0"]')!.getBoundingClientRect()
    return { head: head.top, box: box.top, bottom: head.bottom, boxBottom: box.bottom }
  })
  if (headerTop.head < headerTop.box - 1 || headerTop.bottom > headerTop.boxBottom) throw new Error(`The week header scrolled out of view: ${JSON.stringify(headerTop)}`)
  await scroll.evaluate((el) => { el.scrollTop = 0 })

  /** Every title must sit inside the first cell of its row, and the next cell must start after the title ends. */
  const inside = (view: string, cellSelector: string) => page.evaluate(([v, c]) => {
    const bad: string[] = []
    for (const btn of document.querySelectorAll(`[data-test="${v}"] [data-test="open-initiative"]`)) {
      const cell = btn.closest(c as string)
      if (!cell) { bad.push(`no ${c}`); continue }
      // The button box is stretched to the cell, so measure the text itself: unwrapped text spills past the cell while the box does not.
      const range = document.createRange()
      range.selectNodeContents(btn)
      const t = range.getBoundingClientRect(), r = cell.getBoundingClientRect()
      if (t.right > r.right + 1 || t.left < r.left - 1 || t.bottom > r.bottom + 1) bad.push(`${btn.textContent?.slice(0, 30)} (${Math.round(t.right)} > ${Math.round(r.right)})`)
    }
    return bad
  }, [view, cellSelector] as const)

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    let bad = await inside('view-timeline', 'td, th')
    if (bad.length) throw new Error(`Timeline titles overflow their cell at ${width}px: ${bad.join('; ')}`)
    await page.getByRole('button', { name: /^Grid view/ }).click()
    await page.locator('[data-test="view-grid"]').waitFor()
    bad = await inside('view-grid', 'td, th')
    if (bad.length) throw new Error(`Grid titles overflow their cell at ${width}px: ${bad.join('; ')}`)
    await page.getByRole('button', { name: /^Health & anomalies/ }).click()
    await page.getByRole('button', { name: /^All initiatives/ }).click()
    bad = await inside('view-health', '[data-row]')
    if (bad.length) throw new Error(`Health titles overflow their row at ${width}px: ${bad.join('; ')}`)
    await page.getByRole('button', { name: 'Delivery timeline & releases' }).click()
    await page.locator('[data-test="view-timeline"]').waitFor()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await shot('02m-timeline-long-titles')
  await clean()
})

await step('Sync from Jira: stale rows are refreshed, the sheet-owned text is kept, members cannot sync', async () => {
  const YEAR = 2096 // a quarter of its own
  const call = (method: string, path: string, body?: unknown) => page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, { method: m as string, credentials: 'include', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, [method, path, body] as const)
  const clean = async () => { for (const r of (await call('GET', `/api/initiatives?year=${YEAR}&quarter=4`)).json ?? []) await call('DELETE', `/api/initiatives/${r.id}`) }
  await page.goto(`${APP}/timelines`)
  await clean()
  const stale = { year: YEAR, quarter: 4, squad: 'Escape', criticality: 'Strategic', ownerName: 'Old Owner', estDeliveryDate: `${YEAR}-01-01`, doneItems: 1, totalItems: 3, remarkProposed: 'Written before the sync', sheetAnomalies: '1) Epic reads Done but 2 child item(s) are still open.', sheetResolution: 'Open' }
  await call('POST', '/api/initiatives', { ...stale, jiraKey: 'MESIGN-96001', title: 'Sheet title one', epicStatus: 'Done', actualDeliveryDate: `${YEAR}-11-19` })
  await call('POST', '/api/initiatives', { ...stale, jiraKey: 'MESIGN-96002', title: 'Sheet title two', epicStatus: 'To Do', doneItems: 0, totalItems: 2 })
  await call('POST', '/api/initiatives', { ...stale, jiraKey: 'MESIGN-96009', title: 'Sheet title not in Jira', epicStatus: 'To Do' })

  await page.goto(`${APP}/timelines?tab=grid`)
  await page.locator('select[data-test="period-select"], [data-test="period-select"] select').first().selectOption(`${YEAR}-4`)
  const rowOne = page.locator('[data-test="view-grid"] [data-row]', { hasText: 'Sheet title one' })
  await rowOne.waitFor()
  if (!(await rowOne.innerText()).includes('1/3')) throw new Error('The seeded row should start with the stale 1/3')
  if ((await rowOne.locator('[data-test="anomaly-badge"]').count()) !== 1) throw new Error('The stale row should show its anomaly before the sync')
  await text(page, 'Sync from Jira')

  await page.locator('[data-test="sync-quarter"]').click()
  const result = page.locator('[data-test="sync-result"]')
  await result.waitFor()
  const said = (id: string) => result.locator(`[data-test="${id}"]`).innerText()
  if (!(await said('sync-updated')).startsWith('2 ')) throw new Error(`Expected 2 updated, got "${await said('sync-updated')}"`)
  if (!(await said('sync-missing')).startsWith('1 ')) throw new Error(`Expected 1 not found, got "${await said('sync-missing')}"`)
  const changes = await result.locator('[data-test="sync-changes"]').innerText()
  if (!changes.includes('MESIGN-96001') || !changes.includes('Progress') || !changes.includes('Owner')) throw new Error(`The change list is incomplete: ${changes}`)
  if (changes.includes('MESIGN-96009')) throw new Error('The row Jira does not know must not be listed as changed')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, '02n-sync-result.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await result.waitFor({ state: 'detached' })

  const afterOne = page.locator('[data-test="view-grid"] [data-row]', { hasText: 'Sheet title one' })
  await afterOne.locator('[data-test="anomaly-badge"]').waitFor({ state: 'detached' }) // "Done but children open" is gone with the fresh counts
  const gridText = await afterOne.innerText()
  if (!gridText.includes('3/3') || !gridText.includes('Synced Owner')) throw new Error(`The grid row was not refreshed: ${gridText.replace(/\s+/g, ' ')}`)
  const notFound = await page.locator('[data-test="view-grid"] [data-row]', { hasText: 'not in Jira' }).innerText()
  if (!notFound.includes('1/3') || !notFound.includes('Old Owner')) throw new Error('The row Jira does not know should be left as it was')

  // Sheet-owned text is untouched, and the panel says when Jira was last read.
  await afterOne.locator('[data-test="open-initiative"]').click()
  const detail = page.locator('[data-test="initiative-detail"]')
  await detail.waitFor()
  await page.waitForTimeout(600)
  if (!(await detail.locator('[data-test="detail-synced"]').innerText()).includes('Jira synced')) throw new Error('The panel should say when Jira was last read')
  if (!(await detail.locator('[data-test="detail-remark-proposed"]').innerText()).includes('Written before the sync')) throw new Error('A sync must not change the remark')
  if (!(await detail.locator('[data-test="detail-sheet-anomalies"]').innerText()).includes('Epic reads Done')) throw new Error('A sync must not change the sheet anomalies')
  await page.screenshot({ path: join(OUT, '02o-sync-detail.png') })

  // One initiative from its panel: nothing new in Jira, so nothing changes.
  await page.locator('[data-test="detail-sync"]').click() // the footer is outside the panel body
  await result.waitFor()
  if (!(await said('sync-unchanged')).startsWith('1 ')) throw new Error('Syncing a single, current initiative should report 1 unchanged')
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await result.waitFor({ state: 'detached' })

  // A member sees no sync buttons.
  const viewer = await AuthService.upsertUser({ subject: 'e2e-sync-viewer', email: 'e2e-sync-viewer@mekari.com', name: 'E2E Sync Viewer' })
  const viewerSession = await AuthService.createSession(viewer.id)
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await viewerContext.addCookies([{ name: 'od_session', value: viewerSession.token, url: APP }])
    const vp = await viewerContext.newPage()
    await vp.goto(`${APP}/timelines?tab=grid`)
    await vp.locator('select[data-test="period-select"], [data-test="period-select"] select').first().selectOption(`${YEAR}-4`)
    await vp.locator('[data-test="view-grid"] [data-test="open-initiative"]', { hasText: 'Sheet title one' }).click()
    await vp.locator('[data-test="initiative-detail"]').waitFor()
    if ((await vp.locator('[data-test="sync-quarter"]').count()) !== 0 || (await vp.locator('[data-test="detail-sync"]').count()) !== 0) throw new Error('A member must not see the sync buttons')
    const denied = await vp.evaluate(async (y) => (await fetch('/api/initiatives/sync', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: y, quarter: 4 }) })).status, YEAR)
    if (denied !== 403) throw new Error(`The sync endpoint should refuse a member, got ${denied}`)
  } finally {
    await viewerContext.close()
    const { db: appDb } = await import('../apps/server/src/db/client')
    const { users: usersTable } = await import('../apps/server/src/db/schema')
    const { eq: eqOp } = await import('drizzle-orm')
    await appDb.delete(usersTable).where(eqOp(usersTable.id, viewer.id))
  }
  await clean()
})

await step('Users page: make someone admin, see it apply, remove it again', async () => {
  const db = postgres(DB_URL, { max: 1 })
  const email = `e2e-member-${Math.random().toString(36).slice(2, 8)}@test.local`
  await db`insert into users (email, name) values (${email}, 'E2E Member')`
  try {
    await page.goto(`${APP}/timelines`)
    await page.getByRole('link', { name: 'Users', exact: true }).click()
    await page.waitForURL('**/admin/users')
    await page.getByPlaceholder('Search by name or email').fill('E2E Member')
    await page.getByRole('button', { name: 'Search' }).click()
    const row = page.locator(`[data-row][data-email="${email}"]`)
    await row.waitFor()
    if ((await row.locator('[data-test="badge-admin"]').count()) !== 0) throw new Error('A new account should start as a member')
    await shot('02j-users')

    await row.locator('[data-test="make-admin"]').click()
    await text(page, 'Make this person an admin?')
    await page.locator('[data-test="confirm-admin"]').click()
    await row.locator('[data-test="badge-admin"]').waitFor()
    if ((await page.locator('[data-test="env-fallback"]').count()) !== 0) throw new Error('The ADMIN_EMAILS notice should be gone after the first grant')
    const me = await page.evaluate(async () => (await fetch('/api/users', { credentials: 'include' })).status)
    if (me !== 200) throw new Error(`The signed-in admin lost access after granting someone else: ${me}`)

    // You cannot remove yourself: your own row has no remove button.
    await page.getByPlaceholder('Search by name or email').fill(EMAIL)
    await page.getByRole('button', { name: 'Search' }).click()
    const mine = page.locator(`[data-row][data-email="${EMAIL}"]`)
    await mine.waitFor()
    if ((await mine.locator('[data-test="remove-admin"]').count()) !== 0) throw new Error('Your own row must not offer Remove admin')
    await text(page, '(you)')

    await page.getByPlaceholder('Search by name or email').fill('E2E Member')
    await page.getByRole('button', { name: 'Search' }).click()
    await row.waitFor()
    await row.locator('[data-test="remove-admin"]').click()
    await text(page, 'Remove admin access?')
    await page.locator('[data-test="confirm-admin"]').click()
    await row.locator('[data-test="make-admin"]').waitFor()
    if ((await row.locator('[data-test="badge-admin"]').count()) !== 0) throw new Error('The account should be a member again')
  } finally {
    await db`delete from users where email = ${email}`
    await db.end()
  }
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

await step('delete a PGP from the list and from its detail page', async () => {
  const make = async (period: string) => {
    const t = await api('POST', '/api/pgp/templates', { title: `Delete ${period} ${Date.now()}`, period, items: [{ objective: 'O', keyResult: 'K', weight: 100, initiative: `Delete me ${period}` }] })
    await api('PATCH', `/api/pgp/templates/${t.id}`, { status: 'published' })
    return { t, p: await api('POST', '/api/pgp/plans', { templateId: t.id }) }
  }
  const status = async (id: string) => (await page.request.fetch(`${APP}/api/pgp/plans/${id}`)).status()
  const a = await make('2024-Q1')
  const b = await make('2024-Q2')
  await api('POST', `/api/pgp/plans/${b.p.id}/submit`)

  // From the list: Cancel keeps the plan, Delete removes it and the row disappears.
  await page.goto(`${APP}/pgp`)
  const row = page.locator(`a[href="/pgp/plans/${a.p.id}"]`).locator('xpath=..')
  await row.locator('[data-test="delete-row"]').click()
  await text(page, 'Delete this PGP?')
  if (await page.locator('[data-test="delete-submitted-warning"]').count()) throw new Error('a draft plan must not show the submitted warning')
  await page.getByRole('button', { name: 'Cancel' }).click()
  if ((await status(a.p.id)) !== 200) throw new Error('Cancel deleted the plan')
  await row.locator('[data-test="delete-row"]').click()
  await page.locator('[data-test="confirm-delete"]').click()
  await page.waitForFunction((id) => !document.querySelector(`a[href="/pgp/plans/${id}"]`), a.p.id, { timeout: 10_000 })
  if ((await status(a.p.id)) !== 404) throw new Error('the plan still exists after Delete')

  // From the detail page of a submitted plan: extra warning, then back to the list.
  await page.goto(`${APP}/pgp/plans/${b.p.id}`)
  await page.locator('[data-test="delete-plan"]').click()
  await page.locator('[data-test="delete-submitted-warning"]').waitFor()
  await shot('11-delete-dialog')
  await page.locator('[data-test="confirm-delete"]').click()
  await page.waitForURL(/\/pgp$/)
  if ((await status(b.p.id)) !== 404) throw new Error('the submitted plan still exists after Delete')

  // The quarter is free again.
  const again = await api('POST', '/api/pgp/plans', { templateId: a.t.id })
  if (!again?.id) throw new Error('could not create the plan again after deleting it')
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    await page.goto(`${APP}/pgp`)
    await page.locator('[data-test="delete-row"]').first().waitFor()
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length }))
    if (m.page > 1 || m.wide > 0) throw new Error(`My PGP list overflows at ${width}px (page +${m.page}px, ${m.wide} elements past the edge)`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(200)
  await shot('11b-pgp-list-delete')
})

await step('no JS errors collected', async () => {
  if (jsErrors.length) throw new Error(`${jsErrors.length} error(s): ${jsErrors.slice(0, 3).join(' | ')}`)
})

await browser.close()
stop()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Screenshots: ${OUT}`)
process.exit(failed.length ? 1 : 0)
