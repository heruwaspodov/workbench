import { asc } from 'drizzle-orm'
import { db } from '../../db/client'
import { slaGoals } from '../../db/schema'
import { invalidate } from '../../shared/cache'
import { BadRequestError } from '../../shared/errors'
import { parseTarget, type SlaCalendar } from '../../shared/sla-time'

export interface SlaGoalInput { name: string; priority: string; label: string; calendar: SlaCalendar; target: string }

export abstract class SlaService {
  static list() {
    return db.select().from(slaGoals).orderBy(asc(slaGoals.position))
  }

  /** Replaces the whole goal list (the order given is the order of matching). */
  static async replace(goals: SlaGoalInput[]) {
    const rows = goals.map((g, i) => {
      const name = g.name.trim(), priority = g.priority.trim(), label = g.label.trim().toLowerCase(), target = g.target.trim()
      if (!name || !priority || !label) throw new BadRequestError(`Goal ${i + 1}: name, priority and label are required`)
      if (parseTarget(target, g.calendar) == null) throw new BadRequestError(`Goal ${i + 1}: "${g.target}" is not a duration (examples: 8h, 1d12h, 2d)`)
      return { position: i + 1, name, priority, label, calendar: g.calendar, target }
    })
    await db.transaction(async (tx) => {
      await tx.delete(slaGoals)
      await tx.insert(slaGoals).values(rows)
    })
    invalidate('sg:') // suggestion results were computed with the old goals
    return this.list()
  }
}
