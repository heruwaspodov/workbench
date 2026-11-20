import { Elysia } from 'elysia'
import { authPlugin } from '../../shared/auth.plugin'
import { UsersModel } from './model'
import { UsersService } from './service'

/** Who is an admin. Admin only: it lists people's work emails and changes who can manage the app. */
export const usersModule = new Elysia({ name: 'module.users', prefix: '/api/users' })
  .use(authPlugin)
  .guard({ admin: true }, (app) =>
    app
      .get('/', ({ query }) => UsersService.list(query), { query: UsersModel.listQuery })
      .put('/:id/admin', ({ user, params, body }) => UsersService.setAdmin(user, params.id, body.admin), { params: UsersModel.id, body: UsersModel.setAdmin }),
  )
