/** Centralised, validated environment config. Fails fast on missing required values. */
const read = (key: string, fallback?: string) => {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}
const required = (key: string) => {
  const v = read(key)
  if (v === undefined) throw new Error(`Missing required env var: ${key}`)
  return v
}
const list = (key: string) =>
  (read(key) ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

const appUrl = read('APP_URL', 'http://localhost:5173')!

export const env = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(read('PORT', '3000')),
  appUrl,
  databaseUrl: required('DATABASE_URL'),
  sessionTtlDays: Number(read('SESSION_TTL_DAYS', '7')),

  oauth: {
    authorizeUrl: read('MEKARI_OAUTH_AUTHORIZE_URL'),
    tokenUrl: read('MEKARI_OAUTH_TOKEN_URL'),
    userinfoUrl: read('MEKARI_OAUTH_USERINFO_URL'),
    clientId: read('MEKARI_OAUTH_CLIENT_ID'),
    clientSecret: read('MEKARI_OAUTH_CLIENT_SECRET'),
    scope: read('MEKARI_OAUTH_SCOPE', 'openid profile email')!,
    /** Must match the redirect URI registered in Mekari SSO exactly. */
    redirectUri: read('MEKARI_OAUTH_REDIRECT_URI') ?? `${appUrl.replace(/\/$/, '')}/sso-callback`,
    usePkce: read('MEKARI_OAUTH_PKCE', 'true') === 'true',
  },
  adminEmails: list('ADMIN_EMAILS'),
  allowedDomains: list('ALLOWED_EMAIL_DOMAINS'),
  /** Dev only: bypass OAuth with a fixed user. Ignored in production. */
  devLoginEmail: read('DEV_LOGIN_EMAIL'),

  jira: {
    baseUrl: read('JIRA_BASE_URL', '')!.replace(/\/$/, ''),
    email: read('JIRA_EMAIL'),
    apiToken: read('JIRA_API_TOKEN'),
    defaultBoardId: read('JIRA_BOARD_ID') ? Number(read('JIRA_BOARD_ID')) : undefined,
    storyPointField: read('JIRA_STORY_POINT_FIELD', 'customfield_10016')!,
  },
  bitbucket: {
    apiUrl: read('BITBUCKET_API_URL', 'https://api.bitbucket.org/2.0')!.replace(/\/$/, ''),
    workspace: read('BITBUCKET_WORKSPACE'),
    accessToken: read('BITBUCKET_ACCESS_TOKEN'),
    email: read('BITBUCKET_EMAIL'),
    apiToken: read('BITBUCKET_API_TOKEN'),
  },
  googleServiceAccountJson: read('GOOGLE_SERVICE_ACCOUNT_JSON'),
} as const
