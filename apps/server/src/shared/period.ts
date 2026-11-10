/** A PGP period is a calendar quarter written "YYYY-Qn". */
export const PERIOD_PATTERN = '^20\\d{2}-Q[1-4]$'
const re = new RegExp(PERIOD_PATTERN)

export const parsePeriod = (period: string) => {
  if (!re.test(period)) return null
  return { year: Number(period.slice(0, 4)), quarter: Number(period.slice(6)) }
}
export const formatPeriod = (year: number, quarter: number) => `${year}-Q${quarter}`
