/**
 * Parses a PGP growth-plan grid (Google Sheet values or xlsx rows) into template items.
 *
 * Tolerates the format drift between quarters:
 *  - header row is located by labels ("Objective" + "Key Result(s)"), not by position
 *  - merged Objective / Key Result cells are carried forward to following rows
 *  - "Example:" rows are skipped, parsing stops at "Total" / "Team Members"
 */
export interface ParsedItem {
  companyOkr: string | null
  objective: string
  keyResult: string
  weight: number
  initiative: string
  startValue: string | null
  targetValue: string | null
  currentValue: string | null
  achievement: number | null
  status: string | null
  /** http(s) links from the evidence column: URLs written in the cell and the hidden target of a hyperlink cell. */
  evidenceLinks: string[]
}

export interface ParsedSheet {
  meta: { division?: string; name?: string; sbu?: string; sbuDetail?: string; directLeader?: string; period?: string }
  items: ParsedItem[]
  totalWeight: number
  warnings: string[]
}

type Col = Exclude<keyof ParsedItem, 'evidenceLinks'> | 'evidence'

const HEADER_MATCHERS: [Col, RegExp][] = [
  ['companyOkr', /okr/i],
  ['objective', /^objectives?$/i],
  ['keyResult', /^key\s*results?$/i],
  ['weight', /weight/i],
  ['initiative', /^initiatives?$/i],
  ['startValue', /start\s*value|baseline/i],
  ['targetValue', /target\s*value/i],
  ['currentValue', /current\s*value/i],
  ['achievement', /achievement/i],
  ['status', /^status$/i],
  ['evidence', /hyperlink|evidence/i],
]

const META_LABELS: [keyof ParsedSheet['meta'], RegExp][] = [
  ['division', /^division/i],
  ['name', /^your\s*name|^name$/i],
  ['sbu', /^sbu\s*\(scope/i],
  ['sbuDetail', /^sbu\s*\(detail/i],
  ['directLeader', /leader/i],
  ['period', /^period$/i],
]

const clean = (v: unknown) => (v == null ? '' : String(v).replace(/\r/g, '').trim())

/** "12%" → 12, "0.12" (fraction) → 12, "12" → 12 */
export function parsePercent(raw: string): number | null {
  const s = raw.replace(',', '.').trim()
  if (!s) return null
  const n = Number.parseFloat(s.replace('%', ''))
  if (Number.isNaN(n)) return null
  if (!s.includes('%') && n > 0 && n <= 1 && s.includes('.')) return Math.round(n * 10000) / 100
  return Math.round(n * 100) / 100
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi
const isHttp = (u: string) => /^https?:\/\//i.test(u)

/** `links` is a grid shaped like `rows` holding hyperlink targets (see ExcelService.readWorkbookWithLinks). */
export function parsePgpSheet(rows: string[][], links?: string[][]): ParsedSheet {
  const grid = rows.map((r) => r.map(clean))
  const warnings: string[] = []

  const headerIdx = grid.findIndex(
    (r) => r.some((c) => /^objectives?$/i.test(c)) && r.some((c) => /^key\s*results?$/i.test(c)),
  )
  if (headerIdx < 0) throw new Error('Header row not found (expected "Objective" and "Key Results" columns)')

  const header = grid[headerIdx]!
  const col: Partial<Record<Col, number>> = {}
  header.forEach((cell, i) => {
    for (const [key, re] of HEADER_MATCHERS) if (col[key] === undefined && re.test(cell)) col[key] = i
  })
  // Two-line headers (e.g. "Start Value" / "(baseline)") may sit on the next row.
  grid[headerIdx + 1]?.forEach((cell, i) => {
    for (const [key, re] of HEADER_MATCHERS) if (col[key] === undefined && re.test(cell)) col[key] = i
  })
  for (const req of ['objective', 'keyResult', 'weight', 'initiative'] as const) {
    if (col[req] === undefined) throw new Error(`Column "${req}" not found in header`)
  }

  // Meta block above the header: label row followed by a value row.
  const meta: ParsedSheet['meta'] = {}
  for (let r = 0; r < headerIdx; r++) {
    grid[r]!.forEach((cell, c) => {
      for (const [key, re] of META_LABELS) {
        if (!meta[key] && re.test(cell)) {
          const value = grid[r + 1]?.[c]
          if (value) meta[key] = value
        }
      }
    })
  }

  const get = (row: string[], key: Col) => (col[key] === undefined ? '' : row[col[key]!] ?? '')
  const items: ParsedItem[] = []
  let carry = { companyOkr: '', objective: '', keyResult: '' }

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r]!
    if (row.every((c) => !c)) continue
    if (row.some((c) => /^example\s*:?/i.test(c))) continue
    if (row.some((c) => /^(total|team members)$/i.test(c))) break
    // Skip the second header line if present
    if (HEADER_MATCHERS.some(([, re]) => re.test(get(row, 'keyResult')) || re.test(get(row, 'objective')))) continue

    const objective = get(row, 'objective') || carry.objective
    const keyResult = get(row, 'keyResult') || carry.keyResult
    const companyOkr = get(row, 'companyOkr') || carry.companyOkr
    // A new objective with a blank KR starts a fresh KR context.
    carry = {
      companyOkr,
      objective,
      keyResult: get(row, 'objective') && !get(row, 'keyResult') ? '' : keyResult,
    }

    const initiative = get(row, 'initiative')
    const weightRaw = get(row, 'weight')
    if (!initiative && !weightRaw) continue

    const weight = parsePercent(weightRaw) ?? 0
    if (weightRaw && parsePercent(weightRaw) === null) warnings.push(`Row ${r + 1}: invalid weight "${weightRaw}"`)
    const currentValue = get(row, 'currentValue')
    const evidence = [
      ...(get(row, 'evidence').match(URL_RE) ?? []),
      ...(col.evidence === undefined ? [] : [links?.[r]?.[col.evidence] ?? '']),
    ].map((u) => u.trim().replace(/[.,;]+$/, '')).filter(isHttp)

    items.push({
      companyOkr: companyOkr || null,
      objective,
      keyResult: carry.keyResult,
      weight,
      initiative,
      startValue: get(row, 'startValue') || null,
      targetValue: get(row, 'targetValue') || null,
      currentValue: currentValue && !/^score$/i.test(currentValue) ? currentValue : null,
      achievement: parsePercent(get(row, 'achievement')),
      status: get(row, 'status') || null,
      evidenceLinks: [...new Set(evidence)],
    })
  }

  const totalWeight = Math.round(items.reduce((s, i) => s + i.weight, 0) * 100) / 100
  if (!items.length) warnings.push('No items found below the header row')
  else if (totalWeight !== 100) warnings.push(`Total weight is ${totalWeight}%, expected 100%`)
  return { meta, items, totalWeight, warnings }
}
