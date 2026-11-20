/**
 * The weeks of a quarter for the delivery timeline. A quarter is shown as 12 Monday-to-Friday weeks in three groups of
 * four (one group per month), starting on the first Monday on or after the first day of the quarter. This is the layout
 * of the planning sheet: Q4 2026 runs from 5 Oct to 25 Dec and its December group starts on 30 Nov.
 */
const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface Week {
  /** 0..11 across the quarter. */
  index: number
  /** 1..4 inside its month group. */
  number: number
  /** Monday, YYYY-MM-DD. */
  start: string
  /** Friday, YYYY-MM-DD. */
  end: string
  /** "5-9 Oct" or "30 Nov - 4 Dec". */
  range: string
}
export interface WeekGroup { label: string; weeks: Week[] }

export function quarterWeeks(year: number, quarter: number): { weeks: Week[]; groups: WeekGroup[] } {
  const first = (quarter - 1) * 3
  const startMs = Date.UTC(year, first, 1)
  const dow = new Date(startMs).getUTCDay() // 0 = Sunday
  const monday = startMs + ((8 - dow) % 7) * DAY

  const weeks: Week[] = Array.from({ length: 12 }, (_, i) => {
    const s = new Date(monday + i * 7 * DAY)
    const f = new Date(monday + (i * 7 + 4) * DAY)
    const range = s.getUTCMonth() === f.getUTCMonth()
      ? `${s.getUTCDate()}-${f.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`
      : `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} - ${f.getUTCDate()} ${MONTHS[f.getUTCMonth()]}`
    return { index: i, number: (i % 4) + 1, start: iso(s.getTime()), end: iso(f.getTime()), range }
  })
  const groups = [0, 1, 2].map((g) => ({ label: `${year}-${pad(first + g + 1)}`, weeks: weeks.slice(g * 4, g * 4 + 4) }))
  return { weeks, groups }
}

/** Which week a date falls in. Dates before the first week or after the last one are placed in the nearest week. */
export function weekIndexOf(weeks: Week[], date: string): number {
  const i = Math.floor((utc(date) - utc(weeks[0]!.start)) / (7 * DAY))
  return Math.max(0, Math.min(weeks.length - 1, i))
}

/** The week that contains `today`, or -1 when today is outside the quarter's 12 weeks. */
export function currentWeekIndex(weeks: Week[], today: string): number {
  const t = utc(today)
  const i = Math.floor((t - utc(weeks[0]!.start)) / (7 * DAY))
  return i >= 0 && i < weeks.length ? i : -1
}

/** "30 Nov" for a YYYY-MM-DD date. */
export const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

interface RiskRow { doneItems: number | null; totalItems: number | null; milestones: { kind: string; date: string }[] }

/**
 * "Goal risk" from the dashboard: less than half of the child items done while a release is due within the next
 * 7 days (today included). Rows without progress numbers are not counted, because nothing says they are behind.
 */
export function atRisk(row: RiskRow, today: string): boolean {
  if (!row.totalItems || (row.doneItems ?? 0) / row.totalItems >= 0.5) return false
  const from = utc(today), to = from + 7 * DAY
  return row.milestones.some((m) => m.kind === 'release' && utc(m.date) >= from && utc(m.date) <= to)
}
