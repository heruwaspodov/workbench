import { env } from '../../config/env'
import { jira } from '../../integrations/jira.client'
import { cached } from '../../shared/cache'
import { BadRequestError } from '../../shared/errors'
import { calendarMinutes, parseTarget } from '../../shared/sla-time'
import { SlaService } from '../sla/service'
import { jqlUrl, quote, SuggestionsService } from './suggestions.service'
import type { User } from '../../db/schema'

const TTL = 5 * 60_000
const CAP = 1000
const MISSED_LIST = 50

type State = 'met' | 'missed' | 'running'

/**
 * Fast Track tickets of the team created in the plan's quarter, judged against the SLA goals configured in the app
 * (a copy of the Time to SLA configuration in Jira). The first goal matching priority, label and a set assignee applies;
 * time runs from creation to resolution (or now), on the goal's calendar. Tickets that match no goal are counted apart.
 */
export abstract class FastTrackSlaService {
  static async evaluate(id: string, user: User, rawLabel?: string, now = Date.now()) {
    const { plan, accountId, teamLabel, range } = await SuggestionsService.owned(id, user)
    const label = (rawLabel ?? teamLabel ?? '').trim()
    if (!label) throw new BadRequestError('Set your team label in Connections first')
    const goals = await SlaService.list()
    const project = env.jira.slaProject
    const jql = `${project ? `project = ${quote(project)} AND ` : ''}issuetype = "Fast Track" AND labels = ${quote(label)} AND created >= ${quote(range.from)} AND created < ${quote(range.to)} ORDER BY created ASC`
    const goalsKey = goals.map((g) => `${g.name}|${g.priority}|${g.label}|${g.calendar}|${g.target}`).join(';')
    const { issues, truncated } = await cached(`sg:${plan.id}:${accountId}:sla:${label}:${goalsKey}`, TTL, () =>
      jira.search(jql, ['summary', 'created', 'resolutiondate', 'status', 'priority', 'labels', 'assignee'], CAP))

    const byGoal = new Map<string, { name: string; target: string; calendar: string; met: number; missed: number; running: number }>()
    const missedList: { key: string; summary: string; goal: string; calendar: 'weekdays' | 'always'; elapsedMinutes: number; targetMinutes: number; open: boolean; url: string }[] = []
    let noGoal = 0
    const totals: Record<State, number> = { met: 0, missed: 0, running: 0 }

    for (const i of issues) {
      const labels = (i.fields.labels as string[] | undefined ?? []).map((l) => l.toLowerCase())
      const priority = String(i.fields.priority?.name ?? '')
      const goal = i.fields.assignee ? goals.find((g) => g.priority === priority && labels.includes(g.label.toLowerCase())) : undefined
      const targetMinutes = goal ? parseTarget(goal.target, goal.calendar as 'weekdays' | 'always') : null
      if (!goal || targetMinutes == null) { noGoal++; continue }
      const start = Date.parse(i.fields.created)
      const resolved = i.fields.resolutiondate ? Date.parse(i.fields.resolutiondate) : null
      const elapsed = calendarMinutes(start, resolved ?? now, goal.calendar as 'weekdays' | 'always')
      const state: State = elapsed <= targetMinutes ? (resolved ? 'met' : 'running') : 'missed'
      totals[state]++
      const g = byGoal.get(goal.id) ?? { name: goal.name, target: goal.target, calendar: goal.calendar, met: 0, missed: 0, running: 0 }
      g[state]++
      byGoal.set(goal.id, g)
      if (state === 'missed') missedList.push({ key: i.key, summary: String(i.fields.summary ?? ''), goal: goal.name, calendar: goal.calendar as 'weekdays' | 'always', elapsedMinutes: Math.round(elapsed), targetMinutes, open: !resolved, url: jira.browseUrl(i.key) })
    }
    const rate = (m: number, x: number) => (m + x === 0 ? null : Math.round((m / (m + x)) * 1000) / 10)
    missedList.sort((a, b) => b.elapsedMinutes - b.targetMinutes - (a.elapsedMinutes - a.targetMinutes))
    return {
      label, from: range.from, to: range.to, jql, url: jqlUrl(jql), truncated,
      total: issues.length, ...totals, noGoal,
      rate: rate(totals.met, totals.missed),
      goals: goals.filter((g) => byGoal.has(g.id)).map((g) => ({ ...byGoal.get(g.id)!, rate: rate(byGoal.get(g.id)!.met, byGoal.get(g.id)!.missed) })),
      missedTickets: missedList.slice(0, MISSED_LIST),
      missedTruncated: missedList.length > MISSED_LIST,
    }
  }
}
export type FastTrackSla = Awaited<ReturnType<typeof FastTrackSlaService.evaluate>>
