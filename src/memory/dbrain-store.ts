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
 * Field names come from probing a live instance, not from the README: facts are
 * created with `fact` (not `content`), and an entity needs a `category`.
 *
 * dbrain has no free-form tags, so our metadata maps onto the three fields it
 * does have. Fighting that and inventing a tag convention in the text would
 * make the facts unreadable in dbrain's own dashboard, which defeats the point
 * of dogfooding it.
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

type DbrainFact = {
  fact: string
  category?: string
  related_entities?: string[]
  timestamp?: string
}

/**
 * Game ticks become real instants, so dbrain's own ordering, tiering and decay
 * work on them unmodified and the dashboard stays legible. The calendar comes
 * from the shared clock — this module used to define its own epoch, which left
 * memories stamped years away from the world that formed them.
 */
export const tickToStamp = (tick: number): string => worldTime(tick).toISOString()

export const stampToTick = (stamp: string): number => {
  const ms = Date.parse(stamp)
  if (!Number.isFinite(ms)) return 0
  return tickAt(ms)
}

/** Second-hand memories are their own category: gossip can be wrong, and the
 *  scene prompt needs to know which is which. */
const categoryFor = (kind: MemoryKind, secondHand: boolean): string =>
  secondHand ? 'hearsay' : kind

export class DbrainStore implements MemoryStore {
  private readonly known = new Set<AgentId>()

  constructor(private readonly opts: DbrainOptions) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.opts.url}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.token}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    })
    if (!res.ok) throw new Error(`dbrain ${res.status} on ${path}: ${await res.text()}`)
    return (await res.json()) as T
  }

  /** Idempotent: an existing entity is left alone. */
  async ensureAgent(id: AgentId, name: string): Promise<void> {
    if (this.known.has(id)) return
    try {
      await this.call('/entities', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name,
          type: 'person',
          category: this.opts.category ?? 'agents',
        }),
      })
    } catch {
      // Already there, which is the common case on restart.
    }
    this.known.add(id)
  }

  async remember(m: Memory): Promise<void> {
    await this.call(`/entities/${encodeURIComponent(m.agentId)}/facts`, {
      method: 'POST',
      body: JSON.stringify({
        fact: m.text,
        category: categoryFor(m.kind, m.secondHand === true),
        ...(m.about == null ? {} : { relatedEntities: [m.about] }),
        timestamp: tickToStamp(m.tick),
      }),
    })
  }

  private async facts(who: AgentId): Promise<DbrainFact[]> {
    try {
      const e = await this.call<{ facts?: DbrainFact[] }>(`/entities/${encodeURIComponent(who)}`)
      return e.facts ?? []
    } catch {
      return []
    }
  }

  private static parse(who: AgentId, f: DbrainFact): Memory {
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

  async recall(who: AgentId, about: AgentId, limit = 6): Promise<Memory[]> {
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
    return (await this.facts(who))
      .map((f) => DbrainStore.parse(who, f))
      .filter((m) => m.kind === 'identity')
  }

  /**
   * dbrain has its own tiering and compaction, so forgetting is delegated
   * rather than reimplemented — deleting facts underneath it would fight its
   * decay model instead of using it.
   */
  async forget(_who: AgentId, _beforeTick: number): Promise<void> {
    // Intentionally a no-op: see above. Consolidation still happens, because
    // reflection writes one summary fact per day and dbrain demotes the rest.
  }
}
