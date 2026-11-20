import { t } from 'elysia'

const isoDate = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' })
const text = (max: number) => t.String({ maxLength: max })
const items = t.Integer({ minimum: 0, maximum: 100000 })

const milestone = t.Object({
  kind: t.Union([t.Literal('release'), t.Literal('self_test')]),
  date: isoDate,
  label: t.Optional(t.Nullable(text(100))),
})

/** Fields an admin may set on an initiative. The identity (year, quarter, Jira key) is fixed at creation. */
const fields = {
  squad: t.Optional(t.Nullable(text(60))),
  title: t.String({ minLength: 1, maxLength: 300 }),
  criticality: t.Optional(t.Nullable(text(40))),
  epicStatus: t.Optional(text(60)),
  projectStatus: t.Optional(t.Nullable(text(60))),
  ownerName: t.Optional(t.Nullable(text(120))),
  estDeliveryDate: t.Optional(t.Nullable(isoDate)),
  actualDeliveryDate: t.Optional(t.Nullable(isoDate)),
  doneItems: t.Optional(t.Nullable(items)),
  totalItems: t.Optional(t.Nullable(items)),
  prdUrl: t.Optional(t.Nullable(text(500))),
  rfcUrl: t.Optional(t.Nullable(text(500))),
  remark: t.Optional(t.Nullable(text(4000))),
  remarkProposed: t.Optional(t.Nullable(text(4000))),
  needsReview: t.Optional(t.Boolean()),
  milestones: t.Optional(t.Array(milestone, { maxItems: 40 })),
}

export const InitiativesModel = {
  period: t.Object({ year: t.Numeric({ minimum: 2000, maximum: 2100 }), quarter: t.Numeric({ minimum: 1, maximum: 4 }) }),
  listQuery: t.Object({
    year: t.Numeric({ minimum: 2000, maximum: 2100 }),
    quarter: t.Numeric({ minimum: 1, maximum: 4 }),
    squad: t.Optional(text(60)),
    status: t.Optional(text(60)),
    criticality: t.Optional(text(40)),
    month: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}$' })),
    q: t.Optional(text(100)),
  }),
  create: t.Object({
    year: t.Integer({ minimum: 2000, maximum: 2100 }),
    quarter: t.Integer({ minimum: 1, maximum: 4 }),
    jiraKey: t.String({ minLength: 3, maxLength: 40 }),
    sourceRef: t.Optional(t.Nullable(text(300))),
    ...fields,
  }),
  // Everything optional on update; only the fields that are sent change.
  update: t.Partial(t.Object({ ...fields, title: fields.title })),
  id: t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) }),
}

export interface InitiativeFilters {
  year: number
  quarter: number
  squad?: string
  status?: string
  criticality?: string
  month?: string
  q?: string
}
