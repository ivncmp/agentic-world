/**
 * The append-only half of persistence: the event log, resolved scenes, diaries,
 * and per-call LLM metering.
 *
 * Diaries live here rather than in dbrain even though they are narrative. The
 * diary is *for the human* and is fetched by agent and day — a lookup. The
 * consolidated memory from the same reflection is *for the agent* and is
 * fetched by relevance, so it goes to dbrain. Same reflection, two artefacts,
 * two access patterns.
 */
import type { Pool } from 'pg'
import type { AgentId } from '../agents/agent.js'
import type { WorldEvent } from '../engine/tick.js'
import type { SceneOutcome } from '../cognition/scene.js'
import type { ReflectionOutcome } from '../cognition/reflection.js'
import { TICKS_PER_DAY } from '../engine/clock.js'

/**
 * What happened, as opposed to what is. The world repository can restore a
 * running simulation; this is what lets it remember having lived.
 */
export class HistoryRepository {
  constructor(private readonly pool: Pool) {}

  private static day = (tick: number): number => Math.floor(tick / TICKS_PER_DAY) + 1

  /**
   * Batched: a busy tick can produce a dozen events and each costs a round trip.
   */
  async recordEvents(events: readonly WorldEvent[]): Promise<void> {
    const rows = events.map(HistoryRepository.toRow).filter((r) => r != null)
    if (rows.length === 0) return
    const values: unknown[] = []
    const tuples = rows.map((r, i) => {
      const o = i * 7
      values.push(r.tick, r.day, r.kind, r.agent, r.other, r.location, r.amount)
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`
    })
    await this.pool.query(
      `INSERT INTO events (tick, day, kind, agent_id, other_id, location_id, amount)
       VALUES ${tuples.join(',')}`,
      values,
    )
  }

  private static toRow(e: WorldEvent): {
    tick: number
    day: number
    kind: string
    agent: string | null
    other: string | null
    location: string | null
    amount: number | null
  } | null {
    const base = { tick: e.tick, day: HistoryRepository.day(e.tick) }
    switch (e.type) {
      case 'theft':
        return { ...base, kind: 'theft', agent: e.thief, other: e.victim, location: null, amount: e.amount }
      case 'rent_missed':
        return {
          ...base,
          kind: 'rent_missed',
          agent: e.agent,
          other: null,
          location: null,
          amount: e.arrears,
        }
      case 'hired':
        return { ...base, kind: 'hired', agent: e.agent, other: null, location: null, amount: null }
      case 'bought_home':
        return { ...base, kind: 'bought_home', agent: e.agent, other: null, location: null, amount: null }
      case 'passing':
        return { ...base, kind: 'passing', agent: e.a, other: e.b, location: e.where, amount: null }
      case 'scene_abandoned':
        return { ...base, kind: 'scene_abandoned', agent: e.a, other: e.b, location: null, amount: null }
      // Actions are per-agent per-tick — persisting them would dwarf everything
      // else and tell us nothing the state does not. scene_started is covered
      // by the scenes table, which keeps the content too.
      default:
        return null
    }
  }

  async recordScene(input: {
    tick: number
    a: AgentId
    b: AgentId
    location: string
    tension: number
    outcome: SceneOutcome
    costUsd: number
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO scenes (tick, day, agent_a, agent_b, location_id, tension, dialogue, outcome, transfer, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.tick,
        HistoryRepository.day(input.tick),
        input.a,
        input.b,
        input.location,
        input.tension,
        JSON.stringify(input.outcome.dialogue),
        input.outcome.outcome,
        input.outcome.transfer,
        input.costUsd,
      ],
    )
  }

  async recordDiary(agentId: AgentId, tick: number, outcome: ReflectionOutcome): Promise<void> {
    await this.pool.query(
      `INSERT INTO diaries (agent_id, day, tick, text, drift) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id, day) DO UPDATE SET text = $4, drift = $5, tick = $3`,
      [agentId, HistoryRepository.day(tick), tick, outcome.diary, JSON.stringify(outcome.drift)],
    )
  }

  async recordCall(input: {
    tick: number
    agentId: AgentId
    purpose: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
    durationMs: number
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_calls (tick, day, agent_id, purpose, provider, model, input_tokens, output_tokens, cost_usd, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.tick,
        HistoryRepository.day(input.tick),
        input.agentId,
        input.purpose,
        input.provider,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.costUsd,
        input.durationMs,
      ],
    )
  }

  async meteringSummary(): Promise<{
    total: { calls: number; inputTokens: number; outputTokens: number; costUsd: number }
    byAgent: { agentId: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }[]
    byPurpose: {
      purpose: string
      calls: number
      inputTokens: number
      outputTokens: number
      costUsd: number
    }[]
    byDay: { day: number; calls: number; costUsd: number }[]
  }> {
    const total = await this.pool.query<{
      calls: string
      input_tokens: string
      output_tokens: string
      cost: string
    }>(
      `SELECT count(*) AS calls, coalesce(sum(input_tokens),0) AS input_tokens,
              coalesce(sum(output_tokens),0) AS output_tokens, coalesce(sum(cost_usd),0) AS cost
       FROM llm_calls`,
    )
    const byAgent = await this.pool.query<{
      agent_id: string
      calls: string
      input_tokens: string
      output_tokens: string
      cost: string
    }>(
      `SELECT agent_id, count(*) AS calls, sum(input_tokens) AS input_tokens,
              sum(output_tokens) AS output_tokens, sum(cost_usd) AS cost
       FROM llm_calls GROUP BY agent_id ORDER BY cost DESC`,
    )
    const byPurpose = await this.pool.query<{
      purpose: string
      calls: string
      input_tokens: string
      output_tokens: string
      cost: string
    }>(
      `SELECT purpose, count(*) AS calls, sum(input_tokens) AS input_tokens,
              sum(output_tokens) AS output_tokens, sum(cost_usd) AS cost
       FROM llm_calls GROUP BY purpose ORDER BY cost DESC`,
    )
    const byDay = await this.pool.query<{ day: string; calls: string; cost: string }>(
      `SELECT day, count(*) AS calls, sum(cost_usd) AS cost
       FROM llm_calls GROUP BY day ORDER BY day`,
    )

    const num = (s: string) => Number(s)
    return {
      total: {
        calls: num(total.rows[0]!.calls),
        inputTokens: num(total.rows[0]!.input_tokens),
        outputTokens: num(total.rows[0]!.output_tokens),
        costUsd: num(total.rows[0]!.cost),
      },
      byAgent: byAgent.rows.map((r) => ({
        agentId: r.agent_id,
        calls: num(r.calls),
        inputTokens: num(r.input_tokens),
        outputTokens: num(r.output_tokens),
        costUsd: num(r.cost),
      })),
      byPurpose: byPurpose.rows.map((r) => ({
        purpose: r.purpose,
        calls: num(r.calls),
        inputTokens: num(r.input_tokens),
        outputTokens: num(r.output_tokens),
        costUsd: num(r.cost),
      })),
      byDay: byDay.rows.map((r) => ({ day: num(r.day), calls: num(r.calls), costUsd: num(r.cost) })),
    }
  }

  // ---- reads: what the owner-facing MCP server will be built on ----

  async diary(agentId: AgentId, day: number): Promise<{ text: string; drift: unknown } | null> {
    const r = await this.pool.query('SELECT text, drift FROM diaries WHERE agent_id=$1 AND day=$2', [
      agentId,
      day,
    ])
    return r.rows[0] ?? null
  }

  async recentDiaries(agentId: AgentId, limit = 7): Promise<{ day: number; text: string }[]> {
    const r = await this.pool.query(
      'SELECT day, text FROM diaries WHERE agent_id=$1 ORDER BY day DESC LIMIT $2',
      [agentId, limit],
    )
    return r.rows
  }

  async scenesFor(agentId: AgentId, limit = 20): Promise<unknown[]> {
    const r = await this.pool.query(
      `SELECT * FROM scenes WHERE agent_a=$1 OR agent_b=$1 ORDER BY tick DESC LIMIT $2`,
      [agentId, limit],
    )
    return r.rows
  }

  async daysMissingDiary(
    agentIds: readonly string[],
    currentDay: number,
    lookback = 3,
  ): Promise<{ agent: string; day: number }[]> {
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

  /**
   * Counts by kind for a day — the shape a briefing needs.
   */
  async daySummary(agentId: AgentId, day: number): Promise<Record<string, number>> {
    const r = await this.pool.query<{ kind: string; n: string }>(
      `SELECT kind, count(*) AS n FROM events
       WHERE day=$1 AND (agent_id=$2 OR other_id=$2) GROUP BY kind`,
      [day, agentId],
    )
    return Object.fromEntries(r.rows.map((x) => [x.kind, Number(x.n)]))
  }
}
