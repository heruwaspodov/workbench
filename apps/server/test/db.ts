import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Points the app at a dedicated test database (never the dev one), creates and migrates it,
 * then loads the db client. Import app modules only after this runs: env is read at import time.
 */
let shared: Promise<{ db: typeof import('../src/db/client').db; sql: typeof import('../src/db/client').sql }> | undefined

/** Cached: test files share one pool, so callers must not end it (bun test exits the process). */
export const setupTestDb = () => (shared ??= init())

async function init() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/one-desk-test')
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!/test/i.test(name)) throw new Error(`Refusing to run DB tests on "${name}": database name must contain "test"`)

  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const admin = postgres(adminUrl.toString(), { max: 1 })
  const [exists] = await admin`select 1 as ok from pg_database where datname = ${name}`
  if (!exists) await admin.unsafe(`create database "${name.replace(/"/g, '""')}"`)
  await admin.end()

  process.env.DATABASE_URL = url.toString()
  const { db, sql } = await import('../src/db/client')
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname })
  return { db, sql }
}
