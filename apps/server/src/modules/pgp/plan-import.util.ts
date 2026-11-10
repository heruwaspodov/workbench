/** Pure helpers for importing a growth-plan workbook (no database access). */
export type Status = 'not_started' | 'on_track' | 'at_risk' | 'done' | 'not_achieved'

/** Sheet status text ("Done", "On Track", ...) → enum; unknown text is left unset. */
export function normalizeStatus(raw: string | null): Status | null {
  const s = (raw ?? '').toLowerCase().replace(/[_-]/g, ' ').trim()
  if (!s) return null
  if (/not\s*achieved/.test(s)) return 'not_achieved'
  if (/not\s*started|todo|to do/.test(s)) return 'not_started'
  if (/at\s*risk/.test(s)) return 'at_risk'
  if (/on\s*track|in\s*progress/.test(s)) return 'on_track'
  if (/done|achieved|complete/.test(s)) return 'done'
  return null
}

/** "Q3 - 2026", "Q4 - 26", "Q3-2026" → quarter and year; the sheet's own Period cell ("Q3") backs up the quarter. */
export function periodFromTab(tab: string, metaPeriod?: string) {
  const q = tab.match(/Q\s*([1-4])/i)?.[1] ?? metaPeriod?.match(/Q\s*([1-4])/i)?.[1]
  if (!q) return null
  const long = tab.match(/(20\d{2})/)?.[1]
  const short = tab.match(/[-–]\s*(\d{2})\b/)?.[1]
  const year = long ? Number(long) : short ? 2000 + Number(short) : new Date().getFullYear()
  return { year, quarter: Number(q) }
}
