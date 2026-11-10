import { t } from 'elysia'

export const ConnectionsModel = {
  search: t.Object({ q: t.Optional(t.String()) }),
  setJira: t.Object({ accountId: t.String({ minLength: 1 }) }),
  setBoard: t.Object({ boardId: t.Nullable(t.Integer()) }),
  setBitbucket: t.Object({ uuid: t.String({ minLength: 1 }) }),
}
