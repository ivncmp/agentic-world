import { randomUUID } from 'node:crypto'
import { DBrainClient, type FactRow } from '@dtoolkit/sdk'
import type { AgentId } from '../agents/agent.js'
import type { Memory, MemoryKind, MemoryStore } from './store.js'
import { worldTime, tickAt } from '../engine/clock.js'

/**
 * dbrain-backed memory. Each agent is an entity; each memory is a fact on it.
 *
 * This is the dogfooding half of the project: dbrain was built as memory for a
 * coding assistant, and driving it as a memory engine for characters stresses
 * it in ways nothing else does — hundreds of small facts per entity, recall on
 * every scene, and decay that has to actually forget.
 *
 *   memory kind  -> fact.category        ('episodic' | 'identity')
 *   about whom   -> fact.relatedEntities (the graph edge dbrain already models)
 *   game tick    -> fact.timestamp       (a real instant; see tickToStamp)
 */
export type DbrainOptions = {
  url: string
  token: string
  /** Entity category everything lands in, so a shared brain stays tidy. */
  category?: string
  timeoutMs?: number
}

export const tickToStamp = (tick: number): string => worldTime(tick).toISOString()

export const stampToTick = (stamp: string): number => {
  const ms = Date.parse(stamp)
  if (!Number.isFinite(ms)) return 0
  return tickAt(ms)
}

const categoryFor = (kind: MemoryKind, secondHand: boolean): string => (secondHand ? 'hearsay' : kind)

export class DbrainStore implements MemoryStore {
  private readonly known = new Set<AgentId>()
  private readonly client: DBrainClient

  constructor(private readonly opts: DbrainOptions) {
    this.client = new DBrainClient({
      baseUrl: opts.url,
      token: opts.token,
      timeoutMs: opts.timeoutMs,
    })
  }

  async ensureAgent(id: AgentId, name: string): Promise<void> {
    if (this.known.has(id)) return
    try {
      await this.client.createEntity({
        id,
        name,
        type: 'person',
        category: this.opts.category ?? 'agents',
      })
    } catch {
      // Already there, which is the common case on restart.
    }
    this.known.add(id)
  }

  async remember(m: Memory): Promise<void> {
    await this.client.addFact(m.agentId, {
      id: randomUUID(),
      fact: m.text,
      category: categoryFor(m.kind, m.secondHand === true),
      ...(m.about == null ? {} : { relatedEntities: [m.about] }),
      timestamp: tickToStamp(m.tick),
    })
  }

  private async facts(who: AgentId): Promise<FactRow[]> {
    try {
      const e = await this.client.getEntity(who)
      return e.facts ?? []
    } catch {
      return []
    }
  }

  private static parse(who: AgentId, f: FactRow): Memory {
    const about = f.related_entities?.[0]
    const hearsay = f.category === 'hearsay'
    return {
      agentId: who,
      kind: f.category === 'identity' ? 'identity' : 'episodic',
      text: f.fact,
      tick: stampToTick(f.timestamp ?? ''),
      ...(about == null ? {} : { about }),
      ...(hearsay ? { secondHand: true } : {}),
    }
  }

  async recall(who: AgentId, about: AgentId, limit = 10): Promise<Memory[]> {
    return (await this.facts(who))
      .map((f) => DbrainStore.parse(who, f))
      .filter((m) => m.about === about)
      .sort((a, b) => b.tick - a.tick)
      .slice(0, limit)
  }

  async since(who: AgentId, tick: number): Promise<Memory[]> {
    return (await this.facts(who))
      .map((f) => DbrainStore.parse(who, f))
      .filter((m) => m.kind === 'episodic' && m.tick >= tick)
  }

  async identity(who: AgentId): Promise<Memory[]> {
    return (await this.facts(who)).map((f) => DbrainStore.parse(who, f)).filter((m) => m.kind === 'identity')
  }

  /**
   * dbrain has its own tiering and compaction, so forgetting is delegated
   * rather than reimplemented — deleting facts underneath it would fight its
   * decay model instead of using it.
   */
  async forget(_who: AgentId, _beforeTick: number): Promise<void> {}
}
