import { Elysia } from 'elysia'
import { AuthService } from '../modules/auth/service'
import { SESSION_COOKIE } from '../modules/auth/model'

/**
 * Route guard. Usage: `.get('/x', ({ user }) => ..., { auth: true })`
 * or `{ admin: true }` for admin-only routes.
 */
export const authPlugin = new Elysia({ name: 'shared.auth' }).macro({
  auth: {
    async resolve({ cookie, status }) {
      const user = await AuthService.userFromSession(cookie[SESSION_COOKIE]?.value)
      if (!user) return status(401, { code: 'UNAUTHORIZED', message: 'Please sign in' })
      return { user }
    },
  },
  admin: {
    async resolve({ cookie, status }) {
      const user = await AuthService.userFromSession(cookie[SESSION_COOKIE]?.value)
      if (!user) return status(401, { code: 'UNAUTHORIZED', message: 'Please sign in' })
      if (user.role !== 'admin') return status(403, { code: 'FORBIDDEN', message: 'Admin only' })
      return { user }
    },
  },
})
