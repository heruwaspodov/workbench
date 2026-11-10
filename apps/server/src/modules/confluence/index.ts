import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { ConfluenceModel } from './model'
import { ConfluenceService as S } from './service'

export const confluenceModule = new Elysia({ name: 'module.confluence', prefix: '/api/confluence' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app.get('/pages', ({ user, query }) => S.pages(user, query), { query: ConfluenceModel.pagesQuery }),
  )
