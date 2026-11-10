import { t } from 'elysia'

const uuidParam = t.String({ format: 'uuid' })

export const OrgModel = {
  requestIdParam: t.Object({ id: uuidParam }),
  userIdParam: t.Object({ userId: uuidParam }),
  searchUsers: t.Object({ q: t.Optional(t.String({ maxLength: 100 })) }),
  target: t.Object({ userId: uuidParam }),
  setManager: t.Object({ managerId: t.Nullable(uuidParam) }),
  teamQuery: t.Object({ period: t.Optional(t.String({ maxLength: 20 })) }),
}

export type RequestDirection = 'as_report' | 'as_leader'
