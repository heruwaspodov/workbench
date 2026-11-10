import { asc, desc, eq, inArray, notInArray, and, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { plans, templateItems, templates, users, type User } from '../../db/schema'
import { googleSheets, parseSpreadsheetId } from '../../integrations/google-sheets.client'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import type { TemplateItemInputT } from './model'
import { parsePgpSheet, type ParsedSheet } from './sheet-parser'

const toItemRow = (templateId: string) => (i: TemplateItemInputT, position: number) => ({
  templateId,
  position,
  companyOkr: i.companyOkr ?? null,
  objective: i.objective,
  keyResult: i.keyResult,
  weight: i.weight,
  initiative: i.initiative,
})

const safeParse = (rows: string[][]): ParsedSheet => {
  try { return parsePgpSheet(rows) } catch (e) { throw new BadRequestError((e as Error).message) }
}

export abstract class TemplateService {
  static async list(user: User) {
    const rows = await db
      .select({
        id: templates.id, title: templates.title, period: templates.period, status: templates.status,
        source: templates.source, updatedAt: templates.updatedAt,
        // fully-qualified: an unqualified "id" would bind to the subquery's own table
        itemCount: sql<number>`(select count(*)::int from pgp_template_items ti where ti.template_id = "pgp_templates"."id")`,
        totalWeight: sql<number>`(select coalesce(sum(ti.weight),0)::float from pgp_template_items ti where ti.template_id = "pgp_templates"."id")`,
      })
      .from(templates)
      .where(user.role === 'admin' ? undefined : eq(templates.status, 'published'))
      .orderBy(desc(templates.period), desc(templates.updatedAt))
    return rows
  }

  static async get(id: string, user?: User) {
    const tpl = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      with: { items: { orderBy: [asc(templateItems.position)] } },
    })
    if (!tpl || (user && user.role !== 'admin' && tpl.status !== 'published')) throw new NotFoundError('Template')
    return tpl
  }

  static async create(user: User, input: { title: string; period: string; source?: 'scratch' | 'google_sheet' | 'xlsx'; sourceRef?: string; items?: TemplateItemInputT[] }) {
    return db.transaction(async (tx) => {
      const [tpl] = await tx.insert(templates).values({
        title: input.title, period: input.period, source: input.source ?? 'scratch', sourceRef: input.sourceRef, createdBy: user.id,
      }).returning()
      if (input.items?.length) await tx.insert(templateItems).values(input.items.map(toItemRow(tpl!.id)))
      return tpl!
    })
  }

  static async update(id: string, patch: { title?: string; period?: string; status?: 'draft' | 'published' | 'archived' }) {
    const [tpl] = await db.update(templates).set(patch).where(eq(templates.id, id)).returning()
    if (!tpl) throw new NotFoundError('Template')
    return tpl
  }

  static async remove(id: string) {
    const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(plans).where(eq(plans.templateId, id))
    if (count > 0) throw new BadRequestError('Template already has plans — archive it instead')
    await db.delete(templates).where(eq(templates.id, id))
    return { ok: true }
  }

  /** Upsert by id, insert new, delete removed — keeps ids stable so plans stay linked. */
  static async replaceItems(id: string, items: TemplateItemInputT[]) {
    await this.get(id)
    await db.transaction(async (tx) => {
      const keepIds = items.map((i) => i.id).filter((x): x is string => Boolean(x))
      await tx.delete(templateItems).where(and(eq(templateItems.templateId, id), keepIds.length ? notInArray(templateItems.id, keepIds) : undefined))
      const existing = keepIds.length
        ? new Set((await tx.select({ id: templateItems.id }).from(templateItems).where(and(eq(templateItems.templateId, id), inArray(templateItems.id, keepIds)))).map((r) => r.id))
        : new Set<string>()
      const toRow = toItemRow(id)
      for (const [pos, item] of items.entries()) {
        if (item.id && existing.has(item.id)) await tx.update(templateItems).set(toRow(item, pos)).where(eq(templateItems.id, item.id))
        else await tx.insert(templateItems).values(toRow(item, pos))
      }
      await tx.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, id))
    })
    return this.get(id)
  }

  static async plansOf(id: string) {
    return db
      .select({
        planId: plans.id, status: plans.status, userName: users.name, userEmail: users.email, updatedAt: plans.updatedAt,
        score: sql<number>`(select coalesce(sum(least(coalesce(pi.achievement,0), pi.weight)),0)::float from pgp_plan_items pi where pi.plan_id = "pgp_plans"."id")`,
      })
      .from(plans)
      .innerJoin(users, eq(users.id, plans.userId))
      .where(eq(plans.templateId, id))
      .orderBy(asc(users.name))
  }

  // ---------- import ----------
  static sheetTabs = async (url: string) => ({
    ...(await googleSheets.tabs(parseSpreadsheetId(url))),
    serviceAccount: googleSheets.serviceAccountEmail(),
  })

  static async previewSheet(url: string, tab: string) {
    const id = parseSpreadsheetId(url)
    return { sourceRef: `https://docs.google.com/spreadsheets/d/${id}#${tab}`, ...safeParse(await googleSheets.values(id, tab)) }
  }
}
