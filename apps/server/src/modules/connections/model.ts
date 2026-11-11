import { t } from 'elysia'

export const ConnectionsModel = {
  search: t.Object({ q: t.Optional(t.String()) }),
  setBoard: t.Object({ boardId: t.Nullable(t.Integer()) }),
}
