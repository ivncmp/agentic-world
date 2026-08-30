/**
 * The Postgres pool and the migration runner.
 *
 * Migrations are numbered SQL files applied in lexicographic order at boot and
 * tracked by **filename** in `schema_migrations`. That means renaming an
 * applied migration makes it run again — which is why `012_owners.sql` is
 * written to be idempotent.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

/**
 * Connection from the environment, matching docker-compose defaults. The
 * connection pool, configured from the environment.
 */
export function makePool(): Pool {
  return new Pool({
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5532),
    user: process.env.POSTGRES_USER ?? 'aw',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'agentic_world',
  })
}

/**
 * Applies every .sql file in migrations/ in name order, once. Deliberately
 * primitive: a migration tool is worth adding when the schema stops moving.
 */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  )
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  )
  const ran: string[] = []
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (applied.has(file)) continue
    await pool.query('BEGIN')
    try {
      await pool.query(readFileSync(join(dir, file), 'utf8'))
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await pool.query('COMMIT')
      ran.push(file)
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }
  return ran
}
