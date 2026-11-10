import { t } from 'elysia'

export const AuthModel = {
  callbackQuery: t.Object({
    code: t.Optional(t.String()),
    state: t.Optional(t.String()),
    error: t.Optional(t.String()),
    error_description: t.Optional(t.String()),
  }),
  loginQuery: t.Object({ redirect: t.Optional(t.String()) }),
}

export interface OAuthProfile {
  subject: string
  email: string
  name: string
  avatarUrl?: string
}

export const SESSION_COOKIE = 'od_session'
export const OAUTH_STATE_COOKIE = 'od_oauth_state'
export const OAUTH_VERIFIER_COOKIE = 'od_oauth_verifier'
export const OAUTH_REDIRECT_COOKIE = 'od_oauth_redirect'
