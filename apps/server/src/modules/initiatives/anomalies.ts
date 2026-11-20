import type { Initiative } from '../../db/schema'

export type StatusCategory = 'done' | 'todo' | 'active'

const TODO_STATUSES = new Set(['', 'to do', 'todo', 'backlog', 'open'])

/** Groups a free-text Jira status. Anything that is neither Done nor not-started counts as active. */
export function statusCategory(status: string | null | undefined): StatusCategory {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'done') return 'done'
  return TODO_STATUSES.has(s) ? 'todo' : 'active'
}

type Row = Pick<Initiative,
  'epicStatus' | 'ownerName' | 'estDeliveryDate' | 'actualDeliveryDate' | 'doneItems' | 'totalItems' | 'criticality' | 'needsReview'>

/**
 * Things that still need action on one initiative (rules from the "26Q4 Initiatives README" sheet).
 * Only actionable lines are returned, so a non-empty list always means outstanding work.
 * `today` is "YYYY-MM-DD" and is a parameter so the result is testable.
 */
export function anomaliesFor(row: Row, today: string): string[] {
  const out: string[] = []
  const cat = statusCategory(row.epicStatus)
  const done = cat === 'done'
  const total = row.totalItems ?? 0
  const doneItems = row.doneItems ?? 0

  if (row.totalItems == null || total === 0) out.push('No task breakdown: the epic has no child items.')
  else if (done && doneItems < total) out.push(`Epic reads Done but ${total - doneItems} child item(s) are still open: close them or say what is outstanding.`)
  else if (!done && doneItems === total) out.push('All child items are done but the epic is still open: close it or add the remaining work.')
  else if (cat === 'todo' && doneItems > 0) out.push('Epic status is not started but child items are already done: update the epic status.')

  if (!done && !row.ownerName?.trim()) out.push('No epic owner (assignee).')

  if (!done) {
    if (!row.estDeliveryDate) out.push('No Est. Delivery Date on the epic.')
    else if (row.estDeliveryDate < today) out.push(`Est. Delivery Date ${row.estDeliveryDate} has passed and the epic is still open.`)
    if (row.actualDeliveryDate) out.push('Actual Delivery Date is set on an open epic.')
  } else if (!row.actualDeliveryDate) {
    out.push('Epic is Done but has no Actual Delivery Date.')
  }

  if (!row.criticality?.trim()) out.push('No criticality set.')
  if (row.needsReview) out.push('Marked for review: the note records an unresolved discrepancy.')
  return out
}
