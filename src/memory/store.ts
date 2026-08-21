import type { AgentId } from '../agents/agent.js'

/**
 * The memory boundary. dbrain is the reference implementation and the thing
 * this project dogfoods, but the interface exists so an open-source adopter can
 * run the world without standing up a brain first.
 *
 * Only *narrative* memory lives here. Relationship scores stay in the world
 * database: the gate reads them for every co-located pair every tick, and an
 * HTTP hop there would be ruinous. On divergence, this store is the truth.
 */
export type MemoryKind = 'episodic' | 'identity'

export type Memory = {
  agentId: AgentId
  kind: MemoryKind
  text: string
  /** Game tick the memory was formed. */
  tick: number
  /** Who else it concerns, for retrieval when they meet again. */
  about?: AgentId
  /** Heard from someone rather than witnessed — gossip can be wrong. */
  secondHand?: boolean
}

export interface MemoryStore {
  remember(m: Memory): Promise<void>
  /** Everything formed since a tick — the raw material for nightly reflection. */
  since(who: AgentId, tick: number): Promise<Memory[]>
  /**
   * Drop episodic memories older than a tick. DESIGN.md is explicit that the
   * forgetting *is* the realism: a lossless agent behaves like a ledger, not a
   * person. Identity is never forgotten.
   */
  forget(who: AgentId, beforeTick: number): Promise<void>
  /**
   * What `who` can bring to mind about `about`. Bounded hard: unbounded recall
   * is how scene prompts blow up.
   */
  recall(who: AgentId, about: AgentId, limit?: number): Promise<Memory[]>
  /** The agent's sense of self: owner-authored core plus what life added. */
  identity(who: AgentId): Promise<Memory[]>
}
