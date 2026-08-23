import type { AgentId, Deliberation } from '../agents/agent.js'
import type { WorldState } from './tick.js'

export type DeliberationOutcome = {
  biases: Deliberation['biases']
  seekScene: Deliberation['seekScene']
  conversationSeed: string | null
  thought: string
}

export function applyDeliberation(
  state: WorldState,
  agentId: AgentId,
  outcome: DeliberationOutcome,
  tick: number,
): WorldState {
  const agents = state.agents.map((a) => {
    if (a.id !== agentId) return a
    return {
      ...a,
      deliberation: {
        setTick: tick,
        biases: outcome.biases,
        seekScene: outcome.seekScene,
        conversationSeed: outcome.conversationSeed,
      },
    }
  })
  return { ...state, agents }
}
