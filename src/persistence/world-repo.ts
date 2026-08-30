/**
 * Saving and loading the whole world.
 *
 * A world must survive a restart in two senses: identical state after reload,
 * *and* fifty further ticks agreeing with a run that never stopped. The second
 * matters more — divergent evolution is worse than lost data.
 *
 * Gotchas paid for once and encoded here: JSONB reorders keys, so anything
 * compared must be canonicalised first; `openings` must be nullable because
 * `NULL` means "not a workplace" while `0` means "full"; and Postgres `NUMERIC`
 * comes back as a string.
 */
import type { Pool } from 'pg'
import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import type { Location } from '../world/locations.js'
import type { WorldState } from '../engine/tick.js'
import { pairKey } from '../engine/tick.js'

/**
 * Persists the world so it survives the process. Narrative memory is dbrain's
 * job; this is the state the tick loop owns.
 *
 * Saving is a whole-state upsert rather than a change log: at v0 sizes it costs
 * milliseconds, and a diff-based writer would be a source of subtle drift
 * between what ran and what was stored, which is the one bug class that makes a
 * persisted simulation untrustworthy.
 */
/** Load and save the entire world. Written every game hour, not just at midnight. */
export class WorldRepository {
  constructor(private readonly pool: Pool) {}

  async save(state: WorldState, seed: number, city: unknown): Promise<void> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO world (id, tick, seed, city, updated_at) VALUES (1, $1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET tick = $1, seed = $2, city = $3, updated_at = now()`,
        [state.tick, seed, JSON.stringify(city)],
      )

      for (const l of state.locations) {
        await c.query(
          `INSERT INTO locations (id, kind, name, district, x, y, resident_id, openings)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET openings = $8`,
          [
            l.id,
            l.kind,
            l.name,
            l.district,
            l.tile.x,
            l.tile.y,
            l.residentId ?? null,
            state.openings.has(l.id) ? state.openings.get(l.id) : null,
          ],
        )
      }

      for (const a of state.agents) {
        await c.query(
          `INSERT INTO agents (id,name,owner_id,occupation,money,location_id,arrived_tick,last_theft_tick,
             last_reflection_day,values_json,vices,needs,job,housing,activity,goals,constraints_json,interests,
             deliberation,last_deliberation_tick,last_crisis_tick)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id) DO UPDATE SET
             money=$5, location_id=$6, arrived_tick=$7, last_theft_tick=$8, last_reflection_day=$9,
             values_json=$10, vices=$11, needs=$12, job=$13, housing=$14, activity=$15,
             goals=$16, constraints_json=$17, interests=$18, deliberation=$19, last_deliberation_tick=$20,
             last_crisis_tick=$21`,
          [
            a.id,
            a.name,
            a.ownerId,
            a.occupation,
            a.money,
            a.location,
            a.arrivedTick,
            a.lastTheftTick,
            a.lastReflectionDay,
            JSON.stringify(a.values),
            JSON.stringify(a.vices),
            JSON.stringify(a.needs),
            a.job == null ? null : JSON.stringify(a.job),
            JSON.stringify(a.housing),
            a.activity == null ? null : JSON.stringify(a.activity),
            JSON.stringify(a.goals),
            JSON.stringify(a.constraints),
            JSON.stringify(a.interests),
            a.deliberation == null ? null : JSON.stringify(a.deliberation),
            a.lastDeliberationTick,
            a.lastCrisisTick,
          ],
        )
      }

      for (const [key, r] of state.relationships) {
        const [x, y] = key.split(':')
        await c.query(
          `INSERT INTO relationships (pair_key,agent_a,agent_b,affection,trust,debt,grievance,encounters,last_interaction_tick)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (pair_key) DO UPDATE SET
             affection=$4, trust=$5, debt=$6, grievance=$7, encounters=$8, last_interaction_tick=$9`,
          [key, x, y, r.affection, r.trust, r.debt, r.grievance, r.encounters, r.lastInteractionTick],
        )
      }

      // Day counters are wiped and rewritten: they are small, and a restart
      // mid-day must not hand every pair a fresh conversation budget.
      await c.query('DELETE FROM daily_counters')
      const counters: [string, string, number][] = [
        ...[...state.scenesTodayByAgent].map(([k, v]) => ['scene_agent', k, v] as [string, string, number]),
        ...[...state.scenesTodayByPair].map(([k, v]) => ['scene_pair', k, v] as [string, string, number]),
        ...[...state.passingTodayByPair].map(([k, v]) => ['passing_pair', k, v] as [string, string, number]),
        ...[...state.notableToday].map((k) => ['notable', k, 1] as [string, string, number]),
      ]
      for (const [scope, key, count] of counters) {
        await c.query(
          'INSERT INTO daily_counters (scope,key,count) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [scope, key, count],
        )
      }
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK')
      throw err
    } finally {
      c.release()
    }
  }

  /** Null when the database holds no world yet. */
  async load(): Promise<{ state: WorldState; seed: number; city: unknown } | null> {
    const w = await this.pool.query<{ tick: string; seed: number; city: unknown }>(
      'SELECT tick, seed, city FROM world WHERE id = 1',
    )
    const row = w.rows[0]
    if (row == null) return null

    const locs = await this.pool.query('SELECT * FROM locations')
    const locations: Location[] = locs.rows.map((l) => ({
      id: l.id,
      kind: l.kind,
      name: l.name,
      district: l.district,
      tile: { x: l.x, y: l.y },
      ...(l.resident_id == null ? {} : { residentId: l.resident_id }),
    }))
    const openings = new Map<string, number>(
      locs.rows.filter((l) => l.openings != null).map((l) => [l.id, l.openings]),
    )

    const ags = await this.pool.query('SELECT * FROM agents')
    const agents: Agent[] = ags.rows.map((a) => ({
      id: a.id,
      name: a.name,
      ownerId: a.owner_id,
      occupation: a.occupation,
      values: a.values_json,
      vices: a.vices,
      needs: a.needs,
      money: Number(a.money),
      location: a.location_id,
      job: a.job,
      housing: a.housing,
      activity: a.activity,
      arrivedTick: a.arrived_tick == null ? null : Number(a.arrived_tick),
      lastTheftTick: a.last_theft_tick == null ? null : Number(a.last_theft_tick),
      lastReflectionDay: a.last_reflection_day,
      goals: a.goals,
      constraints: a.constraints_json,
      interests: a.interests ?? [],
      deliberation: a.deliberation ?? null,
      lastDeliberationTick: a.last_deliberation_tick ?? 0,
      lastCrisisTick: a.last_crisis_tick ?? 0,
    }))

    const rels = await this.pool.query('SELECT * FROM relationships')
    const relationships = new Map<string, Relationship>(
      rels.rows.map((r) => [
        r.pair_key,
        {
          affection: r.affection,
          trust: r.trust,
          debt: Number(r.debt),
          grievance: r.grievance,
          encounters: r.encounters,
          lastInteractionTick: r.last_interaction_tick == null ? null : Number(r.last_interaction_tick),
        },
      ]),
    )

    const counters = await this.pool.query('SELECT * FROM daily_counters')
    const pick = (scope: string) =>
      new Map<string, number>(counters.rows.filter((c) => c.scope === scope).map((c) => [c.key, c.count]))

    return {
      seed: row.seed,
      city: row.city,
      state: {
        tick: Number(row.tick),
        agents,
        locations,
        relationships,
        scenesTodayByAgent: pick('scene_agent'),
        scenesTodayByPair: pick('scene_pair'),
        passingTodayByPair: pick('passing_pair'),
        notableToday: new Set<AgentId>(counters.rows.filter((c) => c.scope === 'notable').map((c) => c.key)),
        openings,
      },
    }
  }

  /** Convenience for tests and a fresh start. */
  async reset(): Promise<void> {
    await this.pool.query('TRUNCATE world, locations, agents, relationships, daily_counters RESTART IDENTITY')
  }
}

export { pairKey }
