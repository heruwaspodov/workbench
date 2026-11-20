import { count } from 'drizzle-orm'
import { env } from '../config/env'
import { db } from '../db/client'
import { userAdmin } from '../db/schema'

/**
 * Admin rules. Admin = a row in `user_admin`. The ADMIN_EMAILS list in .env is only a bootstrap fallback and counts
 * **only while `user_admin` is empty**, so once anyone has been granted in the app the list stops mattering.
 */
export const emailInAdminEnv = (email: string) => env.adminEmails.includes(email.trim().toLowerCase())

export async function adminTableEmpty() {
  const [row] = await db.select({ n: count() }).from(userAdmin)
  return (row?.n ?? 0) === 0
}
