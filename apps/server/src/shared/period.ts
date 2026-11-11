/** A PGP period is a calendar quarter written "YYYY-Qn". */
export const PERIOD_PATTERN = '^20\\d{2}-Q[1-4]$'
const re = new RegExp(PERIOD_PATTERN)

export const parsePeriod = (period: string) => {
  if (!re.test(period)) return null
  return { year: Number(period.slice(0, 4)), quarter: Number(period.slice(6)) }
}
export const formatPeriod = (year: number, quarter: number) => `${year}-Q${quarter}`

const pad = (n: number) => String(n).padStart(2, '0')

/** Calendar bounds of a quarter: `from` inclusive, `to` exclusive (first day of the next quarter), and its three months. */
export function quarterRange(year: number, quarter: number) {
  const first = (quarter - 1) * 3 + 1
  const months = [0, 1, 2].map((i) => `${year}-${pad(first + i)}`)
  const to = quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(first + 3)}-01`
  return { from: `${year}-${pad(first)}-01`, to, months }
}

/** `[from, to)` of one "YYYY-MM" month. */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return { from: `${month}-01`, to: m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01` }
}
