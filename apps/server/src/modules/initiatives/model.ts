import { t } from 'elysia'

// The browser client (Eden) turns "2026-11-30" in a response into a Date, so a round trip sends "2026-11-30T00:00:00.000Z".
// Both are accepted and clean() keeps only the date part (always UTC midnight, so the day never shifts).
const isoDate = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}(T00:00:00(\\.000)?Z)?$', description: 'YYYY-MM-DD' })
const text = (max: number) => t.String({ maxLength: max })
const items = t.Integer({ minimum: 0, maximum: 100000 })

const milestone = t.Object({
  kind: t.Union([t.Literal('release'), t.Literal('self_test')]),
  date: isoDate,
  label: t.Optional(t.Nullable(text(100))),
})

/** Fields an admin may set on an initiative. The identity (year, quarter, Jira key) is fixed at creation. */
const baseFields = {
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
  sheetAnomalies: t.Optional(t.Nullable(text(4000))),
  sheetResolution: t.Optional(t.Nullable(text(60))),
  repoNote: t.Optional(t.Nullable(text(300))),
}
const fields = { ...baseFields, milestones: t.Optional(t.Array(milestone, { maxItems: 40 })) }

/** A week-cell marker read from an upload. The year is not known until the admin picks it, so it carries month and day only. */
const importMilestone = t.Object({
  kind: t.Union([t.Literal('release'), t.Literal('self_test')]),
  month: t.Integer({ minimum: 1, maximum: 12 }),
  day: t.Integer({ minimum: 1, maximum: 31 }),
  label: t.Optional(t.Nullable(text(100))),
})

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
  xlsxPreview: t.Object({ file: t.File({ maxSize: '10m' }), tab: t.Optional(t.String()) }),
  importRows: t.Object({
    year: t.Integer({ minimum: 2000, maximum: 2100 }),
    quarter: t.Integer({ minimum: 1, maximum: 4 }),
    sourceRef: t.Optional(t.Nullable(text(300))),
    /** true = report what would change and save nothing. */
    dryRun: t.Optional(t.Boolean()),
    items: t.Array(t.Object({
      jiraKey: t.String({ minLength: 3, maxLength: 40 }),
      ...baseFields,
      milestones: t.Optional(t.Array(importMilestone, { maxItems: 40 })),
    }), { minItems: 1, maxItems: 500 }),
  }),
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
