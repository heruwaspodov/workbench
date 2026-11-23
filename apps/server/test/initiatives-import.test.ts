import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import ExcelJS from 'exceljs'
import { eq, like } from 'drizzle-orm'
import { isInitiativeSheet, parseInitiativeSheet, periodFromText, yearForMonth } from '../src/modules/initiatives/sheet-parser'
import { setupTestDb } from './db'

// Synthetic workbook shaped like the planning sheet: a README tab, then the initiatives tab with a month row,
// a header row of 32 columns (week columns reach AF), data rows, a blank row, a bad key and a duplicate.
const YEAR = 2099 // reserved for this file so it never meets real rows in a shared test database
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const HEAD = [
  'Squad', 'Jira Key', 'Initiative', 'Criticality', 'Note Status', 'Est. Delivery Date', 'Actual Delivery Date', 'PRD', 'RFC',
  'Jira Epic Status', 'Project Status', 'Jira Owner Assigned', 'Jira Progress (Done/Total)', 'Jira Progress %', 'Key Info / Remark',
  'Key Info / Remark (Proposed)', 'Needs Review', 'Anomalies / To Resolve', 'Resolution Status', 'Repo Note',
  'W1\n5-9 Oct', 'W2\n12-16 Oct', 'W3\n19-23 Oct', 'W4\n26-30 Oct', 'W1\n2-6 Nov', 'W2\n9-13 Nov', 'W3\n16-20 Nov', 'W4\n23-27 Nov',
  'W1\n30 Nov - 4 Dec', 'W2\n7-11 Dec', 'W3\n14-18 Dec', 'W4\n21-25 Dec',
]
const WEEK = Object.fromEntries(HEAD.map((h, i) => [h.replace('\n', ' '), i]))

function row(o: Record<string, string>, weeks: Record<string, string> = {}) {
  const cells = HEAD.map((h) => o[h] ?? '')
  for (const [w, text] of Object.entries(weeks)) cells[WEEK[w]!] = text
  return cells
}

async function workbook(mutate?: (ws: ExcelJS.Worksheet) => void, name = '26Q4.xlsx') {
  const wb = new ExcelJS.Workbook()
  const readme = wb.addWorksheet('26Q4 Initiatives README')
  readme.addRow(['Item', 'Description'])
  readme.addRow(['Scope', 'Synthetic'])
  const ws = wb.addWorksheet('26Q4 Initiatives')
  const months = new Array(32).fill('')
  months[20] = 'Oct 2026'; months[24] = 'Nov 2026'; months[28] = 'Dec 2026'
  ws.addRow(months)
  ws.addRow(HEAD)
  ws.addRow(row({
    Squad: 'Escape', 'Jira Key': 'MESIGN-90001', Initiative: 'Synthetic editor', Criticality: 'Strategic', 'Note Status': 'draft',
    'Est. Delivery Date': '2026-10-16', 'Actual Delivery Date': '2026-10-19', PRD: 'PRD', 'Jira Epic Status': 'Done', 'Project Status': 'Done',
    'Jira Owner Assigned': 'Synthetic Owner One', 'Jira Progress (Done/Total)': '58/58', 'Jira Progress %': '100%',
    'Anomalies / To Resolve': '1) Epic reads Done but 2 child item(s) are still open.', 'Resolution Status': 'Open', 'Repo Note': 'repo/path.md',
  }, { 'W3 19-23 Oct': 'Release\n19 Oct' }))
  ws.getRow(3).getCell(8).value = { text: 'PRD', hyperlink: 'https://docs.example.test/prd-1' }
  ws.addRow(row({
    Squad: 'Intact', 'Jira Key': 'mesign-90002', Initiative: 'Synthetic stamp', Criticality: 'Strategic', 'Est. Delivery Date': '2026-11-30',
    'Jira Epic Status': 'In Progress', 'Project Status': 'In Testing', 'Jira Owner Assigned': 'Synthetic Owner Two',
    'Jira Progress (Done/Total)': "'108/152", 'Key Info / Remark (Proposed)': 'Tail is in QA.', 'Needs Review': 'Yes', RFC: 'javascript:alert(1)',
  }, { 'W3 16-20 Nov': 'Self Test', 'W1 30 Nov - 4 Dec': 'Release\n30 Nov', 'W4 21-25 Dec': 'runs on\n7 Jan' }))
  ws.addRow(row({ Squad: 'Utmost', 'Jira Key': 'MESIGN-90003', Initiative: 'Synthetic backlog item', 'Jira Epic Status': 'To Do', 'Key Info / Remark': 'TPM wrote this' }))
  ws.addRow([])
  ws.addRow(row({ 'Jira Key': 'not-a-key', Initiative: 'Bad row' }))
  ws.addRow(row({ Squad: 'Escape', 'Jira Key': 'MESIGN-90001', Initiative: 'Duplicate of the first row' }))
  mutate?.(ws)
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], name)
}

