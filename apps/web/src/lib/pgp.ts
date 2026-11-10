export type ItemStatus = 'not_started' | 'on_track' | 'at_risk' | 'done' | 'not_achieved'

export const STATUS_OPTIONS: { value: ItemStatus; label: string; color: 'gray' | 'blue' | 'orange' | 'green' | 'red' }[] = [
  { value: 'not_started', label: 'Not Started', color: 'gray' },
  { value: 'on_track', label: 'On Track', color: 'blue' },
  { value: 'at_risk', label: 'At Risk', color: 'orange' },
  { value: 'done', label: 'Done', color: 'green' },
  { value: 'not_achieved', label: 'Not Achieved', color: 'red' },
]
export const statusMeta = (s: string) => STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0]!

/** Row shape edited in the UI — superset of template & plan items. */
export interface EditableItem {
  id?: string
  templateItemId?: string | null
  companyOkr?: string | null
  objective: string
  keyResult: string
  weight: number
  initiative: string
  startValue?: string | null
  targetValue?: string | null
  currentValue?: string | null
  achievement?: number | null
  status?: ItemStatus
  evidenceLinks?: string[]
  notes?: string | null
  /** client-only stable key for v-for */
  _key: string
}

let seq = 0
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`

export const toEditable = <T extends Omit<EditableItem, '_key'>>(items: T[]): EditableItem[] =>
  items.map((i) => ({ ...i, _key: i.id ?? newKey() }))

export const stripKeys = <T extends EditableItem>(items: T[]) => items.map(({ _key, ...rest }) => rest)

export const totals = (items: EditableItem[]) => ({
  weight: Math.round(items.reduce((s, i) => s + (Number(i.weight) || 0), 0) * 100) / 100,
  score: Math.round(items.reduce((s, i) => s + Math.min(Number(i.achievement) || 0, Number(i.weight) || 0), 0) * 100) / 100,
})

/** Normalises PERIOD like "Q4" + year → "2026-Q4" */
export function guessPeriod(raw?: string) {
  const year = new Date().getFullYear()
  const q = raw?.match(/q\s*([1-4])/i)?.[1] ?? String(Math.floor(new Date().getMonth() / 3) + 1)
  const y = raw?.match(/(20\d{2})/)?.[1] ?? raw?.match(/\b(\d{2})\b/)?.[1]
  return `${y ? (y.length === 2 ? `20${y}` : y) : year}-Q${q}`
}
