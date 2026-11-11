/**
 * Time arithmetic for SLA goals, matching the Time to SLA app: the "weekdays" calendar counts only
 * Monday to Friday 09:00-18:00 (Asia/Jakarta, 9 working hours per day, no holidays), and a "d" in a duration is one
 * working day there (24 h on the "always" calendar). Checked against two real panels (see PLAN.md, OD-84).
 */
export type SlaCalendar = 'weekdays' | 'always'

export const WORK = { startHour: 9, endHour: 18, utcOffsetHours: 7 } as const
const HOUR = 3_600_000
const DAY = 24 * HOUR
const workdayHours = WORK.endHour - WORK.startHour

/** "1d12h", "8h", "2d 3h 30m" -> minutes on the given calendar; null when it is not a duration. */
export function parseTarget(text: string, calendar: SlaCalendar): number | null {
  const m = /^\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*$/i.exec(text)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  const dayMinutes = (calendar === 'weekdays' ? workdayHours : 24) * 60
  return Number(m[1] ?? 0) * dayMinutes + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/** Minutes of the calendar that fall between two instants (epoch ms). */
export function calendarMinutes(startMs: number, endMs: number, calendar: SlaCalendar): number {
  if (endMs <= startMs) return 0
  if (calendar === 'always') return (endMs - startMs) / 60_000
  const offset = WORK.utcOffsetHours * HOUR
  let total = 0
  for (let day = Math.floor((startMs + offset) / DAY); day * DAY - offset < endMs; day++) {
    const dow = new Date(day * DAY).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const open = day * DAY - offset + WORK.startHour * HOUR
    const close = day * DAY - offset + WORK.endHour * HOUR
    total += Math.max(0, Math.min(endMs, close) - Math.max(startMs, open))
  }
  return total / 60_000
}
