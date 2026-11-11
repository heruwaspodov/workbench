import { t } from 'elysia'

export const ConnectionsModel = {
  search: t.Object({ q: t.Optional(t.String()) }),
  setTeamLabel: t.Object({ label: t.Nullable(t.String({ maxLength: 100 })) }),
  setBoard: t.Object({ boardId: t.Nullable(t.Integer()) }),
}
