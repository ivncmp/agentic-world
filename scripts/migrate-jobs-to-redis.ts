/**
 * One-shot migration: move pending cognition_jobs from Postgres to Redis (BullMQ).
 * Run once, then apply migration 007 to drop the table.
 *
 * Usage: npx tsx scripts/migrate-jobs-to-redis.ts
 */
import pg from 'pg'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

const KIND_PRIORITY: Record<string, number> = {
  reflection: 1,
  deliberation: 2,
  crisis: 3,
  scene: 4,
}

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5532),
  user: process.env.POSTGRES_USER ?? 'aw',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB ?? 'agentic_world',
})

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6479'
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })

const queue = new Queue('cognition', {
  connection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
})

const res = await pool.query<{ id: string; kind: string; payload: unknown }>(
  'SELECT id, kind, payload FROM cognition_jobs ORDER BY tick',
)

console.log(`Found ${res.rows.length} pending jobs in cognition_jobs`)

for (const row of res.rows) {
  const kind = row.kind
  const priority = KIND_PRIORITY[kind] ?? 4
  await queue.add(kind, row.payload, { priority })
  console.log(`  migrated job #${row.id} (${kind})`)
}

console.log(`\nDone — ${res.rows.length} jobs migrated to Redis.`)
console.log('Now apply migration 007_drop_cognition_jobs.sql to drop the table.')

await queue.close()
await connection.quit()
await pool.end()
