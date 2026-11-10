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
      .get('/jira/users', ({ query }) => S.searchJiraUsers(query.q ?? ''), { query: ConnectionsModel.search })
      .put('/jira', async ({ user, body }) => { await S.setJira(user, body.accountId); return S.overview(user) }, { body: ConnectionsModel.setJira })
      .delete('/jira', async ({ user }) => { await S.disconnectJira(user); return S.overview(user) })
      .get('/jira/boards', ({ query }) => S.listBoards(query.q), { query: ConnectionsModel.search })
      .put('/jira/board', async ({ user, body }) => { await S.setBoard(user, body.boardId); return S.overview(user) }, { body: ConnectionsModel.setBoard })
      // Bitbucket
      .post('/bitbucket/auto', async ({ user }) => { await S.autoConnectBitbucket(user); return S.overview(user) })
      .get('/bitbucket/members', ({ query }) => S.searchBitbucketMembers(query.q), { query: ConnectionsModel.search })
      .put('/bitbucket', async ({ user, body }) => { await S.setBitbucket(user, body.uuid); return S.overview(user) }, { body: ConnectionsModel.setBitbucket })
      .delete('/bitbucket', async ({ user }) => { await S.disconnectBitbucket(user); return S.overview(user) }),
  )
