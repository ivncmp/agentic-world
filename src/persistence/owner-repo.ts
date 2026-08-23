import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'

const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export class OwnerRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Register a new owner. Returns the raw token — this is the only time the
   * caller sees it; the database stores only the SHA-256 hash.
   */
  async register(id: string, name?: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.pool.query(
      `INSERT INTO owners (id, name, secret_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET secret_hash = $3, name = COALESCE(NULLIF($2, ''), owners.name)`,
      [id, name ?? '', hash(token)],
    )
    return token
  }

  async exists(id: string): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM owners WHERE id = $1', [id])
    return (r.rowCount ?? 0) > 0
  }

  async validate(id: string, token: string): Promise<boolean> {
    const r = await this.pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM owners WHERE id = $1',
      [id],
    )
    const row = r.rows[0]
    if (row == null) return false
    return row.secret_hash === hash(token)
  }

  /** Which agents does this owner control? */
  async agentIds(ownerId: string): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      'SELECT id FROM agents WHERE owner_id = $1',
      [ownerId],
    )
    return r.rows.map((row) => row.id)
  }
}
