import { t } from 'elysia'

export const ConfluenceModel = {
  pagesQuery: t.Object({
    role: t.Optional(t.Union([t.Literal('creator'), t.Literal('contributor')])),
    days: t.Optional(t.Numeric({ minimum: 1, maximum: 730 })),
    q: t.Optional(t.String({ maxLength: 100 })),
    page: t.Optional(t.Numeric({ minimum: 1 })),
    pagelen: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  }),
}

export interface ConfluencePage {
  id: string
  title: string
  space: string | null
  url: string
  lastModified: string | null
}
