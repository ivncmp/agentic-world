import type { AgentId } from '../agents/agent.js'
import type { Memory, MemoryStore } from './store.js'

/** For tests and for running the world without a brain. */
export class InMemoryStore implements MemoryStore {
  private readonly memories: Memory[] = []

  async remember(m: Memory): Promise<void> {
    this.memories.push(m)
  }

  async recall(who: AgentId, about: AgentId, limit = 10): Promise<Memory[]> {
    return this.memories
      .filter((m) => m.agentId === who && m.about === about)
      .sort((a, b) => b.tick - a.tick)
      .slice(0, limit)
  }

  async since(who: AgentId, tick: number): Promise<Memory[]> {
    return this.memories.filter((m) => m.agentId === who && m.tick >= tick && m.kind === 'episodic')
  }

  async forget(who: AgentId, beforeTick: number): Promise<void> {
    for (let i = this.memories.length - 1; i >= 0; i--) {
      const m = this.memories[i]
      if (m != null && m.agentId === who && m.kind === 'episodic' && m.tick < beforeTick) {
        this.memories.splice(i, 1)
      }
    }
  }

  async identity(who: AgentId): Promise<Memory[]> {
    return this.memories.filter((m) => m.agentId === who && m.kind === 'identity')
  }

  get all(): readonly Memory[] {
    return this.memories
  }
}
