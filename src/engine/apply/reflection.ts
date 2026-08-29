import type { AgentId, Relationship } from '../../agents/agent.js'
import type { ReflectionOutcome } from '../../cognition/reflection.js'
import { clampAxis } from '../../agents/values.js'
import { pairKey, type WorldState } from '../tick.js'
import { adjustFeeling } from '../relationship.js'

/**
 * Writes a night's conclusions into the world. This is the only place
 * `values.drift` is ever written: the stratum recording what living did to
 * someone, as distinct from how their owner authored them or last advised them.
 *
 * Drift accumulates without limit by design — it is allowed to overpower an
 * owner's `base`, because an agent whose life contradicts how they were written
 * is the story working rather than a bug.
 */
export function applyReflection(
  state: WorldState,
  agentId: AgentId,
  outcome: ReflectionOutcome,
): WorldState {
  const agents = state.agents.map((a) => {
    if (a.id !== agentId) return a
    const drift = { ...a.values.drift }
    for (const [axis, delta] of Object.entries(outcome.drift)) {
      const key = axis as keyof typeof drift
      drift[key] = clampAxis(drift[key] + (delta ?? 0))
    }
    return { ...a, values: { ...a.values, drift } }
  })

  const relationships = new Map(state.relationships)
  for (const r of outcome.relationships) {
    if (r.agent === agentId) continue
    const key = pairKey(agentId, r.agent)
    const prev: Relationship = relationships.get(key) ?? {
      affection: 0,
      trust: 0,
      debt: 0,
      grievance: 0,
      encounters: 0,
      lastInteractionTick: null,
    }
    relationships.set(key, {
      ...prev,
      affection: adjustFeeling(prev.affection, r.affection),
      trust: adjustFeeling(prev.trust, r.trust),
    })
  }

  return { ...state, agents, relationships }
}
