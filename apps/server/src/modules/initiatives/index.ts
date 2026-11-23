import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { InitiativesImportService } from './import.service'
import { InitiativesModel } from './model'
import { InitiativesSyncService } from './sync.service'
import { InitiativesService } from './service'

/** Read: any signed-in user. Write: admin only. Data is initiative metadata, not personal data. */
export const initiativesModule = new Elysia({ name: 'module.initiatives', prefix: '/api/initiatives' })
  .use(authPlugin)
  .get('/', ({ query, user }) => InitiativesService.list(query, user.email), { auth: true, query: InitiativesModel.listQuery })
  .get('/periods', () => InitiativesService.periods(), { auth: true })
  .get('/summary', ({ query }) => InitiativesService.summary(query.year, query.quarter), { auth: true, query: InitiativesModel.period })
  // Upload only (no URL import): preview reads the .xlsx and saves nothing, import saves the reviewed rows.
  .post('/import/xlsx/preview', ({ body }) => InitiativesImportService.preview(body.file, body.tab), { admin: true, body: InitiativesModel.xlsxPreview })
  .post('/import/xlsx', ({ body }) => InitiativesImportService.run(body), { admin: true, body: InitiativesModel.importRows })
  // Refreshes the Jira-owned columns from Jira (admin: it writes shared data and uses the service account).
  .post('/sync', ({ body }) => InitiativesSyncService.run(body), { admin: true, body: InitiativesModel.sync })
  .post('/', ({ body, user }) => InitiativesService.create(body, user.email), { admin: true, body: InitiativesModel.create })
  .patch('/:id', ({ params, body, user }) => InitiativesService.update(params.id, body, user.email), { admin: true, params: InitiativesModel.id, body: InitiativesModel.update })
  .delete('/:id', ({ params }) => InitiativesService.remove(params.id), { admin: true, params: InitiativesModel.id })
