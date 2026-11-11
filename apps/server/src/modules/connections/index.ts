import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { ConnectionsModel } from './model'
import { ConnectionsService as S } from './service'

export const connectionsModule = new Elysia({ name: 'module.connections', prefix: '/api/connections' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app
      .get('/', ({ user }) => S.overview(user))
      // Jira
      .post('/jira/auto', async ({ user }) => { await S.autoConnectJira(user); return S.overview(user) })
      .delete('/jira', async ({ user }) => { await S.disconnectJira(user); return S.overview(user) })
      .get('/jira/boards', ({ query }) => S.listBoards(query.q), { query: ConnectionsModel.search })
      .put('/jira/board', async ({ user, body }) => { await S.setBoard(user, body.boardId); return S.overview(user) }, { body: ConnectionsModel.setBoard })
      .put('/jira/team-label', async ({ user, body }) => { await S.setTeamLabel(user, body.label); return S.overview(user) }, { body: ConnectionsModel.setTeamLabel })
      // Bitbucket
      .post('/bitbucket/auto', async ({ user }) => { await S.autoConnectBitbucket(user); return S.overview(user) })
      .delete('/bitbucket', async ({ user }) => { await S.disconnectBitbucket(user); return S.overview(user) }),
  )
