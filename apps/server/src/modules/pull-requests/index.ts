import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { PullRequestsModel } from './model'
import { PullRequestsService } from './service'

export const pullRequestsModule = new Elysia({ name: 'module.pull-requests', prefix: '/api/pull-requests' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app
      .get('/', ({ user, query }) => PullRequestsService.list(user, query), { query: PullRequestsModel.listQuery })
      .get('/repos', ({ user }) => PullRequestsService.involvedRepos(user))
      .get('/:repo/:id', ({ user, params }) => PullRequestsService.detail(user, params.repo, Number(params.id)), { params: PullRequestsModel.detailParams })
      .get('/:repo/:id/diff', ({ user, params }) => PullRequestsService.diff(user, params.repo, Number(params.id)), { params: PullRequestsModel.detailParams }),
  )
