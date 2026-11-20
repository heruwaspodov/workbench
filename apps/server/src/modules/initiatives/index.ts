import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { InitiativesModel } from './model'
import { InitiativesService } from './service'

/** Read: any signed-in user. Write: admin only. Data is initiative metadata, not personal data. */
export const initiativesModule = new Elysia({ name: 'module.initiatives', prefix: '/api/initiatives' })
  .use(authPlugin)
  .get('/', ({ query }) => InitiativesService.list(query), { auth: true, query: InitiativesModel.listQuery })
  .get('/periods', () => InitiativesService.periods(), { auth: true })
  .get('/summary', ({ query }) => InitiativesService.summary(query.year, query.quarter), { auth: true, query: InitiativesModel.period })
  .post('/', ({ body }) => InitiativesService.create(body), { admin: true, body: InitiativesModel.create })
  .patch('/:id', ({ params, body }) => InitiativesService.update(params.id, body), { admin: true, params: InitiativesModel.id, body: InitiativesModel.update })
  .delete('/:id', ({ params }) => InitiativesService.remove(params.id), { admin: true, params: InitiativesModel.id })
