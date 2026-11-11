import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { like } from 'drizzle-orm'
import { BadRequestError, NotConnectedError } from '../src/shared/errors'
import { setupTestDb } from './db'

// Synthetic users only. A user's team label is their own setting and needs a verified Jira link.
const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

describe('team label in Connections', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>
  let S: typeof import('../src/db/schema')
  let Svc: typeof import('../src/modules/connections/service').ConnectionsService
  let handler: { handle: (r: Request) => Response | Promise<Response> }
  let linked: typeof import('../src/db/schema').users.$inferSelect
  let other: typeof import('../src/db/schema').users.$inferSelect
  let loner: typeof import('../src/db/schema').users.$inferSelect

  beforeAll(async () => {
    ctx = await setupTestDb()
    S = await import('../src/db/schema')
    Svc = (await import('../src/modules/connections/service')).ConnectionsService
    handler = (await import('../src/app')).app
    const mk = async (n: string) => (await ctx.db.insert(S.users).values({ email: `${tag}-${n}@test.local`, name: n }).returning())[0]!
    linked = await mk('linked'); other = await mk('other'); loner = await mk('loner')
    for (const u of [linked, other]) await ctx.db.insert(S.connections).values({ userId: u.id, jiraAccountId: `acct-${tag}-${u.name}`, jiraVerifiedEmail: u.email })
  })

  afterAll(async () => {
    await ctx.db.delete(S.users).where(like(S.users.email, `${tag}-%`))
  })

  test('saves, trims, changes and clears the label; the overview returns it', async () => {
    expect((await Svc.overview(linked)).jira.teamLabel).toBeNull()
    await Svc.setTeamLabel(linked, '  Escape ')
    expect((await Svc.overview(linked)).jira.teamLabel).toBe('Escape')
    await Svc.setTeamLabel(linked, 'Intact')
    expect((await Svc.overview(linked)).jira.teamLabel).toBe('Intact')
    await Svc.setTeamLabel(linked, '   ')
    expect((await Svc.overview(linked)).jira.teamLabel).toBeNull()
    await Svc.setTeamLabel(linked, null)
    expect((await Svc.overview(linked)).jira.teamLabel).toBeNull()
  })

  test('a label belongs to its user only', async () => {
    await Svc.setTeamLabel(linked, 'Escape')
    expect((await Svc.overview(other)).jira.teamLabel).toBeNull()
  })

  test('without a Jira link there is nothing to attach it to', async () => {
    await expect(Svc.setTeamLabel(loner, 'Escape')).rejects.toBeInstanceOf(NotConnectedError)
  })

  test('too long is rejected', async () => {
    await expect(Svc.setTeamLabel(linked, 'x'.repeat(101))).rejects.toBeInstanceOf(BadRequestError)
  })

  test('the route needs a session', async () => {
    const res = await handler.handle(new Request('http://localhost/api/connections/jira/team-label', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify({ label: 'x' }),
    }))
    expect([401, 403]).toContain(res.status)
  })
})
