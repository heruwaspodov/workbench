import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray, like } from 'drizzle-orm'
import { PeriodExistsError } from '../src/shared/errors'
import { parsePeriod } from '../src/shared/period'
import { setupTestDb } from './db'

const tag = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let ctx: Awaited<ReturnType<typeof setupTestDb>>
let S: typeof import('../src/db/schema')
let Plans: typeof import('../src/modules/pgp/plan.service').PlanService
const tplIds: string[] = []
let seq = 0

beforeAll(async () => {
  ctx = await setupTestDb()
  S = await import('../src/db/schema')
  Plans = (await import('../src/modules/pgp/plan.service')).PlanService
})

afterAll(async () => {
  await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  if (tplIds.length) await ctx.db.delete(S.templates).where(inArray(S.templates.id, tplIds))
})

const user = async () => (await ctx.db.insert(S.users).values({ email: `${tag}-${++seq}@test.local`, name: `${tag} u${seq}` }).returning())[0]!
const template = async (period: string) => {
  const [t] = await ctx.db.insert(S.templates).values({ title: `${tag} ${period}`, period, status: 'published' }).returning()
  tplIds.push(t!.id)
  return t!
}

describe('parsePeriod', () => {
  test('accepts YYYY-Qn only', () => {
    expect(parsePeriod('2026-Q3')).toEqual({ year: 2026, quarter: 3 })
    for (const bad of ['2026-Q5', '2026-Q0', '26-Q1', '2026Q1', 'Q3-2026', '']) expect(parsePeriod(bad)).toBeNull()
  })
})

describe('one plan per user per quarter', () => {
  test('plan from template stores year and quarter and exposes the period', async () => {
    const u = await user()
    const plan = await Plans.create(u, (await template('2098-Q3')).id)
    expect([plan.year, plan.quarter, plan.period]).toEqual([2098, 3, '2098-Q3'])
  })

  test('a second template for the same quarter is rejected with the existing plan id', async () => {
    const u = await user()
    const first = await Plans.create(u, (await template('2097-Q2')).id)
    const err = await Plans.create(u, (await template('2097-Q2')).id).catch((e) => e)
    expect(err).toBeInstanceOf(PeriodExistsError)
    expect(err.status).toBe(409)
    expect(err.existingPlanId).toBe(first.id)
  })

  test('another user, or another quarter, is allowed', async () => {
    const a = await user()
    const b = await user()
    const t = await template('2096-Q1')
    await Plans.create(a, t.id)
    await Plans.create(b, t.id)
    await Plans.create(a, (await template('2096-Q2')).id)
  })

  test('a plan without a template works and still owns its quarter', async () => {
    const u = await user()
    const [p] = await ctx.db.insert(S.plans).values({ userId: u.id, year: 2095, quarter: 4, sourceRef: 'x.xlsx#Q4' }).returning()
    const got = await Plans.get(p!.id, u)
    expect([got.template, got.title, got.period]).toEqual([null, 'PGP 2095-Q4', '2095-Q4'])
    expect((await Plans.listMine(u))[0]!.templateTitle).toBe('PGP 2095-Q4')
    await expect((async () => { await ctx.db.insert(S.plans).values({ userId: u.id, year: 2095, quarter: 4 }) })()).rejects.toThrow()
    const err = await Plans.create(u, (await template('2095-Q4')).id).catch((e) => e)
    expect(err.existingPlanId).toBe(p!.id)
  })

  test('a template with a malformed period cannot start a plan', async () => {
    const u = await user()
    await expect(Plans.create(u, (await template('Q4 2026')).id)).rejects.toThrow(/YYYY-Qn/)
  })

  test('quarter outside 1-4 is rejected by the database', async () => {
    const u = await user()
    await expect((async () => { await ctx.db.insert(S.plans).values({ userId: u.id, year: 2094, quarter: 5 }) })()).rejects.toThrow()
  })
})
