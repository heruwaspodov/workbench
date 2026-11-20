import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn, boolean, check, date, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, index,
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
  /** Email of the Jira account at the time it was matched to this user's SSO email: proof the link is the user's own. */
  jiraVerifiedEmail: text('jira_verified_email'),
  jiraBoardId: integer('jira_board_id'),
  /** The user's team as a Jira label (e.g. "Escape"): the default for the Team delivery rate card. */
  teamLabel: text('team_label'),
  bitbucketUuid: text('bitbucket_uuid'),
  bitbucketDisplayName: text('bitbucket_display_name'),
  bitbucketNickname: text('bitbucket_nickname'),
  /** Atlassian account id the Bitbucket member was matched on; must equal the verified Jira account id. */
  bitbucketVerifiedAccountId: text('bitbucket_verified_account_id'),
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
  // Null for plans created from an uploaded file (no template).
  templateId: uuid('template_id').references(() => templates.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  quarter: integer('quarter').notNull(),
  sourceRef: text('source_ref'),
  division: text('division'),
  sbu: text('sbu'),
  sbuDetail: text('sbu_detail'),
  directLeader: text('direct_leader'),
  status: planStatusEnum('status').default('draft').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex('plans_template_user_uq').on(t.templateId, t.userId),
  uniqueIndex('plans_user_period_uq').on(t.userId, t.year, t.quarter),
])

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

/** SLA goals for Fast Track tickets, mirroring the Time to SLA configuration in Jira. The first goal that matches a ticket applies. */
export const slaGoals = pgTable('sla_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  /** Jira priority name the goal applies to, e.g. "Medium - P2". */
  priority: text('priority').notNull(),
  /** Label that selects the goal, e.g. "mesign-p2". */
  label: text('label').notNull(),
  calendar: text('calendar').notNull(),
  /** Duration as Jira writes it, e.g. "1d12h". A day is a working day on the "weekdays" calendar and 24 h otherwise. */
  target: text('target').notNull(),
  ...timestamps,
}, (t) => [index('sla_goals_position_idx').on(t.position), check('sla_goals_calendar_chk', sql`${t.calendar} in ('weekdays', 'always')`)])

export type SlaGoal = typeof slaGoals.$inferSelect

/** One Jira epic that belongs to a quarter (Initiatives Hub). Anomalies and resolution are derived, never stored. */
export const initiatives = pgTable('initiatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  quarter: integer('quarter').notNull(),
  /** Where the row came from, e.g. "26Q4.xlsx#26Q4 Initiatives"; null when created by hand. */
  sourceRef: text('source_ref'),
  jiraKey: text('jira_key').notNull(),
  squad: text('squad'),
  title: text('title').notNull(),
  criticality: text('criticality'),
  epicStatus: text('epic_status').notNull().default('To Do'),
  projectStatus: text('project_status'),
  ownerName: text('owner_name'),
  estDeliveryDate: date('est_delivery_date', { mode: 'string' }),
  actualDeliveryDate: date('actual_delivery_date', { mode: 'string' }),
  doneItems: integer('done_items'),
  totalItems: integer('total_items'),
  prdUrl: text('prd_url'),
  rfcUrl: text('rfc_url'),
  /** Owned by the TPM; an import never overwrites a filled value. */
  remark: text('remark'),
  remarkProposed: text('remark_proposed'),
  needsReview: boolean('needs_review').notNull().default(false),
  ...timestamps,
}, (t) => [
  uniqueIndex('initiatives_period_key_uq').on(t.year, t.quarter, t.jiraKey),
  index('initiatives_period_idx').on(t.year, t.quarter),
  check('initiatives_quarter_chk', sql`${t.quarter} between 1 and 4`),
  check('initiatives_items_chk', sql`${t.doneItems} is null or ${t.totalItems} is null or (${t.doneItems} >= 0 and ${t.doneItems} <= ${t.totalItems})`),
])

/** Release / self-test markers shown on the delivery timeline. */
export const initiativeMilestones = pgTable('initiative_milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  initiativeId: uuid('initiative_id').notNull().references(() => initiatives.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  label: text('label'),
}, (t) => [
  index('initiative_milestones_initiative_idx').on(t.initiativeId),
  check('initiative_milestones_kind_chk', sql`${t.kind} in ('release', 'self_test')`),
])

export type Initiative = typeof initiatives.$inferSelect
export type InitiativeMilestone = typeof initiativeMilestones.$inferSelect
