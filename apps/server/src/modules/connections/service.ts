import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { connections, type Connection, type User } from '../../db/schema'
import { bitbucket, bitbucketConfigured, type BbUser } from '../../integrations/bitbucket.client'
import { jira, jiraConfigured } from '../../integrations/jira.client'
import { cached } from '../../shared/cache'
import { NotConnectedError, NotFoundError } from '../../shared/errors'

const membersCached = () => cached('bb:members', 10 * 60_000, () => bitbucket.members())

export abstract class ConnectionsService {
  static async get(userId: string): Promise<Connection> {
    const [row] = await db.select().from(connections).where(eq(connections.userId, userId))
    if (row) return row
    const [created] = await db.insert(connections).values({ userId }).onConflictDoNothing().returning()
    return created ?? (await this.get(userId))
  }

  private static async update(userId: string, patch: Partial<Connection>) {
    await this.get(userId)
    const [row] = await db.update(connections).set(patch).where(eq(connections.userId, userId)).returning()
    return row!
  }

  static async overview(user: User) {
    const c = await this.get(user.id)
    return {
      jira: {
        configured: jiraConfigured(),
        baseUrl: env.jira.baseUrl || null,
        accountId: c.jiraAccountId,
        displayName: c.jiraDisplayName,
        boardId: c.jiraBoardId ?? env.jira.defaultBoardId ?? null,
      },
      bitbucket: {
        configured: bitbucketConfigured(),
        workspace: env.bitbucket.workspace ?? null,
        uuid: c.bitbucketUuid,
        displayName: c.bitbucketDisplayName,
        nickname: c.bitbucketNickname,
      },
    }
  }

  // ---------- Jira ----------
  static async autoConnectJira(user: User) {
    const matches = await jira.searchUsers(user.email)
    const exact = matches.find((u) => u.emailAddress?.toLowerCase() === user.email) ?? (matches.length === 1 ? matches[0] : undefined)
    if (!exact) throw new NotFoundError(`Jira account for ${user.email}`)
    return this.update(user.id, { jiraAccountId: exact.accountId, jiraDisplayName: exact.displayName })
  }

  static searchJiraUsers = async (q: string) =>
    (await jira.searchUsers(q)).filter((u) => u.active !== false).map((u) => ({
      accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.['48x48'] ?? null,
    }))

  static async setJira(user: User, accountId: string) {
    const u = await jira.getUser(accountId)
    return this.update(user.id, { jiraAccountId: u.accountId, jiraDisplayName: u.displayName })
  }

  static disconnectJira = (user: User) => this.update(user.id, { jiraAccountId: null, jiraDisplayName: null, jiraBoardId: null })

  static listBoards = async (q?: string) =>
    (await jira.listBoards(q || undefined)).values.map((b) => ({
      id: b.id, name: b.name, type: b.type, project: b.location?.projectKey ?? b.location?.displayName ?? null,
    }))

  static setBoard = (user: User, boardId: number | null) => this.update(user.id, { jiraBoardId: boardId })

  static async requireJira(user: User) {
    const c = await this.get(user.id)
    if (!c.jiraAccountId) throw new NotConnectedError('jira')
    return { accountId: c.jiraAccountId, boardId: c.jiraBoardId ?? env.jira.defaultBoardId ?? null }
  }

  // ---------- Bitbucket ----------
  /** Bitbucket and Jira share the Atlassian account id, so we can match without asking the user. */
  static async autoConnectBitbucket(user: User) {
    const c = await this.get(user.id)
    const members = await membersCached()
    const byAccount = c.jiraAccountId ? members.find((m) => m.account_id === c.jiraAccountId) : undefined
    const byName = members.filter((m) => m.display_name.toLowerCase() === user.name.toLowerCase())
    const match = byAccount ?? (byName.length === 1 ? byName[0] : undefined)
    if (!match) throw new NotFoundError(`Bitbucket member for ${user.name} (connect Jira first or pick manually)`)
    return this.saveBitbucket(user, match)
  }

  static async searchBitbucketMembers(q = '') {
    const needle = q.toLowerCase()
    return (await membersCached())
      .filter((m) => !needle || m.display_name.toLowerCase().includes(needle) || m.nickname?.toLowerCase().includes(needle))
      .slice(0, 30)
      .map((m) => ({ uuid: m.uuid, displayName: m.display_name, nickname: m.nickname ?? null, avatarUrl: m.links?.avatar?.href ?? null }))
  }

  static async setBitbucket(user: User, uuid: string) {
    const member = (await membersCached()).find((m) => m.uuid === uuid)
    if (!member) throw new NotFoundError('Bitbucket workspace member')
    return this.saveBitbucket(user, member)
  }

  private static saveBitbucket = (user: User, m: BbUser) =>
    this.update(user.id, { bitbucketUuid: m.uuid, bitbucketDisplayName: m.display_name, bitbucketNickname: m.nickname ?? null })

  static disconnectBitbucket = (user: User) =>
    this.update(user.id, { bitbucketUuid: null, bitbucketDisplayName: null, bitbucketNickname: null })

  static async requireBitbucket(user: User) {
    const c = await this.get(user.id)
    if (!c.bitbucketUuid) throw new NotConnectedError('bitbucket')
    return { uuid: c.bitbucketUuid }
  }
}
