/**
 * Parses the "Initiatives" tab of the quarterly planning workbook (Google Sheets exported as .xlsx) into rows.
 *
 *  - The header row is found by its labels ("Jira Key" + "Initiative"), not by position, and every column is
 *    mapped by its label, so extra or reordered columns do not matter.
 *  - Anomalies, Resolution Status, Note Status and the repo path are ignored: Workbench derives them.
 *  - Week columns ("W1 5-9 Oct") hold markers like "Release 19 Oct" or "Self Test". They become milestones that
 *    carry month and day only; the year is applied when the admin saves, because it is the admin's choice.
 */
export interface ParsedMilestone { kind: 'release' | 'self_test'; month: number; day: number; label: string }

export interface ParsedInitiative {
  jiraKey: string
  squad: string | null
  title: string
  criticality: string | null
  epicStatus: string
  projectStatus: string | null
  ownerName: string | null
  estDeliveryDate: string | null
  actualDeliveryDate: string | null
  doneItems: number | null
  totalItems: number | null
  prdUrl: string | null
  rfcUrl: string | null
  remark: string | null
  remarkProposed: string | null
  needsReview: boolean
  milestones: ParsedMilestone[]
}

export interface ParsedInitiativeSheet { items: ParsedInitiative[]; warnings: string[] }

type Field = Exclude<keyof ParsedInitiative, 'milestones'>

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

const HEADERS: [Field | 'progress', RegExp][] = [
  ['jiraKey', /^jira key$/],
  ['title', /^initiative$/],
  ['squad', /^squad$/],
  ['criticality', /^criticality$/],
  ['epicStatus', /^jira epic status$/],
  ['projectStatus', /^project status$/],
  ['ownerName', /^jira owner/],
  ['estDeliveryDate', /^est\.? delivery date$/],
  ['actualDeliveryDate', /^actual delivery date$/],
  ['progress', /^jira progress \(done\/total\)$/],
  ['prdUrl', /^prd$/],
  ['rfcUrl', /^rfc$/],
  ['remarkProposed', /remark.*proposed/],
  ['remark', /^key info ?\/ ?remark$/],
  ['needsReview', /^needs review$/],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1

const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/

/** Returns the header row index and its column map, or null when the grid is not an initiatives tab. */
function locateHeader(rows: string[][]) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r]!.map(norm)
    if (!cells.includes('jira key') || !cells.includes('initiative')) continue
    const cols = new Map<Field | 'progress', number>()
    cells.forEach((cell, c) => {
      const hit = HEADERS.find(([field, re]) => !cols.has(field) && re.test(cell))
      if (hit) cols.set(hit[0], c)
    })
    return { row: r, cols }
  }
  return null
}

/** True when the grid looks like an initiatives tab (used to list only usable tabs). */
export const isInitiativeSheet = (rows: string[][]) => locateHeader(rows) != null

/** "W1 5-9 Oct" → { month: 10, day: 5 }; "W1 30 Nov - 4 Dec" → { month: 11, day: 30 }. */
function weekStart(header: string) {
  const m = header.replace(/\s+/g, ' ').match(/^w\d\s+(\d{1,2})(?:\s*([a-z]{3})[a-z]*)?\s*-\s*\d{1,2}\s*([a-z]{3})/i)
  if (!m) return null
  const month = monthOf(m[2] ?? m[3]!)
  return month > 0 ? { month, day: Number(m[1]) } : null
}

