import { t } from 'elysia'

export const UsersModel = {
  listQuery: t.Object({
    q: t.Optional(t.String({ maxLength: 100 })),
    page: t.Optional(t.Numeric({ minimum: 1 })),
    pagelen: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  }),
  id: t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) }),
  setAdmin: t.Object({ admin: t.Boolean() }),
}
