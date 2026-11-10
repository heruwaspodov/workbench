import { Elysia } from 'elysia'
import { authModule } from './modules/auth'
import { connectionsModule } from './modules/connections'
import { kanbanModule } from './modules/kanban'
import { orgModule } from './modules/org'
import { pgpModule } from './modules/pgp'
import { pullRequestsModule } from './modules/pull-requests'
import { AppError } from './shared/errors'

/** Composes all feature modules. Imported by index.ts (server) and by the web app (types only). */
export const app = new Elysia()
  .onError(({ code, error, status }) => {
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
  .use(pgpModule)
  .use(kanbanModule)
  .use(orgModule)
  .use(pullRequestsModule)

export type App = typeof app
