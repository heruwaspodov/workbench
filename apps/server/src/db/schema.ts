import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn, check, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, index,
} from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('user_role', ['admin', 'member'])
export const templateStatusEnum = pgEnum('template_status', ['draft', 'published', 'archived'])
export const templateSourceEnum = pgEnum('template_source', ['scratch', 'google_sheet', 'xlsx'])
export const planStatusEnum = pgEnum('plan_status', ['draft', 'submitted'])
export const itemStatusEnum = pgEnum('item_status', ['not_started', 'on_track', 'at_risk', 'done', 'not_achieved'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  oauthSubject: text('oauth_subject'),
  role: roleEnum('role').default('member').notNull(),
  /** Active direct leader. Pending requests live in `reporting_requests`. */
  managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index('users_manager_idx').on(t.managerId),
  check('users_manager_not_self', sql`${t.managerId} <> ${t.id}`),
])

/** Unconfirmed leader/report link. `requested_by` is the side that proposed it; the other side must confirm. */
export const reportingRequests = pgTable('reporting_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  leaderId: uuid('leader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('reporting_requests_report_uq').on(t.reportId),
  check('reporting_requests_not_self', sql`${t.reportId} <> ${t.leaderId}`),
  check('reporting_requests_requester', sql`${t.requestedBy} in (${t.reportId}, ${t.leaderId})`),
])

export const usersRelations = relations(users, ({ one, many }) => ({
  manager: one(users, { fields: [users.managerId], references: [users.id], relationName: 'reporting_line' }),
  reports: many(users, { relationName: 'reporting_line' }),
}))
export const reportingRequestsRelations = relations(reportingRequests, ({ one }) => ({
  report: one(users, { fields: [reportingRequests.reportId], references: [users.id], relationName: 'request_report' }),
  leader: one(users, { fields: [reportingRequests.leaderId], references: [users.id], relationName: 'request_leader' }),
}))

/** One row per user: their linked Jira / Bitbucket identities and preferences. */
export const connections = pgTable('connections', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  jiraAccountId: text('jira_account_id'),
  jiraDisplayName: text('jira_display_name'),
  jiraBoardId: integer('jira_board_id'),
  bitbucketUuid: text('bitbucket_uuid'),
  bitbucketDisplayName: text('bitbucket_display_name'),
  bitbucketNickname: text('bitbucket_nickname'),
  ...timestamps,
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)])

export const templates = pgTable('pgp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  period: text('period').notNull(), // e.g. "2026-Q4"
  source: templateSourceEnum('source').default('scratch').notNull(),
  sourceRef: text('source_ref'),
  status: templateStatusEnum('status').default('draft').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
})

/** Shared item columns between template items and plan items. */
const itemColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  position: integer('position').notNull().default(0),
  companyOkr: text('company_okr'),
  objective: text('objective').notNull().default(''),
  keyResult: text('key_result').notNull().default(''),
  weight: numeric('weight', { precision: 6, scale: 2, mode: 'number' }).notNull().default(0),
  initiative: text('initiative').notNull().default(''),
}

export const templateItems = pgTable('pgp_template_items', {
  ...itemColumns,
  templateId: uuid('template_id').notNull().references(() => templates.id, { onDelete: 'cascade' }),
}, (t) => [index('template_items_template_idx').on(t.templateId)])

export const plans = pgTable('pgp_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull().references(() => templates.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  division: text('division'),
  sbu: text('sbu'),
  sbuDetail: text('sbu_detail'),
  directLeader: text('direct_leader'),
  status: planStatusEnum('status').default('draft').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex('plans_template_user_uq').on(t.templateId, t.userId)])

export const planItems = pgTable('pgp_plan_items', {
  ...itemColumns,
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  templateItemId: uuid('template_item_id').references(() => templateItems.id, { onDelete: 'set null' }),
  startValue: text('start_value'),
  targetValue: text('target_value'),
  currentValue: text('current_value'),
  /** Achieved points in percentage units, 0..weight (e.g. weight 5 → achievement 3). */
  achievement: numeric('achievement', { precision: 6, scale: 2, mode: 'number' }),
  status: itemStatusEnum('status').default('not_started').notNull(),
  evidenceLinks: jsonb('evidence_links').$type<string[]>().notNull().default([]),
  notes: text('notes'),
}, (t) => [index('plan_items_plan_idx').on(t.planId)])

export const templatesRelations = relations(templates, ({ many }) => ({ items: many(templateItems) }))
export const templateItemsRelations = relations(templateItems, ({ one }) => ({
  template: one(templates, { fields: [templateItems.templateId], references: [templates.id] }),
}))
export const plansRelations = relations(plans, ({ one, many }) => ({
  template: one(templates, { fields: [plans.templateId], references: [templates.id] }),
  user: one(users, { fields: [plans.userId], references: [users.id] }),
  items: many(planItems),
}))
export const planItemsRelations = relations(planItems, ({ one }) => ({
  plan: one(plans, { fields: [planItems.planId], references: [plans.id] }),
}))

export type User = typeof users.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Template = typeof templates.$inferSelect
export type TemplateItem = typeof templateItems.$inferSelect
export type Plan = typeof plans.$inferSelect
export type PlanItem = typeof planItems.$inferSelect
