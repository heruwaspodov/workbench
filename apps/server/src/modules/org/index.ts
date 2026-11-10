import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { OrgModel } from './model'
import { OrgService as S } from './service'

export const orgModule = new Elysia({ name: 'module.org', prefix: '/api/org' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app
      .get('/me', ({ user }) => S.me(user))
      .get('/users', ({ user, query }) => S.searchUsers(user, query.q), { query: OrgModel.searchUsers })
      .get('/team', ({ user, query }) => S.team(user, query.period), { query: OrgModel.teamQuery })
      .post('/requests/leader', ({ user, body }) => S.requestLeader(user, body.userId), { body: OrgModel.target })
      .post('/requests/report', ({ user, body }) => S.requestReport(user, body.userId), { body: OrgModel.target })
      .post('/requests/:id/accept', ({ user, params }) => S.accept(user, params.id), { params: OrgModel.requestIdParam })
      .post('/requests/:id/reject', ({ user, params }) => S.reject(user, params.id), { params: OrgModel.requestIdParam })
      .delete('/requests/:id', ({ user, params }) => S.cancel(user, params.id), { params: OrgModel.requestIdParam })
      .delete('/reports/:userId', ({ user, params }) => S.removeReport(user, params.userId), { params: OrgModel.userIdParam })
      .delete('/leader', ({ user }) => S.removeLeader(user)),
  )
  .guard({ admin: true }, (app) =>
    app.put('/users/:id/manager', ({ params, body }) => S.adminSetManager(params.id, body.managerId), {
      params: OrgModel.requestIdParam,
      body: OrgModel.setManager,
    }),
  )
