import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { connections, type Connection, type User } from '../../db/schema'
import { bitbucket, bitbucketConfigured } from '../../integrations/bitbucket.client'
import { jira, jiraConfigured, type JiraBoard } from '../../integrations/jira.client'
import { cached } from '../../shared/cache'
import { NotConnectedError, NotFoundError } from '../../shared/errors'

const normalize = (email: string) => email.trim().toLowerCase()
const sameEmail = (a: string | null | undefined, b: string) => Boolean(a) && normalize(a!) === normalize(b)
const JIRA_OFF = { jiraAccountId: null, jiraDisplayName: null, jiraVerifiedEmail: null, jiraBoardId: null }
const BITBUCKET_OFF = { bitbucketUuid: null, bitbucketDisplayName: null, bitbucketNickname: null, bitbucketVerifiedAccountId: null }

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
    let notice: string | null = null
    if ((await this.get(user.id)).jiraAccountId && jiraConfigured()) {
      // A link that is not the user's own is removed here, so the page never shows someone else's account as "connected".
      try { await this.requireJira(user) } catch (e) { if (e instanceof NotConnectedError) notice = e.message }
    }
    const c = await this.get(user.id)
    const boardId = c.jiraBoardId ?? env.jira.defaultBoardId ?? null
    const boardName = boardId && c.jiraAccountId && jiraConfigured()
      ? await cached(`jira:board:${boardId}`, 30 * 60_000, () => jira.getBoard(boardId)).then((b) => b.name, () => null)
      : null
    return {
      notice,
      jira: {
        configured: jiraConfigured(),
        baseUrl: env.jira.baseUrl || null,
        accountId: c.jiraAccountId,
        displayName: c.jiraDisplayName,
        boardId,
        boardName,
        boardIsDefault: c.jiraBoardId == null && env.jira.defaultBoardId != null,
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
  /**
   * Links the SSO user to the Jira account with the same email address. The match must be exact and unambiguous:
   * the data is read through a shared service account, so a wrong link would show someone else's work.
   */
  static async autoConnectJira(user: User) {
    const matches = await jira.searchUsers(user.email)
    const exact = matches.filter((u) => u.active !== false && sameEmail(u.emailAddress, user.email))
    if (exact.length !== 1) {
      throw new NotFoundError(exact.length > 1
        ? 'A single Jira account for your Mekari email (several matched)'
        : 'Jira account for your Mekari email (accounts that hide their email cannot be matched automatically)')
    }
    const match = exact[0]!
    // Bitbucket is matched through the Jira account, so it starts over whenever the Jira link changes.
    return this.update(user.id, {
      jiraAccountId: match.accountId, jiraDisplayName: match.displayName, jiraVerifiedEmail: normalize(user.email),
      bitbucketUuid: null, bitbucketDisplayName: null, bitbucketNickname: null, bitbucketVerifiedAccountId: null,
    })
  }

  static disconnectJira = (user: User) => this.update(user.id, { ...JIRA_OFF, ...BITBUCKET_OFF })

  /**
   * Board search: a pasted Jira board URL or numeric id resolves that board; a project key (e.g. MESIGN)
   * lists the project's boards in addition to name matches; anything else is a name search.
   */
  static async listBoards(q?: string) {
    const term = q?.trim() ?? ''
    const shape = (b: JiraBoard) => ({
      id: b.id, name: b.name, type: b.type, project: b.location?.projectKey ?? b.location?.displayName ?? null,
    })
    if (!term) return (await jira.listBoards()).values.map(shape)

    const boardId = term.match(/\/boards\/(\d+)/)?.[1] ?? (/^\d+$/.test(term) ? term : undefined)
    if (boardId) return jira.getBoard(Number(boardId)).then((b) => [shape(b)], () => [])

    const searches = [jira.listBoards(term)]
    // A word that is not a real project key makes Jira answer 400; that must not break the name search.
    if (/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(term)) searches.push(jira.listBoards(undefined, term.toUpperCase()).catch(() => ({ values: [] as JiraBoard[] })))
    const found = new Map<number, JiraBoard>()
    for (const res of await Promise.all(searches)) for (const b of res.values) found.set(b.id, b)
    return [...found.values()].map(shape)
  }

  static setBoard = (user: User, boardId: number | null) => this.update(user.id, { jiraBoardId: boardId })

  /**
   * The user's own Jira account id. A link is trusted only with proof that the account's email is the user's SSO email:
   * stored when the link is made, or checked once here for links made before proof was kept. A link that fails is removed.
   */
  static async requireJira(user: User) {
    const c = await this.get(user.id)
    if (!c.jiraAccountId) throw new NotConnectedError('jira')
    if (c.jiraVerifiedEmail !== normalize(user.email)) {
      const account = await jira.getUser(c.jiraAccountId)
      if (!sameEmail(account.emailAddress, user.email)) {
        await this.update(user.id, { ...JIRA_OFF, ...BITBUCKET_OFF })
        throw new NotConnectedError('jira', 'Your Jira link was removed because that Jira account does not have your Mekari email (or hides it). Connect again from Connections.')
      }
      await this.update(user.id, { jiraVerifiedEmail: normalize(user.email) })
    }
    return { accountId: c.jiraAccountId, boardId: c.jiraBoardId ?? env.jira.defaultBoardId ?? null }
  }

  // ---------- Bitbucket ----------
  /** Bitbucket and Jira share the Atlassian account id: the member whose account id equals the user's verified Jira account. */
  static async autoConnectBitbucket(user: User) {
    if (!(await this.get(user.id)).jiraAccountId) {
      throw new NotConnectedError('jira', 'Connect Jira first: your Bitbucket account is matched through your Jira account.')
    }
    const { accountId } = await this.requireJira(user)
    const member = (await membersCached()).find((m) => m.account_id === accountId)
    if (!member) throw new NotFoundError('Bitbucket workspace member for your Atlassian account')
    return this.update(user.id, {
      bitbucketUuid: member.uuid, bitbucketDisplayName: member.display_name, bitbucketNickname: member.nickname ?? null, bitbucketVerifiedAccountId: accountId,
    })
  }

  static disconnectBitbucket = (user: User) => this.update(user.id, BITBUCKET_OFF)

  /** The user's own Bitbucket uuid: it must belong to the member whose account id is the verified Jira account. */
  static async requireBitbucket(user: User) {
    const c = await this.get(user.id)
    if (!c.bitbucketUuid) throw new NotConnectedError('bitbucket')
    if (!c.jiraAccountId) throw new NotConnectedError('bitbucket', 'Connect Jira first: your Bitbucket account is matched through your Jira account.')
    const { accountId } = await this.requireJira(user)
    if (c.bitbucketVerifiedAccountId !== accountId) {
      const member = (await membersCached()).find((m) => m.uuid === c.bitbucketUuid)
      if (member?.account_id !== accountId) {
        await this.update(user.id, BITBUCKET_OFF)
        throw new NotConnectedError('bitbucket', 'Your Bitbucket link was removed because it is not the account behind your Jira login. Connect again from Connections.')
      }
      await this.update(user.id, { bitbucketVerifiedAccountId: accountId })
    }
    return { uuid: c.bitbucketUuid }
  }
}
