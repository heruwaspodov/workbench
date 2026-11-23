/**
 * Owner email handling. An address is PII: it is stored lowercase, compared on the server and never sent to the browser.
 * Anything that is not a plain `name@host.tld` is treated as "no email" (for example a display name in the Jira Owner column).
 */
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return v.length <= 254 && EMAIL.test(v) ? v : null
}
