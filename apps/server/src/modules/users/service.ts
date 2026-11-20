import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { userAdmin, users, type User } from '../../db/schema'
import { adminTableEmpty, emailInAdminEnv } from '../../shared/admin'
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors'

export interface UserRow {
  id: string
  name: string
  email: string
  isAdmin: boolean
  /** "table" = a row in user_admin; "env" = admin only through the ADMIN_EMAILS fallback; null = member. */
  adminSource: 'table' | 'env' | null
  adminSince: Date | null
  grantedBy: string | null
  lastLoginAt: Date | null
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const granter = alias(users, 'granter')

export abstract class UsersService {
  /** Everyone who has signed in, admins first. Emails are shown to admins only (the route is admin-guarded). */
  static async list(opts: { q?: string; page?: number; pagelen?: number }) {
    const page = opts.page ?? 1
    const pagelen = opts.pagelen ?? 20
    const needle = opts.q?.trim()
    const where: SQL | undefined = needle
      ? or(ilike(users.name, `%${likeEscape(needle)}%`), ilike(users.email, `%${likeEscape(needle)}%`))
      : undefined

    const [total] = await db.select({ n: count() }).from(users).where(where)
    const rows = await db
      .select({ user: users, adminId: userAdmin.userId, since: userAdmin.createdAt, by: granter.name })
      .from(users)
      .leftJoin(userAdmin, eq(userAdmin.userId, users.id))
      .leftJoin(granter, eq(granter.id, userAdmin.grantedBy))
      .where(where)
      .orderBy(desc(isNotNull(userAdmin.userId)), asc(users.name), asc(users.email))
      .limit(pagelen)
      .offset((page - 1) * pagelen)

    const fallback = await adminTableEmpty()
    const items: UserRow[] = rows.map((r) => {
      const source = r.adminId ? 'table' : fallback && emailInAdminEnv(r.user.email) ? 'env' : null
      return {
        id: r.user.id, name: r.user.name, email: r.user.email, isAdmin: source != null, adminSource: source,
        adminSince: r.since, grantedBy: r.by, lastLoginAt: r.user.lastLoginAt,
      }
    })
    return { items, total: total?.n ?? 0, page, pagelen, hasNext: page * pagelen < (total?.n ?? 0), fallback }
  }

  static async one(id: string): Promise<UserRow> {
    const [row] = await db.select({ user: users, adminId: userAdmin.userId, since: userAdmin.createdAt, by: granter.name })
      .from(users)
      .leftJoin(userAdmin, eq(userAdmin.userId, users.id))
      .leftJoin(granter, eq(granter.id, userAdmin.grantedBy))
      .where(eq(users.id, id))
    if (!row) throw new NotFoundError('User')
    const source = row.adminId ? 'table' : (await adminTableEmpty()) && emailInAdminEnv(row.user.email) ? 'env' : null
    return {
      id: row.user.id, name: row.user.name, email: row.user.email, isAdmin: source != null, adminSource: source,
      adminSince: row.since, grantedBy: row.by, lastLoginAt: row.user.lastLoginAt,
    }
  }

  static async setAdmin(actor: User, id: string, admin: boolean): Promise<UserRow> {
    const [target] = await db.select().from(users).where(eq(users.id, id))
    if (!target) throw new NotFoundError('User')
    if (admin) await this.grant(actor, target)
    else await this.revoke(actor, target)
    return this.one(id)
  }

  private static async grant(actor: User, target: User) {
    await db.transaction(async (tx) => {
      // Serialises writers so two admins cannot race each other into an inconsistent list.
      await tx.execute(sql`lock table user_admin in exclusive mode`)
      const [has] = await tx.select({ id: userAdmin.userId }).from(userAdmin).where(eq(userAdmin.userId, target.id))
      if (has) return
      const [rows] = await tx.select({ n: count() }).from(userAdmin)
      if ((rows?.n ?? 0) === 0 && env.adminEmails.length) {
        // The first grant ends the ADMIN_EMAILS fallback, so admins who only exist there (and have signed in) move into
        // the table first. Otherwise they would lose access the moment someone else is added.
        const fromEnv = await tx.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.email})`, env.adminEmails))
        if (fromEnv.length) await tx.insert(userAdmin).values(fromEnv.map((u) => ({ userId: u.id, grantedBy: null }))).onConflictDoNothing()
      }
      await tx.insert(userAdmin).values({ userId: target.id, grantedBy: actor.id }).onConflictDoNothing()
    })
  }

  private static async revoke(actor: User, target: User) {
    if (target.id === actor.id) throw new BadRequestError('You cannot remove your own admin access. Ask another admin.')
    await db.transaction(async (tx) => {
      await tx.execute(sql`lock table user_admin in exclusive mode`)
      const [rows] = await tx.select({ n: count() }).from(userAdmin)
      const total = rows?.n ?? 0
      if (total === 0) {
        if (emailInAdminEnv(target.email)) {
          throw new AppError(409, 'This person is an admin only through ADMIN_EMAILS. Make another admin first, then manage the list here.', 'ADMIN_FROM_ENV')
        }
        return // not an admin
      }
      const [has] = await tx.select({ id: userAdmin.userId }).from(userAdmin).where(eq(userAdmin.userId, target.id))
      if (!has) return
      if (total === 1) throw new BadRequestError('This is the last admin. Make someone else admin first.')
      await tx.delete(userAdmin).where(and(eq(userAdmin.userId, target.id)))
      // The row is gone after this, so the only trace is this line (ids only, no names or emails).
      console.info(`[admin] revoked user_id=${target.id} by user_id=${actor.id}`)
    })
  }
}
