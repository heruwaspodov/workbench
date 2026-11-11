import { describe, expect, test } from 'bun:test'
import { parsePercent, parsePgpSheet } from '../src/modules/pgp/sheet-parser'

// Mirrors the "Q4 - 26" tab layout (columns A..J).
const q4: string[][] = [
  ['Division Name', 'Your Name', 'SBU (Scope Product)', 'SBU (Detail)', 'Direct Leader', 'Period'],
  ['Technology Engineering', 'Engineer Name', 'ESIGN', '', 'Leader Name', 'Q4'],
  [],
  ['Fillout during planning session', '', '', '', '', '', '', 'Fillout during monitoring progress'],
  ['Company OKR / Leader\'s OKR', 'Objective', 'Key Results', 'Weightage', 'Initiatives', 'Start Value (baseline)', 'Target Value', 'Current Value', '% Achievement', 'Status'],
  ['Example:\nAchieve Sustainable', 'Example:\nDrive Profitable', 'Example:\nGrow total revenue', 'Example:\n80%', 'Example:\n- Co-develop', 'Example: 20%', 'Example: 35%', 'Example: 19%', 'Example: 54%', ''],
  ['', 'Service Reliability & Operations', 'Incident handling during on-call', '2%', 'Acknowledge at least 80% of PagerDuty incidents within 60s'],
  ['', '', '', '4%', 'Resolve P0 incidents within 30 mins'],
  ['', '', '', '2%', 'Complete the RCA/Postmortem within one business day'],
  ['', 'Service Reliability & Operations', 'Maintain 99.9% SLO', '3%', 'Maintain 99.9% SLO'],
  ['', 'Predictable & High-Quality Delivery', 'End-to-end initiative ownership', '30%', 'Deliver 100% of Q4 E2E PIC initiatives'],
  ['', '', '', '', '- List initiatives here'],
  ['', '', '', '', ''],
  ['', 'Engineering Excellence', 'Tech debt', '59%', 'Identify and deliver at least 3 tech debt', '', '', 'Score', '0%'],
  ['', '', 'Total', '100%'],
  ['Team Members', 'Growth Plan', '2026 Q4 Score'],
  ['Someone', 'Someone Growth Plan'],
]

describe('parsePgpSheet', () => {
  const parsed = parsePgpSheet(q4)

  test('reads meta block', () => {
    expect(parsed.meta).toMatchObject({ division: 'Technology Engineering', sbu: 'ESIGN', period: 'Q4' })
  })

  test('skips example rows and stops at Total', () => {
    expect(parsed.items).toHaveLength(7)
    expect(parsed.items.some((i) => i.initiative.startsWith('Example'))).toBe(false)
  })

  test('carries merged objective / key result forward', () => {
    expect(parsed.items[1]).toMatchObject({
      objective: 'Service Reliability & Operations',
      keyResult: 'Incident handling during on-call',
      weight: 4,
    })
    expect(parsed.items[5]).toMatchObject({ keyResult: 'End-to-end initiative ownership', weight: 0, initiative: '- List initiatives here' })
  })

  test('ignores the "Score" label in current value and sums weight', () => {
    expect(parsed.items[6]!.currentValue).toBeNull()
    expect(parsed.totalWeight).toBe(100)
    expect(parsed.warnings).toEqual([])
  })

  test('throws without header', () => {
    expect(() => parsePgpSheet([['a', 'b']])).toThrow()
  })
})

describe('parsePgpSheet rows that mention header words', () => {
  const head = ['Company OKR', 'Objective', 'Key Results', 'Weightage', 'Initiatives', 'Start Value', 'Target Value', 'Current Value', '% Achievement', 'Status']
  const rows = [
    head,
    head, // the sheet repeats its header line; this one must still be skipped
    ['', 'Delivery', '<10% carry over (each instance deducts 20% of KR achievement)', '2%', 'Keep carry-over under 10%'],
    ['', 'Quality', 'Bugs per sprint. Weight each by status and keep evidence of every achievement', '3%', 'Limit bugs leaking to staging'],
    ['', 'Reliability', 'Current value of the SLO stays above target value', '95%', 'Hold the SLO'],
  ]
  const parsed = parsePgpSheet(rows)

  test('keeps key results whose text contains achievement, weight, status or value', () => {
    expect(parsed.items.map((i) => [i.initiative, i.weight])).toEqual([
      ['Keep carry-over under 10%', 2], ['Limit bugs leaking to staging', 3], ['Hold the SLO', 95],
    ])
    expect(parsed.totalWeight).toBe(100)
    expect(parsed.warnings).toEqual([])
  })

  test('still skips the repeated header line', () => {
    expect(parsed.items.some((i) => i.objective === 'Objective' || i.keyResult === 'Key Results')).toBe(false)
  })
})

describe('parsePercent', () => {
  test.each([
    ['2%', 2], ['12.5%', 12.5], ['0.3', 30], ['30', 30], ['', null], ['abc', null],
  ])('%s → %p', (input, expected) => expect(parsePercent(input)).toBe(expected))
})
