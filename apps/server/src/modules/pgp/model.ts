import { t } from 'elysia'
import { PERIOD_PATTERN } from '../../shared/period'

const nullableText = t.Optional(t.Nullable(t.String({ maxLength: 4000 })))

export const ItemStatus = t.Union([
  t.Literal('not_started'), t.Literal('on_track'), t.Literal('at_risk'), t.Literal('done'), t.Literal('not_achieved'),
])

export const TemplateItemInput = t.Object({
  id: t.Optional(t.String({ format: 'uuid' })),
  companyOkr: nullableText,
  objective: t.String({ maxLength: 1000 }),
  keyResult: t.String({ maxLength: 2000 }),
  weight: t.Number({ minimum: 0, maximum: 100 }),
  initiative: t.String({ maxLength: 4000 }),
})

export const PlanItemInput = t.Composite([
  TemplateItemInput,
  t.Object({
    templateItemId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
    startValue: nullableText,
    targetValue: nullableText,
    currentValue: nullableText,
    achievement: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100 }))),
    status: t.Optional(ItemStatus),
    evidenceLinks: t.Optional(t.Array(t.String({ maxLength: 2000 }), { maxItems: 30 })),
    notes: nullableText,
  }),
])

export const PgpModel = {
  idParam: t.Object({ id: t.String({ format: 'uuid' }) }),

  templateCreate: t.Object({
    title: t.String({ minLength: 1, maxLength: 200 }),
    period: t.String({ pattern: PERIOD_PATTERN, error: 'Period must look like 2026-Q4' }),
    source: t.Optional(t.Union([t.Literal('scratch'), t.Literal('google_sheet'), t.Literal('xlsx')])),
    sourceRef: t.Optional(t.String({ maxLength: 500 })),
    items: t.Optional(t.Array(TemplateItemInput, { maxItems: 300 })),
  }),
  templateUpdate: t.Object({
    title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    period: t.Optional(t.String({ pattern: PERIOD_PATTERN, error: 'Period must look like 2026-Q4' })),
    status: t.Optional(t.Union([t.Literal('draft'), t.Literal('published'), t.Literal('archived')])),
  }),
  templateItems: t.Object({ items: t.Array(TemplateItemInput, { maxItems: 300 }) }),

  sheetTabsQuery: t.Object({ url: t.String({ minLength: 5 }) }),
  sheetPreviewQuery: t.Object({ url: t.String({ minLength: 5 }), tab: t.String({ minLength: 1 }) }),
  xlsxPreview: t.Object({
    file: t.File({ maxSize: '10m' }),
    tab: t.Optional(t.String()),
  }),

  planCreate: t.Object({ templateId: t.String({ format: 'uuid' }) }),
  planUpdate: t.Object({
    division: nullableText,
    sbu: nullableText,
    sbuDetail: nullableText,
    directLeader: nullableText,
  }),
  planItems: t.Object({ items: t.Array(PlanItemInput, { maxItems: 300 }) }),
}

export type TemplateItemInputT = typeof TemplateItemInput.static
export type PlanItemInputT = typeof PlanItemInput.static
