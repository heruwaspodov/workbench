const dtf = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const formatDate = (iso?: string | Date | null) => (iso ? dtf.format(new Date(iso)) : '-')

export function timeAgo(iso?: string | Date | null) {
  if (!iso) return '-'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, sec] of steps) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit)
  return 'just now'
}

export const pct = (n?: number | null) => (n == null ? '-' : `${Math.round(n * 100) / 100}%`)

/**
 * "YYYY-MM-DD" of a date column. The API client (Eden) turns date strings into Date objects (UTC midnight),
 * so both shapes arrive here and the day must be read in UTC to stay the same day.
 */
export const isoDay = (v?: string | Date | null) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '')

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
/** "2026-11" → "Nov 2026". */
export const monthLabel = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`))