const httpUrl = (...candidates: string[]) => {
  for (const c of candidates) {
    const t = c.trim()
    if (!/^https?:\/\//i.test(t)) continue
    try { new URL(t); return t } catch { /* next */ }
  }
  return null
}

const isoDate = (raw: string) => raw.trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null

export function parseInitiativeSheet(rows: string[][], links: string[][] = []): ParsedInitiativeSheet {
  const header = locateHeader(rows)
  if (!header) throw new Error('could not find the "Jira Key" and "Initiative" column headers')
  const { cols } = header
  const warnings: string[] = []

  const weeks: { col: number; start: { month: number; day: number } | null }[] = []
  rows[header.row]!.forEach((cell, c) => { if (/^w\d/i.test(cell.trim())) weeks.push({ col: c, start: weekStart(cell) }) })

  const items: ParsedInitiative[] = []
  const seen = new Set<string>()
  let skippedMarkers = 0

  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r]!
    const cell = (f: Field | 'progress') => { const c = cols.get(f); return c == null ? '' : (row[c] ?? '').trim() }
    const link = (f: Field) => { const c = cols.get(f); return c == null ? '' : (links[r]?.[c] ?? '') }
    const jiraKey = cell('jiraKey').toUpperCase()
    const title = cell('title')
    const n = r + 1 // the row number a person sees in the sheet

    if (!jiraKey && !title) continue // blank row
    if (!JIRA_KEY.test(jiraKey)) { warnings.push(`Row ${n}: "${cell('jiraKey') || '(empty)'}" is not a Jira key, skipped.`); continue }
    if (!title) { warnings.push(`Row ${n}: ${jiraKey} has no initiative title, skipped.`); continue }
    if (seen.has(jiraKey)) { warnings.push(`Row ${n}: ${jiraKey} appears more than once, the first row is used.`); continue }
    seen.add(jiraKey)

    const date = (f: 'estDeliveryDate' | 'actualDeliveryDate', label: string) => {
      const raw = cell(f)
      if (!raw) return null
      const d = isoDate(raw)
      if (!d) warnings.push(`Row ${n}: ${jiraKey} ${label} "${raw}" is not a YYYY-MM-DD date, left empty.`)
      return d
    }

    // "108/152" (a leading apostrophe is how the sheet keeps it as text)
    const prog = cell('progress').replace(/^'/, '').match(/^(\d+)\s*\/\s*(\d+)$/)
    let doneItems: number | null = null
    let totalItems: number | null = null
    if (prog) {
      doneItems = Number(prog[1]); totalItems = Number(prog[2])
      if (doneItems > totalItems) { warnings.push(`Row ${n}: ${jiraKey} progress ${cell('progress')} has more done than total, left empty.`); doneItems = totalItems = null }
    } else if (cell('progress')) {
      warnings.push(`Row ${n}: ${jiraKey} progress "${cell('progress')}" is not Done/Total, left empty.`)
    }

    const milestones: ParsedMilestone[] = []
    for (const w of weeks) {
      const text = (row[w.col] ?? '').trim()
      if (!text) continue
      const kind = /^release/i.test(text) ? 'release' : /^self[\s-]*test/i.test(text) ? 'self_test' : null
      if (!kind) { skippedMarkers++; continue }
      const written = text.match(/(\d{1,2})\s+([A-Za-z]{3})/)
      const at = written && monthOf(written[2]!) > 0 ? { month: monthOf(written[2]!), day: Number(written[1]) } : w.start
      if (!at) { warnings.push(`Row ${n}: ${jiraKey} marker "${text.replace(/\s+/g, ' ')}" has no date, skipped.`); continue }
      milestones.push({ kind, month: at.month, day: at.day, label: kind === 'release' ? 'Release' : 'Self Test' })
    }

    items.push({
      jiraKey,
      squad: cell('squad') || null,
      title,
      criticality: cell('criticality') || null,
      epicStatus: cell('epicStatus') || 'To Do',
      projectStatus: cell('projectStatus') || null,
      ownerName: cell('ownerName') || null,
      estDeliveryDate: date('estDeliveryDate', 'Est. Delivery Date'),
      actualDeliveryDate: date('actualDeliveryDate', 'Actual Delivery Date'),
      doneItems, totalItems,
      prdUrl: httpUrl(link('prdUrl'), cell('prdUrl')),
      rfcUrl: httpUrl(link('rfcUrl'), cell('rfcUrl')),
      remark: cell('remark') || null,
      remarkProposed: cell('remarkProposed') || null,
      needsReview: /^(yes|y|true)$/i.test(cell('needsReview')),
      milestones,
    })
  }

  if (skippedMarkers) warnings.push(`${skippedMarkers} week cell(s) are neither Release nor Self Test (for example "runs on") and were skipped.`)
  if (!items.length) warnings.push('No initiative rows were found under the header.')
  return { items, warnings }
}

/** "26Q4 Initiatives", "Initiatives 2026 Q4", "Q4-2026" → { year: 2026, quarter: 4 }; null when nothing matches (no guessing). */
export function periodFromText(...texts: string[]) {
  for (const t of texts) {
    let m = t.match(/(20\d{2})\s*[-_ ]?Q\s*([1-4])/i)
    if (m) return { year: Number(m[1]), quarter: Number(m[2]) }
    m = t.match(/(?:^|[^\d])(\d{2})\s*Q\s*([1-4])/i)
    if (m) return { year: 2000 + Number(m[1]), quarter: Number(m[2]) }
    m = t.match(/Q\s*([1-4])\s*[-_ ]?(20\d{2})/i)
    if (m) return { year: Number(m[2]), quarter: Number(m[1]) }
  }
  return null
}

/** The calendar year of a month that appears in a quarter's weeks (Q1 can start in late December, Q4 can end in early January). */
export const yearForMonth = (year: number, quarter: number, month: number) =>
  quarter === 1 && month === 12 ? year - 1 : quarter === 4 && month === 1 ? year + 1 : year
