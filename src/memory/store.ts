/**
 * The memory interface — public API for anyone adopting this project.
 *
 * Kept small on purpose, with two implementations that both stay working: the
 * dbrain store for production, and an in-memory one that lets the entire world
 * run with no external services (`PERSIST=0`).
 *
 * Async because the real implementation is over HTTP. The in-memory one
 * satisfies the same shape without awaiting anything, which is the point of
 * having two.
 */
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
/**
 * Episodic memories decay; identity ones do not. Relational state is the third
 * kind conceptually, but it lives denormalised in Postgres because the gate
 * reads it every tick — see documentation/architecture.md.
 */
export type MemoryKind = 'episodic' | 'identity'

/** One remembered thing. `secondHand` marks gossip, which is allowed to be wrong. */
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

/** The whole contract. Two implementations, both kept working. */
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
