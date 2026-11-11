import { describe, expect, test } from 'bun:test'
import { calendarMinutes, parseTarget } from '../src/shared/sla-time'

// Fixtures reproduce two real Time to SLA panels (instants in Asia/Jakarta, UTC+7).
const at = (s: string) => Date.parse(`${s}+07:00`)

describe('SLA durations', () => {
  test('a day is 9 working hours on the weekdays calendar and 24 hours otherwise', () => {
    expect(parseTarget('8h', 'weekdays')).toBe(480)
    expect(parseTarget('1d12h', 'weekdays')).toBe(21 * 60)
    expect(parseTarget('2d', 'weekdays')).toBe(18 * 60)
    expect(parseTarget('5d', 'weekdays')).toBe(45 * 60)
    expect(parseTarget('3d', 'always')).toBe(72 * 60)
    expect(parseTarget('2d 5h 30m', 'always')).toBe((48 + 5) * 60 + 30)
  })
  test('rejects what is not a duration', () => {
    for (const bad of ['', 'abc', '5', '2x', '1d 2', 'd']) expect(parseTarget(bad, 'weekdays')).toBeNull()
  })
})

describe('calendar minutes', () => {
  test('MESIGN-24252: Wed 14:57 to Fri 17:29 is 2 working days and 2h32m (panel: elapsed 2d 2h 32m, 45% of 5d)', () => {
    const m = calendarMinutes(at('2026-11-04T14:57:00'), at('2026-11-06T17:29:14'), 'weekdays')
    expect(m).toBeCloseTo(2 * 9 * 60 + 2 * 60 + 32 + 14 / 60, 1)
    expect(m / (45 * 60)).toBeGreaterThan(0.45)
    expect(m / (45 * 60)).toBeLessThan(0.46)
  })
  test('MESIGN-24497: a ticket created after hours starts counting at the next opening (panel: 18:23, 16 working hours in)', () => {
    expect(calendarMinutes(at('2026-11-10T18:23:00'), at('2026-11-11T09:00:00'), 'weekdays')).toBe(0)
    expect(calendarMinutes(at('2026-11-10T18:23:00'), at('2026-11-11T16:27:08'), 'weekdays')).toBeCloseTo(7 * 60 + 27 + 8 / 60, 1)
  })
  test('weekends and nights do not count; the always calendar counts everything', () => {
    // Fri 17:00 to Mon 10:00: 1h Friday + 1h Monday
    expect(calendarMinutes(at('2026-11-06T17:00:00'), at('2026-11-09T10:00:00'), 'weekdays')).toBe(120)
    expect(calendarMinutes(at('2026-11-06T17:00:00'), at('2026-11-09T10:00:00'), 'always')).toBe(65 * 60)
  })
  test('the 5-day goal ends exactly one week later at the same time (panel: deadline Wed 11/Nov 14:57)', () => {
    expect(calendarMinutes(at('2026-11-04T14:57:00'), at('2026-11-11T14:57:00'), 'weekdays')).toBeCloseTo(45 * 60, 5)
  })
  test('an end before the start is zero', () => {
    expect(calendarMinutes(at('2026-11-05T10:00:00'), at('2026-11-05T09:00:00'), 'weekdays')).toBe(0)
  })
})
