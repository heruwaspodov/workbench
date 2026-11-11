import { Elysia } from 'elysia'
import { authModule } from './modules/auth'
import { confluenceModule } from './modules/confluence'
import { connectionsModule } from './modules/connections'
import { kanbanModule } from './modules/kanban'
import { orgModule } from './modules/org'
import { pgpModule } from './modules/pgp'
import { pullRequestsModule } from './modules/pull-requests'
import { slaModule } from './modules/sla'
import { env } from './config/env'
import { AppError, PeriodExistsError } from './shared/errors'
import { originGuard } from './shared/origin-guard'

/** Composes all feature modules. Imported by index.ts (server) and by the web app (types only). */
export const app = new Elysia()
  .use(originGuard(env.appUrl))
  .onError(({ code, error, status }) => {
    if (error instanceof PeriodExistsError) return status(409, { code: error.code, message: error.message, existingPlanId: error.existingPlanId })
    if (error instanceof AppError) return status(error.status as 400, { code: error.code, message: error.message })
    if (code === 'VALIDATION') {
      const first = error.all[0]
      const where = first && 'path' in first && first.path ? ` (${first.path})` : ''
      return status(422, { code: 'VALIDATION', message: `${first?.summary ?? 'Invalid request'}${where}` })
    }
    if (code === 'NOT_FOUND') return status(404, { code: 'NOT_FOUND', message: 'Not found' })
    console.error(error)
    return status(500, { code: 'INTERNAL', message: 'Internal server error' })
  })
  .get('/api/health', () => ({ ok: true }))
  .use(authModule)
  .use(connectionsModule)
  .use(confluenceModule)
  .use(pgpModule)
  .use(kanbanModule)
  .use(orgModule)
  .use(pullRequestsModule)
  .use(slaModule)

export type App = typeof app