describe('sheet parser', () => {
  let rows: string[][]
  let links: string[][]
  beforeAll(async () => {
    const ExcelService = (await import('../src/modules/pgp/excel.service')).ExcelService
    const book = await ExcelService.readWorkbookWithLinks(await (await workbook()).arrayBuffer(), { maxRows: 1000, maxCols: 60 })
    rows = book.get('26Q4 Initiatives')!.rows
    links = book.get('26Q4 Initiatives')!.links
  })

  test('finds the header by its labels; the sheet-owned columns are kept as written and Note Status is ignored', () => {
    expect(isInitiativeSheet(rows)).toBe(true)
    expect(isInitiativeSheet([['Item', 'Description'], ['Scope', 'x']])).toBe(false)
    const { items } = parseInitiativeSheet(rows, links)
    expect(items.map((i) => i.jiraKey)).toEqual(['MESIGN-90001', 'MESIGN-90002', 'MESIGN-90003'])
    expect(items[0]).toMatchObject({
      sheetAnomalies: '1) Epic reads Done but 2 child item(s) are still open.', sheetResolution: 'Open', repoNote: 'repo/path.md',
    })
    expect(items[1]).toMatchObject({ sheetAnomalies: null, sheetResolution: null, repoNote: null }) // empty cells
    expect(JSON.stringify(items)).not.toContain('"draft"') // Note Status is not imported
  })

  test('maps fields, progress, links and flags', () => {
    const [a, b, c] = parseInitiativeSheet(rows, links).items
    expect(a).toMatchObject({
      squad: 'Escape', title: 'Synthetic editor', criticality: 'Strategic', epicStatus: 'Done', projectStatus: 'Done', ownerName: 'Synthetic Owner One',
      estDeliveryDate: '2026-10-16', actualDeliveryDate: '2026-10-19', doneItems: 58, totalItems: 58, prdUrl: 'https://docs.example.test/prd-1', needsReview: false,
    })
    expect(b).toMatchObject({ jiraKey: 'MESIGN-90002', doneItems: 108, totalItems: 152, remarkProposed: 'Tail is in QA.', needsReview: true, projectStatus: 'In Testing' })
    expect(b!.rfcUrl).toBeNull() // only http(s) links are kept
    expect(c).toMatchObject({ epicStatus: 'To Do', doneItems: null, totalItems: null, remark: 'TPM wrote this', remarkProposed: null, estDeliveryDate: null })
  })

  test('week cells become milestones with month and day; other markers are skipped with one warning', () => {
    const { items, warnings } = parseInitiativeSheet(rows, links)
    expect(items[0]!.milestones).toEqual([{ kind: 'release', month: 10, day: 19, label: 'Release' }])
    // "Self Test" has no date of its own, so it takes the start of its week (16 Nov); the other date is written in the cell.
    expect(items[1]!.milestones).toEqual([
      { kind: 'self_test', month: 11, day: 16, label: 'Self Test' },
      { kind: 'release', month: 11, day: 30, label: 'Release' },
    ])
    expect(warnings.some((w) => w.includes('1 week cell(s)'))).toBe(true)
  })

  test('warns about rows it cannot use', () => {
    const { warnings } = parseInitiativeSheet(rows, links)
    expect(warnings.some((w) => w.includes('"not-a-key" is not a Jira key'))).toBe(true)
    expect(warnings.some((w) => w.includes('MESIGN-90001 appears more than once'))).toBe(true)
  })

  test('bad progress and bad dates are left empty with a warning', () => {
    const grid = [HEAD, [...row({ 'Jira Key': 'MESIGN-90009', Initiative: 'X', 'Jira Progress (Done/Total)': '9/4', 'Est. Delivery Date': '7 Jan' })]]
    const { items, warnings } = parseInitiativeSheet(grid)
    expect(items[0]).toMatchObject({ doneItems: null, totalItems: null, estDeliveryDate: null })
    expect(warnings.some((w) => w.includes('more done than total'))).toBe(true)
    expect(warnings.some((w) => w.includes('not a YYYY-MM-DD date'))).toBe(true)
  })

  test('progress that Sheets turned into a date is read back as Done/Total, and checked against the percentage', () => {
    const line = (key: string, progress: string, pct?: string) => row({ 'Jira Key': key, Initiative: key, 'Jira Progress (Done/Total)': progress, 'Jira Progress %': pct ?? '' })
    const grid = [HEAD,
      line('MESIGN-90101', '2026-05-05', '100%'), // 5/5
      line('MESIGN-90102', '2026-07-11', '64%'), // 7/11 = 63.6%
      line('MESIGN-90103', '2026-01-08', '13%'), // 1/8 = 12.5%
      line('MESIGN-90104', '2026-10-13', '50%'), // 10/13 = 77%: the percentage disagrees, so it is not trusted
      line('MESIGN-90105', '2026-09-09'), // no percentage to check against: accepted
      line('MESIGN-90106', '2026-12-03', '100%'), // 12/3: more done than total, cannot be Done/Total
      line('MESIGN-90107', "'25/25", '100%'), // real text stays as it is
    ]
    const { items, warnings } = parseInitiativeSheet(grid)
    const by = Object.fromEntries(items.map((i) => [i.jiraKey, [i.doneItems, i.totalItems]]))
    expect(by['MESIGN-90101']).toEqual([5, 5])
    expect(by['MESIGN-90102']).toEqual([7, 11])
    expect(by['MESIGN-90103']).toEqual([1, 8])
    expect(by['MESIGN-90104']).toEqual([null, null])
    expect(by['MESIGN-90105']).toEqual([9, 9])
    expect(by['MESIGN-90106']).toEqual([null, null])
    expect(by['MESIGN-90107']).toEqual([25, 25])
    expect(warnings.filter((w) => w.includes('does not match'))).toHaveLength(1)
    expect(warnings.some((w) => w.includes('MESIGN-90106') && w.includes('more done than total'))).toBe(true)
    expect(warnings.some((w) => w.startsWith('4 progress cell(s) were dates'))).toBe(true)
  })

  test('column order does not matter', () => {
    const reversed = [[...HEAD].reverse(), ...[row({ 'Jira Key': 'MESIGN-90010', Initiative: 'Reordered', Squad: 'Escape' })].map((r) => [...r].reverse())]
    const { items } = parseInitiativeSheet(reversed)
    expect(items[0]).toMatchObject({ jiraKey: 'MESIGN-90010', title: 'Reordered', squad: 'Escape' })
  })

  test('owner email: the email column first, else a Jira Owner cell that is an address; a name gives none', () => {
    const head = ['Jira Key', 'Initiative', 'Jira Owner Assigned', 'Jira Owner Assigned Email']
    const grid = (...rows: string[][]) => parseInitiativeSheet([head, ...rows])
    const { items, warnings } = grid(
      ['MESIGN-90101', 'A', 'Synthetic One', 'Synthetic.One@Example.test'], // email column wins, stored lowercase
      ['MESIGN-90102', 'B', 'synthetic.two@example.test', ''], // no email column value: the owner cell is itself an address
      ['MESIGN-90103', 'C', 'Synthetic Three', ''], // a plain name gives none
      ['MESIGN-90104', 'D', 'synthetic.four@example.test', 'Synthetic Four'], // an unusable email cell falls back to the owner cell
    )
    expect(items.map((i) => i.ownerEmail)).toEqual(['synthetic.one@example.test', 'synthetic.two@example.test', null, 'synthetic.four@example.test'])
    // The email header is not read as the owner name, and the name column keeps its text.
    expect(items[0]!.ownerName).toBe('Synthetic One')
    expect(items[2]!.ownerName).toBe('Synthetic Three')
    // The warning counts the unusable cell and never prints it.
    expect(warnings.join(' ')).toContain('1 owner email cell(s)')
    expect(warnings.join(' ')).not.toContain('Synthetic Four')
  })

  test('owner email: a sheet with only the Jira Owner column keeps working, and one without any email column gives none', () => {
    const only = parseInitiativeSheet([['Jira Key', 'Initiative', 'Jira Owner'], ['MESIGN-90105', 'A', 'Synthetic Five'], ['MESIGN-90106', 'B', 'synthetic.six@example.test']])
    expect(only.items.map((i) => [i.ownerName, i.ownerEmail])).toEqual([['Synthetic Five', null], ['synthetic.six@example.test', 'synthetic.six@example.test']])
    // Column order: the email column before the owner column is still the email column.
    const swapped = parseInitiativeSheet([['Jira Key', 'Initiative', 'Jira Owner Assigned Email', 'Jira Owner Assigned'], ['MESIGN-90107', 'A', 'synthetic.seven@example.test', 'Synthetic Seven']])
    expect(swapped.items[0]).toMatchObject({ ownerName: 'Synthetic Seven', ownerEmail: 'synthetic.seven@example.test' })
  })

  test('a grid without the headers is rejected', () => {
    expect(() => parseInitiativeSheet([['Item', 'Description']])).toThrow('Jira Key')
  })

  test('period is read from text and never guessed', () => {
    expect(periodFromText('26Q4 Initiatives')).toEqual({ year: 2026, quarter: 4 })
    expect(periodFromText('Initiatives 2026 Q3')).toEqual({ year: 2026, quarter: 3 })
    expect(periodFromText('Q1-2027')).toEqual({ year: 2027, quarter: 1 })
    expect(periodFromText('Sheet1', 'plan.xlsx')).toBeNull()
    expect(periodFromText('Sheet1', '26Q2-planning.xlsx')).toEqual({ year: 2026, quarter: 2 })
    expect(yearForMonth(2027, 1, 12)).toBe(2026) // Q1 weeks can start in late December
    expect(yearForMonth(2026, 4, 1)).toBe(2027) // Q4 weeks can end in early January
    expect(yearForMonth(2026, 4, 11)).toBe(2026)
  })
})

