import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { SlaModel } from './model'
import { SlaService } from './service'

export const slaModule = new Elysia({ name: 'module.sla', prefix: '/api/sla' })
  .use(authPlugin)
  .get('/goals', () => SlaService.list(), { auth: true })
  .put('/goals', ({ body }) => SlaService.replace(body.goals), { admin: true, body: SlaModel.goals })
