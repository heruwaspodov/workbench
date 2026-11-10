import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { ExcelService } from './excel.service'
import { PgpModel } from './model'
import { PlanImportService } from './plan-import.service'
import { PlanService } from './plan.service'
import { TemplateService } from './template.service'

const templateRoutes = new Elysia({ name: 'module.pgp.templates', prefix: '/templates' })
  .use(authPlugin)
  // read — any signed-in user (members only see published)
  .get('/', ({ user }) => TemplateService.list(user), { auth: true })
  .get('/:id', ({ user, params }) => TemplateService.get(params.id, user), { auth: true, params: PgpModel.idParam })
  // manage — admin only
  .post('/', ({ user, body }) => TemplateService.create(user, body), { admin: true, body: PgpModel.templateCreate })
  .patch('/:id', ({ params, body }) => TemplateService.update(params.id, body), { admin: true, params: PgpModel.idParam, body: PgpModel.templateUpdate })
  .put('/:id/items', ({ params, body }) => TemplateService.replaceItems(params.id, body.items), { admin: true, params: PgpModel.idParam, body: PgpModel.templateItems })
  .delete('/:id', ({ params }) => TemplateService.remove(params.id), { admin: true, params: PgpModel.idParam })
  .get('/:id/plans', ({ params }) => TemplateService.plansOf(params.id), { admin: true, params: PgpModel.idParam })
  // import helpers — preview only; the client then POSTs / with the (edited) items
  .get('/import/sheet/tabs', ({ query }) => TemplateService.sheetTabs(query.url), { admin: true, query: PgpModel.sheetTabsQuery })
  .get('/import/sheet/preview', ({ query }) => TemplateService.previewSheet(query.url, query.tab), { admin: true, query: PgpModel.sheetPreviewQuery })
  .post('/import/xlsx/preview', ({ body }) => TemplateService.previewXlsx(body.file, body.tab), { admin: true, body: PgpModel.xlsxPreview })

const planRoutes = new Elysia({ name: 'module.pgp.plans', prefix: '/plans' })
  .use(authPlugin)
  .guard({ auth: true }, (app) =>
    app
      .get('/', ({ user }) => PlanService.listMine(user))
      .post('/', ({ user, body }) => PlanService.create(user, body.templateId), { body: PgpModel.planCreate })
      .post('/import/xlsx/preview', ({ body }) => PlanImportService.preview(body.file, body.tab), { body: PgpModel.xlsxPreview })
      .post('/from-xlsx', ({ user, body }) => PlanImportService.create(user, body), { body: PgpModel.planFromXlsx })
      .get('/:id', ({ user, params }) => PlanService.get(params.id, user), { params: PgpModel.idParam })
      .patch('/:id', ({ user, params, body }) => PlanService.updateHeader(params.id, user, body), { params: PgpModel.idParam, body: PgpModel.planUpdate })
      .put('/:id/items', ({ user, params, body }) => PlanService.replaceItems(params.id, user, body.items), { params: PgpModel.idParam, body: PgpModel.planItems })
      .post('/:id/submit', ({ user, params }) => PlanService.setStatus(params.id, user, 'submitted'), { params: PgpModel.idParam })
      .post('/:id/reopen', ({ user, params }) => PlanService.setStatus(params.id, user, 'draft'), { params: PgpModel.idParam })
      .delete('/:id', ({ user, params }) => PlanService.remove(params.id, user), { params: PgpModel.idParam })
      .get('/:id/export', async ({ user, params, set }) => {
        const plan = await PlanService.get(params.id, user)
        const file = await ExcelService.exportPlan(plan)
        const name = `PGP ${plan.period} - ${plan.user.name}.xlsx`.replace(/[^\w .-]/g, '_')
        set.headers['content-type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        set.headers['content-disposition'] = `attachment; filename="${name}"`
        return new Response(new Uint8Array(file))
      }, { params: PgpModel.idParam }),
  )

export const pgpModule = new Elysia({ name: 'module.pgp', prefix: '/api/pgp' })
  .use(templateRoutes)
  .use(planRoutes)