describe('initiatives upload API', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let adminToken = ''
  let memberToken = ''
  let appOrigin = ''

  const send = async (path: string, token: string | null, init: { method?: string; json?: unknown; form?: FormData } = {}) => {
    const headers: Record<string, string> = { origin: appOrigin }
    if (token) headers.cookie = `od_session=${token}`
    if (init.json !== undefined) headers['content-type'] = 'application/json'
    const res = await handler.handle(new Request(`http://localhost${path}`, {
      method: init.method ?? 'POST', headers, body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
    }))
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }
  const preview = async (file: File, token: string | null, tab?: string) => {
    const form = new FormData()
    form.set('file', file)
    if (tab) form.set('tab', tab)
    return send('/api/initiatives/import/xlsx/preview', token, { form })
  }
  const run = (body: Record<string, unknown>, token: string | null = adminToken) => send('/api/initiatives/import/xlsx', token, { json: { year: YEAR, quarter: 4, ...body } })
  const clear = () => ctx.db.delete(S.initiatives).where(eq(S.initiatives.year, YEAR))
  const listed = async (quarter = 4) => (await send(`/api/initiatives?year=${YEAR}&quarter=${quarter}`, adminToken, { method: 'GET' })).json as {
    jiraKey: string; remark: string | null; remarkProposed: string | null; epicStatus: string; milestones: { kind: string; date: string }[]
  }[]
  let items: Record<string, unknown>[] = []

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    handler = (await import('../src/app')).app
    appOrigin = new URL((await import('../src/config/env')).env.appUrl).origin
    const { AuthService } = await import('../src/modules/auth/service')
    // Admin means a row in user_admin (the users.role column is no longer read). Deleting the user in afterAll removes the row.
    const mk = async (n: string, role: 'admin' | 'member') => {
      const user = (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
      if (role === 'admin') await ctx.db.insert(S.userAdmin).values({ userId: user.id })
      return user
    }
    adminToken = (await AuthService.createSession((await mk('admin', 'admin')).id)).token
    memberToken = (await AuthService.createSession((await mk('member', 'member')).id)).token
    await clear()
  })

  afterAll(async () => {
    await clear()
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('preview is admin only, lists only initiatives tabs and saves nothing', async () => {
    const file = await workbook()
    expect((await preview(file, memberToken)).status).toBe(403)
    expect((await preview(file, null)).status).toBe(401)
    const res = await preview(file, adminToken)
    expect(res.status).toBe(200)
    expect(res.json.tabs).toEqual(['26Q4 Initiatives']) // the README tab is not offered
    expect(res.json.selectedTab).toBe('26Q4 Initiatives')
    expect(res.json.suggestedPeriod).toEqual({ year: 2026, quarter: 4 })
    expect(res.json.sourceRef).toBe('26Q4.xlsx#26Q4 Initiatives')
    expect(res.json.items).toHaveLength(3)
    expect(res.json.items[1].milestones).toHaveLength(2)
    expect(await listed()).toHaveLength(0)
    items = res.json.items
  })

  test('preview rejects files that are not initiatives workbooks', async () => {
    expect((await preview(new File(['not a workbook'], 'x.xlsx'), adminToken)).status).toBe(400)
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Other').addRow(['a', 'b'])
    const noHeaders = new File([new Uint8Array(await wb.xlsx.writeBuffer())], 'other.xlsx')
    const res = await preview(noHeaders, adminToken)
    expect(res.status).toBe(400)
    expect(res.json.message).toContain('Jira Key')
    expect((await preview(await workbook(), adminToken, '26Q4 Initiatives README')).status).toBe(400)
  })

  test('there is no import by URL', async () => {
    for (const path of ['/api/initiatives/import/url', '/api/initiatives/import/sheet/tabs', '/api/initiatives/import/sheet/preview']) {
      expect([404, 405]).toContain((await send(path, adminToken, { method: 'GET' })).status)
      expect([404, 405]).toContain((await send(path, adminToken, { json: { url: 'https://docs.google.com/spreadsheets/d/x' } })).status)
    }
  })

  test('a dry run reports what would happen and saves nothing', async () => {
    const res = await run({ items, dryRun: true })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ dryRun: true, new: 3, changed: 0, unchanged: 0 })
    expect(await listed()).toHaveLength(0)
  })

  test('only admins can save', async () => {
    expect((await run({ items }, memberToken)).status).toBe(403)
    expect((await run({ items }, null)).status).toBe(401)
    expect(await listed()).toHaveLength(0)
  })

  test('saving creates the rows with the chosen year on milestone dates', async () => {
    const res = await run({ items, sourceRef: '26Q4.xlsx#26Q4 Initiatives' })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ dryRun: false, new: 3, changed: 0, unchanged: 0 })
    const rows = await listed()
    expect(rows.map((r) => r.jiraKey)).toEqual(['MESIGN-90001', 'MESIGN-90002', 'MESIGN-90003'])
    expect(rows[0]!.milestones).toMatchObject([{ kind: 'release', date: `${YEAR}-10-19` }])
    expect(rows[1]!.milestones).toMatchObject([{ kind: 'self_test', date: `${YEAR}-11-16` }, { kind: 'release', date: `${YEAR}-11-30` }])
    expect(rows[2]!.remark).toBe('TPM wrote this') // first fill is allowed
    expect(await listed(3)).toHaveLength(0) // another quarter is untouched
  })

  test('importing the same file again changes nothing', async () => {
    const res = await run({ items })
    expect(res.json).toMatchObject({ new: 0, changed: 0, unchanged: 3 })
  })

  test('a changed value updates only that row; a filled remark is never overwritten; missing rows stay', async () => {
    const before = await listed()
    const id = (await ctx.db.select().from(S.initiatives).where(eq(S.initiatives.jiraKey, 'MESIGN-90003')))[0]!.id
    await ctx.db.update(S.initiatives).set({ remark: 'Edited by the TPM in Workbench' }).where(eq(S.initiatives.id, id))

    const edited = items.map((i) => i.jiraKey === 'MESIGN-90003'
      ? { ...i, remark: 'TPM wrote something else', epicStatus: 'In Progress' }
      : i.jiraKey === 'MESIGN-90002' ? { ...i, remarkProposed: 'New proposal' } : i)
    const res = await run({ items: edited.filter((i) => i.jiraKey !== 'MESIGN-90001') }) // 90001 is missing from this file
    expect(res.json).toMatchObject({ new: 0, changed: 2, unchanged: 0 })
    const byKey = Object.fromEntries(res.json.rows.map((r: { jiraKey: string; changes: string[] }) => [r.jiraKey, r.changes]))
    expect(byKey['MESIGN-90003']).toEqual(['epicStatus'])
    expect(byKey['MESIGN-90002']).toEqual(['remarkProposed'])

    const after = await listed()
    expect(after).toHaveLength(before.length) // nothing was deleted
    expect(after.find((r) => r.jiraKey === 'MESIGN-90003')).toMatchObject({ remark: 'Edited by the TPM in Workbench', epicStatus: 'In Progress' })
    expect(after.find((r) => r.jiraKey === 'MESIGN-90002')!.remarkProposed).toBe('New proposal')
  })

  test('the sheet-owned columns are saved, and a different value from a later upload overwrites them and shows as a change', async () => {
    const withSheet = items.map((i) => i.jiraKey === 'MESIGN-90001' ? { ...i, sheetAnomalies: 'Old anomaly', sheetResolution: 'Open', repoNote: 'a/b.md' } : i)
    const first = await run({ items: withSheet.slice(0, 1) })
    expect(first.status).toBe(200)
    const saved = (await listed()).find((r) => r.jiraKey === 'MESIGN-90001') as unknown as { sheetAnomalies: string; sheetResolution: string; repoNote: string }
    expect(saved).toMatchObject({ sheetAnomalies: 'Old anomaly', sheetResolution: 'Open', repoNote: 'a/b.md' })

    const newer = withSheet.map((i) => i.jiraKey === 'MESIGN-90001' ? { ...i, sheetAnomalies: null, sheetResolution: 'Resolved', repoNote: 'a/c.md' } : i)
    const dry = await run({ items: newer.slice(0, 1), dryRun: true })
    expect(dry.json.rows[0].changes.sort()).toEqual(['repoNote', 'sheetAnomalies', 'sheetResolution'])
    await run({ items: newer.slice(0, 1) })
    const after = (await listed()).find((r) => r.jiraKey === 'MESIGN-90001') as unknown as { sheetAnomalies: string | null; sheetResolution: string; repoNote: string }
    expect(after).toMatchObject({ sheetAnomalies: null, sheetResolution: 'Resolved', repoNote: 'a/c.md' })
    expect((await run({ items: newer.slice(0, 1) })).json).toMatchObject({ changed: 0, unchanged: 1 })

    const tooLong = await run({ items: [{ jiraKey: 'MESIGN-90050', title: 'X', sheetResolution: 'x'.repeat(61) }] })
    expect(tooLong.status).toBe(422)
    await run({ items: items.slice(0, 1) }) // put the row back to what the file said, so the next test starts from it
  })

  test('a moved milestone is a change; the first quarter of a year may start in the previous December', async () => {
    const moved = items.map((i) => i.jiraKey === 'MESIGN-90001' ? { ...i, milestones: [{ kind: 'release', month: 10, day: 20, label: 'Release' }] } : i)
    const res = await run({ items: moved.slice(0, 1) })
    expect(res.json.rows[0]).toMatchObject({ jiraKey: 'MESIGN-90001', action: 'changed', changes: ['milestones'] })
    expect((await listed()).find((r) => r.jiraKey === 'MESIGN-90001')!.milestones[0]!.date).toBe(`${YEAR}-10-20`)

    const q1 = await run({ quarter: 1, items: [{ jiraKey: 'MESIGN-90020', title: 'Q1 item', milestones: [{ kind: 'release', month: 12, day: 29 }, { kind: 'release', month: 1, day: 8 }] }] })
    expect(q1.status).toBe(200)
    const dates = (await listed(1))[0]!.milestones.map((m) => m.date).sort()
    expect(dates).toEqual([`${YEAR - 1}-12-29`, `${YEAR}-01-08`])
  })

  test('dates sent back by the browser client (UTC midnight timestamps) are the same dates', async () => {
    const asDates = items.map((i) => ({ ...i, estDeliveryDate: i.estDeliveryDate ? `${i.estDeliveryDate}T00:00:00.000Z` : null }))
    const res = await run({ items: asDates })
    expect(res.status).toBe(200)
    expect(res.json.new).toBe(0)
    // Earlier tests changed other fields of these rows; the dates must not show up as a difference.
    expect(res.json.rows.flatMap((r: { changes: string[] }) => r.changes)).not.toContain('estDeliveryDate')
    expect((await run({ items: [{ jiraKey: 'MESIGN-90040', title: 'X', estDeliveryDate: '2099-11-30T05:00:00Z' }] })).status).toBe(422) // a real time of day is not a date
  })

  test('bad input is rejected with the key in the message', async () => {
    const bad = (o: Record<string, unknown>) => run({ items: [{ jiraKey: 'MESIGN-90030', title: 'X', ...o }] })
    const a = await bad({ doneItems: 9, totalItems: 3 })
    expect(a.status).toBe(400)
    expect(a.json.message).toContain('MESIGN-90030')
    expect((await bad({ prdUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await bad({ milestones: [{ kind: 'release', month: 2, day: 30 }] })).status).toBe(400)
    expect((await run({ items: [{ jiraKey: 'nope', title: 'X' }] })).status).toBe(400)
    expect((await run({ items: [{ jiraKey: 'MESIGN-90031', title: 'X' }, { jiraKey: 'mesign-90031', title: 'Y' }] })).status).toBe(400)
    expect((await run({ items: [] })).status).toBe(422)
    expect((await listed()).some((r) => r.jiraKey === 'MESIGN-90030' || r.jiraKey === 'MESIGN-90031')).toBe(false)
  })
  test('owner email is stored lowercase, never returned, and only fills or replaces; isMine is worked out for the signed-in user', async () => {
    const Q = { quarter: 2 }
    const mine = `${tag}-admin@test.local`
    const list = async (token: string) => send(`/api/initiatives?year=${YEAR}&quarter=2`, token, { method: 'GET' })
    const byKey = (res: { json: { jiraKey: string; isMine: boolean }[] }, key: string) => res.json.find((r) => r.jiraKey === key)!

    const first = await run({ ...Q, items: [
      { jiraKey: 'MESIGN-90701', title: 'Mine', ownerEmail: mine.toUpperCase() },
      { jiraKey: 'MESIGN-90702', title: 'Someone else', ownerEmail: 'synthetic.other@example.test' },
      { jiraKey: 'MESIGN-90703', title: 'No email', ownerEmail: 'not-an-email' },
    ] })
    expect(first.status).toBe(200)
    expect((await ctx.db.select().from(S.initiatives).where(eq(S.initiatives.jiraKey, 'MESIGN-90701')))[0]!.ownerEmail).toBe(mine)
    expect((await ctx.db.select().from(S.initiatives).where(eq(S.initiatives.jiraKey, 'MESIGN-90703')))[0]!.ownerEmail).toBeNull() // unusable: ignored

    const asAdmin = await list(adminToken)
    expect(['MESIGN-90701', 'MESIGN-90702', 'MESIGN-90703'].map((k) => byKey(asAdmin, k).isMine)).toEqual([true, false, false])
    const asMember = await list(memberToken)
    expect(['MESIGN-90701', 'MESIGN-90702', 'MESIGN-90703'].map((k) => byKey(asMember, k).isMine)).toEqual([false, false, false])
    // The address itself is in no response, in any field.
    for (const res of [asAdmin, asMember]) {
      expect(JSON.stringify(res.json)).not.toContain('ownerEmail')
      expect(JSON.stringify(res.json)).not.toContain('@')
    }

    // A sheet without an email never blanks the stored one; a different valid one replaces it and shows as a change.
    const blank = await run({ ...Q, items: [{ jiraKey: 'MESIGN-90701', title: 'Mine', ownerEmail: null }] })
    expect(blank.json).toMatchObject({ changed: 0, unchanged: 1 })
    expect((await ctx.db.select().from(S.initiatives).where(eq(S.initiatives.jiraKey, 'MESIGN-90701')))[0]!.ownerEmail).toBe(mine)
    const dry = await run({ ...Q, dryRun: true, items: [{ jiraKey: 'MESIGN-90701', title: 'Mine', ownerEmail: 'synthetic.new@example.test' }] })
    expect(dry.json.rows[0].changes).toEqual(['ownerEmail'])
    expect(JSON.stringify(dry.json)).not.toContain('synthetic.new')

    // Edits and creates by an admin answer without the address too.
    const id = byKey(asAdmin, 'MESIGN-90701') as unknown as { id: string }
    const patched = await send(`/api/initiatives/${id.id}`, adminToken, { method: 'PATCH', json: { remark: 'x' } })
    expect(patched.status).toBe(200)
    expect(patched.json.isMine).toBe(true)
    expect(JSON.stringify(patched.json)).not.toContain('ownerEmail')
    expect(JSON.stringify(patched.json)).not.toContain('@')
    await ctx.db.delete(S.initiatives).where(eq(S.initiatives.quarter, 2))
  })
})
