import { t } from 'elysia'

export const SlaModel = {
  goals: t.Object({
    goals: t.Array(t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      priority: t.String({ minLength: 1, maxLength: 60 }),
      label: t.String({ minLength: 1, maxLength: 100 }),
      calendar: t.Union([t.Literal('weekdays'), t.Literal('always')]),
      target: t.String({ minLength: 1, maxLength: 30 }),
    }), { minItems: 1, maxItems: 40 }),
  }),
}
