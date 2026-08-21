import type { Pool } from 'pg'
import type { Job } from '../server/cognition-worker.js'

/**
 * Durable cognition queue. The work is expensive and slow, so losing it to a
 * restart is not a small thing: an unprocessed reflection means a day of an
 * agent's life is never written down, and nothing ever notices.
 */
export class JobRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: Job): Promise<number> {
    const r = await this.pool.query<{ id: string }>(
      'INSERT INTO cognition_jobs (kind, tick, payload) VALUES ($1,$2,$3) RETURNING id',
      [job.kind, job.tick, JSON.stringify(job)],
    )
    return Number(r.rows[0]?.id ?? 0)
  }

  async done(id: number): Promise<void> {
    await this.pool.query('DELETE FROM cognition_jobs WHERE id = $1', [id])
  }

  async failed(id: number): Promise<void> {
    await this.pool.query('UPDATE cognition_jobs SET attempts = attempts + 1 WHERE id = $1', [id])
  }

  /** Anything still queued from a previous run. Repeatedly failing jobs are
   *  dropped rather than retried forever — a poison job would block the queue. */
  async pending(maxAttempts = 3): Promise<{ id: number; job: Job }[]> {
    await this.pool.query('DELETE FROM cognition_jobs WHERE attempts >= $1', [maxAttempts])
    const r = await this.pool.query<{ id: string; payload: Job }>(
      'SELECT id, payload FROM cognition_jobs ORDER BY tick',
    )
    return r.rows.map((x) => ({ id: Number(x.id), job: x.payload }))
  }

  /**
   * Days that closed without a diary for an agent. Covers the case the queue
   * cannot: a job lost before it was ever written, or a run that crashed
   * between the day rollover and the enqueue.
   */
  async daysMissingDiary(agentIds: readonly string[], currentDay: number, lookback = 3):
      Promise<{ agent: string; day: number }[]> {
    if (agentIds.length === 0 || currentDay <= 1) return []
    const from = Math.max(1, currentDay - lookback)
    const r = await this.pool.query<{ agent_id: string; day: number }>(
      `SELECT a.id AS agent_id, d.day
         FROM unnest($1::text[]) AS a(id)
         CROSS JOIN generate_series($2::int, $3::int) AS d(day)
         LEFT JOIN diaries dd ON dd.agent_id = a.id AND dd.day = d.day
        WHERE dd.agent_id IS NULL`,
      [[...agentIds], from, currentDay - 1],
    )
    return r.rows.map((x) => ({ agent: x.agent_id, day: x.day }))
  }
}
