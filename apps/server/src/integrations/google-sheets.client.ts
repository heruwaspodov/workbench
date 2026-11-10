import { GoogleAuth } from 'google-auth-library'
import { env } from '../config/env'
import { AppError, IntegrationError } from '../shared/errors'

let auth: GoogleAuth | undefined
const getAuth = () => {
  if (!env.googleServiceAccountJson) {
    throw new AppError(503, 'Google service account is not configured. Upload an .xlsx export instead.', 'GOOGLE_NOT_CONFIGURED')
  }
  auth ??= new GoogleAuth({
    credentials: JSON.parse(env.googleServiceAccountJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return auth
}

async function get<T>(url: string): Promise<T> {
  const client = await getAuth().getClient()
  try {
    const res = await client.request<T>({ url })
    return res.data
  } catch (e: any) {
    const status = e?.response?.status ?? 0
    const hint = status === 403 || status === 404 ? 'share the sheet with the service account email (Viewer)' : e?.message
    throw new IntegrationError('Google Sheets', status, hint)
  }
}

/** Extracts the spreadsheet id from a full URL or returns the input as-is. */
export const parseSpreadsheetId = (input: string) => input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? input.trim()

export const googleSheets = {
  serviceAccountEmail: () => {
    try { return env.googleServiceAccountJson ? (JSON.parse(env.googleServiceAccountJson).client_email as string) : null } catch { return null }
  },

  async tabs(spreadsheetId: string) {
    const data = await get<{ properties: { title: string }; sheets: { properties: { sheetId: number; title: string; index: number } }[] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`)
    return { title: data.properties.title, tabs: data.sheets.map((s) => ({ id: s.properties.sheetId, title: s.properties.title })) }
  },

  async values(spreadsheetId: string, tab: string): Promise<string[][]> {
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z300`)
    const data = await get<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`)
    return (data.values ?? []).map((row) => row.map((c) => (c == null ? '' : String(c))))
  },
}
