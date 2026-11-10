import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import ExcelJS from 'exceljs'
import { like } from 'drizzle-orm'
import { PeriodExistsError } from '../src/shared/errors'
import { normalizeStatus, periodFromTab } from '../src/modules/pgp/plan-import.util'
import { parsePgpSheet } from '../src/modules/pgp/sheet-parser'
import { setupTestDb } from './db'

const tag = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const HEAD = ['Company OKR / Leader\'s OKR', 'Objective', 'Key Results', 'Weightage', 'Initiatives', 'Start Value\n(baseline)', 'Target Value', 'Current Value', '% Achievement', 'Status', 'Hyperlink to key results', 'PIC']

/** Synthetic workbook shaped like the management growth plan: an empty "Q4 - 26" tab and a filled "Q3 - 2026" tab. */
async function workbook() {
  const wb = new ExcelJS.Workbook()
  const sheet = (name: string, period: string) => {
    const ws = wb.addWorksheet(name)
    ws.addRow(['Division Name', 'Your Name', 'SBU (Scope Product)', 'SBU (Detail)', 'Direct Leader', 'Period'])
    ws.addRow(['Engineering', 'Test Person', 'PRODUCT', '', 'Test Leader', period])
    ws.addRow([])
    ws.addRow(['Fillout during planning'])
    ws.addRow(HEAD)
    ws.addRow(HEAD)
    ws.addRow(['Example:', 'Example: x', 'Example: y', 'Example: 80%', 'Example: z'])
    return ws
  }
  const q4 = sheet('Q4 - 26', 'Q4')
  q4.addRow(['', 'Reliability', 'Handle incidents', 0.5, 'Acknowledge fast'])
  q4.addRow(['', '', '', 0.5, 'Resolve fast'])

  const q3 = sheet('Q3 - 2026', 'Q3')
  q3.addRow(['', 'Delivery', 'Ship stories', 0.2, 'Average 40 story points', '', '', 'AVG 44', 0.2, 'Done'])
  q3.getRow(8).getCell(11).value = { text: 'July 2026 (162 SP)', hyperlink: 'https://jira.example.test/issues?jql=a' }
  q3.addRow(['', '', '', 0.3, 'Write two RFCs', '', '', '2 RFCs', 0.1, 'On Track', 'see https://wiki.example.test/rfc-1 and javascript:alert(1)'])
  q3.addRow(['', 'Quality', 'No regressions', 0.5, 'Zero P0 bugs', '', '', '', null, ''])
  q3.mergeCells('B8:B9') // Delivery objective merged over two rows, as in the real sheet
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], 'plan.xlsx')
}

describe('helpers', () => {
  test('periodFromTab reads long and short years and falls back to the sheet period', () => {
    expect(periodFromTab('Q3 - 2026')).toEqual({ year: 2026, quarter: 3 })
    expect(periodFromTab('Q4 - 26')).toEqual({ year: 2026, quarter: 4 })
    expect(periodFromTab('Sheet1', 'Q2')?.quarter).toBe(2)
    expect(periodFromTab('Sheet1')).toBeNull()
  })
  test('normalizeStatus', () => {
    expect([normalizeStatus('Done'), normalizeStatus('On Track'), normalizeStatus('At Risk'), normalizeStatus('Not Achieved'), normalizeStatus('???'), normalizeStatus('')])
      .toEqual(['done', 'on_track', 'at_risk', 'not_achieved', null, null])
  })
  test('parser keeps only http(s) evidence links, from text and from hyperlink targets', () => {
    const rows = [HEAD, ['', 'O', 'KR', '10%', 'I', '', '', '', '', '', 'see https://a.test/x, and ftp://b.test'], ['', '', '', '10%', 'J', '', '', '', '', '', 'label']]
    const links = [[], [], ['', '', '', '', '', '', '', '', '', '', 'javascript:alert(1)'], []].slice(0, 3)
    links[2] = Array(12).fill('')
    links[2]![10] = 'https://c.test/y'
    const p = parsePgpSheet(rows, links)
    expect(p.items.map((i) => i.evidenceLinks)).toEqual([['https://a.test/x'], ['https://c.test/y']])
  })
})

