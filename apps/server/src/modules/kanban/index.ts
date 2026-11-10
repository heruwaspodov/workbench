import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { KanbanModel } from './model'
import { KanbanService } from './service'

export const kanbanModule = new Elysia({ name: 'module.kanban', prefix: '/api/kanban' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app
      .get('/', ({ user, query }) => KanbanService.board(user, query.scope), { query: KanbanModel.boardQuery })
      .get('/stats', ({ user }) => KanbanService.monthlyStats(user))
      .get('/issues/:key', ({ user, params }) => KanbanService.issue(user, params.key), { params: KanbanModel.issueParams }),
  )
