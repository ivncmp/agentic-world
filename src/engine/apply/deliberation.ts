/**
 * Storing an agent's new intent.
 *
 * Deliberation returns dispositions, never actions: biases that `scoreActions`
 * adds to its own scoring, and people the agent would like to run into. A route
 * that returned an action instead would have to run every tick, which is the
 * cost model this project is built to avoid.
 */
import type { AgentId, Deliberation } from '../../agents/agent.js'
import type { WorldState } from '../tick.js'

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