describe('PlanImportService', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Imp: typeof import('../src/modules/pgp/plan-import.service').PlanImportService
  let seq = 0

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Imp = (await import('../src/modules/pgp/plan-import.service')).PlanImportService
  })
  afterAll(async () => { await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`)) })
  const user = async () => (await ctx.db.insert(S.users).values({ email: `${tag}-${++seq}@test.local`, name: `${tag} u${seq}` }).returning())[0]!

  test('default tab is the newest filled-in one, not the newest empty template', async () => {
    const p = await Imp.preview(await workbook())
    expect(p.tabs).toEqual(['Q4 - 26', 'Q3 - 2026'])
    expect(p.selectedTab).toBe('Q3 - 2026')
    expect(p.suggestedPeriod).toEqual({ year: 2026, quarter: 3 })
    expect(p.meta).toMatchObject({ division: 'Engineering', sbu: 'PRODUCT', directLeader: 'Test Leader' })
    expect(p.hasProgress).toBe(true)
    expect(p.hasEvidence).toBe(true)
  })

  test('items carry weights, progress, normalized status and evidence', async () => {
    const p = await Imp.preview(await workbook(), 'Q3 - 2026')
    expect(p.items).toHaveLength(3)
    expect(p.items[0]).toMatchObject({ objective: 'Delivery', weight: 20, currentValue: 'AVG 44', achievement: 20, status: 'done', evidenceLinks: ['https://jira.example.test/issues?jql=a'] })
    expect(p.items[1]).toMatchObject({ weight: 30, status: 'on_track', evidenceLinks: ['https://wiki.example.test/rfc-1'] })
    expect(p.items[2]).toMatchObject({ objective: 'Quality', keyResult: 'No regressions', status: null, evidenceLinks: [] })
    expect(p.totalWeight).toBe(100)
    expect((await Imp.preview(await workbook(), 'Q4 - 26')).hasProgress).toBe(false)
  })

  test('a file that is not an xlsx is rejected with a clear message', async () => {
    await expect(Imp.preview(new File(['nope'], 'x.xlsx'))).rejects.toThrow(/not a readable/)
  })

  test('create stores the reviewed items, keeps only http(s) evidence, and blocks the same quarter', async () => {
    const u = await user()
    const p = await Imp.preview(await workbook(), 'Q3 - 2026')
    const input = {
      year: 2026, quarter: 3, sourceRef: p.sourceRef, division: p.meta.division, sbu: p.meta.sbu, directLeader: p.meta.directLeader,
      items: p.items.map((i) => ({ ...i, status: i.status ?? undefined, evidenceLinks: [...i.evidenceLinks, 'javascript:alert(1)'] })),
    }
    const plan = await Imp.create(u, input)
    expect([plan.period, plan.template, plan.title, plan.sourceRef, plan.division]).toEqual(['2026-Q3', null, 'PGP 2026-Q3', 'plan.xlsx#Q3 - 2026', 'Engineering'])
    expect(plan.items).toHaveLength(3)
    expect(plan.items[0]!.evidenceLinks).toEqual(['https://jira.example.test/issues?jql=a'])
    expect(plan.items[2]!.status).toBe('not_started')
    const err = await Imp.create(u, input).catch((e) => e)
    expect(err).toBeInstanceOf(PeriodExistsError)
    expect(err.existingPlanId).toBe(plan.id)
  })

  test('achievement above weight is rejected and nothing is saved', async () => {
    const u = await user()
    const bad = { year: 2025, quarter: 1, items: [{ objective: 'O', keyResult: 'K', weight: 10, initiative: 'I', achievement: 20 }] }
    await expect(Imp.create(u, bad)).rejects.toThrow(/cannot exceed/)
    expect(await ctx.db.query.plans.findFirst({ where: (p, { eq }) => eq(p.userId, u.id) })).toBeUndefined()
  })
})
