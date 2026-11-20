import { describe, expect, test } from 'bun:test'
import { atRisk, currentWeekIndex, dayMonth, quarterWeeks, weekIndexOf } from './weeks'

describe('quarter weeks', () => {
  test('Q4 2026 matches the planning sheet', () => {
    const { weeks, groups } = quarterWeeks(2026, 4)
    expect(weeks).toHaveLength(12)
    expect(weeks[0]).toMatchObject({ start: '2026-10-05', end: '2026-10-09', range: '5-9 Oct', number: 1 })
    expect(weeks[3]!.range).toBe('26-30 Oct')
    expect(weeks[4]!.range).toBe('2-6 Nov')
    expect(weeks[8]).toMatchObject({ start: '2026-11-30', range: '30 Nov - 4 Dec', number: 1 })
    expect(weeks[11]).toMatchObject({ start: '2026-12-21', range: '21-25 Dec', number: 4 })
    expect(groups.map((g) => g.label)).toEqual(['2026-10', '2026-11', '2026-12'])
    expect(groups.map((g) => g.weeks.length)).toEqual([4, 4, 4])
  })

  test('the first week is the first Monday on or after the quarter starts', () => {
    expect(quarterWeeks(2024, 1).weeks[0]!.start).toBe('2024-01-01') // 1 Jan 2024 is a Monday
    expect(quarterWeeks(2024, 4).weeks[0]!.start).toBe('2024-10-07') // Tuesday
    expect(quarterWeeks(2027, 1).weeks[0]!.start).toBe('2027-01-04') // Friday
    expect(quarterWeeks(2026, 2).weeks[0]!.start).toBe('2026-04-06') // Wednesday
    expect(quarterWeeks(2023, 4).weeks[0]!.start).toBe('2023-10-02') // Sunday
  })

  test('a date lands in its week; dates outside the 12 weeks go to the nearest one', () => {
    const { weeks } = quarterWeeks(2026, 4)
    expect(weekIndexOf(weeks, '2026-10-19')).toBe(2)
    expect(weekIndexOf(weeks, '2026-10-17')).toBe(1) // the Saturday of week 2
    expect(weekIndexOf(weeks, '2026-11-30')).toBe(8)
    expect(weekIndexOf(weeks, '2026-10-01')).toBe(0) // before the first Monday
    expect(weekIndexOf(weeks, '2026-12-28')).toBe(11) // after the last Friday
  })

  test('today is highlighted only inside the quarter', () => {
    const { weeks } = quarterWeeks(2026, 4)
    expect(currentWeekIndex(weeks, '2026-11-20')).toBe(6)
    expect(currentWeekIndex(weeks, '2026-10-02')).toBe(-1)
    expect(currentWeekIndex(weeks, '2027-01-05')).toBe(-1)
  })

  test('day and month text', () => {
    expect(dayMonth('2026-11-30')).toBe('30 Nov')
    expect(dayMonth('2026-12-07')).toBe('7 Dec')
  })
})

describe('goal risk', () => {
  const row = (done: number | null, total: number | null, ...marks: [string, string][]) => ({
    doneItems: done, totalItems: total, milestones: marks.map(([kind, date]) => ({ kind, date })),
  })
  test('under 50% done with a release in the next 7 days is at risk', () => {
    expect(atRisk(row(3, 10, ['release', '2026-11-25']), '2026-11-20')).toBe(true)
    expect(atRisk(row(3, 10, ['release', '2026-11-27']), '2026-11-20')).toBe(true) // exactly 7 days out
    expect(atRisk(row(3, 10, ['release', '2026-11-20']), '2026-11-20')).toBe(true) // today
  })
  test('half done, no release soon, or no numbers is not at risk', () => {
    expect(atRisk(row(5, 10, ['release', '2026-11-25']), '2026-11-20')).toBe(false)
    expect(atRisk(row(3, 10, ['release', '2026-11-28']), '2026-11-20')).toBe(false)
    expect(atRisk(row(3, 10, ['release', '2026-11-19']), '2026-11-20')).toBe(false) // already past
    expect(atRisk(row(3, 10, ['self_test', '2026-11-25']), '2026-11-20')).toBe(false) // only releases count
    expect(atRisk(row(null, null, ['release', '2026-11-25']), '2026-11-20')).toBe(false)
    expect(atRisk(row(0, 0, ['release', '2026-11-25']), '2026-11-20')).toBe(false)
  })
})
