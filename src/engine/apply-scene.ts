import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import type { SceneOutcome } from '../cognition/scene.js'
import { pairKey, type WorldState } from './tick.js'
import { adjustFeeling } from './relationship.js'

/**
 * Closes the loop: what cognition decided becomes world state. Until this runs
 * a resolved scene is just text — the money never moves and nobody's opinion
 * changes.
 */
export function applySceneOutcome(
  state: WorldState,
  aId: AgentId,
  bId: AgentId,
  outcome: SceneOutcome,
): WorldState {
  const agents = state.agents.map((x) => ({ ...x }))
  const a = agents.find((x) => x.id === aId)
  const b = agents.find((x) => x.id === bId)
  if (a == null || b == null) return state

  // Money only moves as far as it actually exists; a scene cannot invent credit.
  const wanted = Math.round(outcome.transfer)
  const moved = wanted >= 0 ? Math.min(wanted, Math.floor(a.money)) : -Math.min(-wanted, Math.floor(b.money))
  a.money -= moved
  b.money += moved

  // A loan moves money *and* leaves an obligation; a transfer only moves money.
  const asked = Math.round(outcome.loan)
  const lent = asked >= 0 ? Math.min(asked, Math.floor(a.money)) : -Math.min(-asked, Math.floor(b.money))
  a.money -= lent
  b.money += lent

  const key = pairKey(aId, bId)
  const prev: Relationship = state.relationships.get(key) ?? {
    affection: 0,
    trust: 0,
    debt: 0,
    grievance: 0,
    encounters: 0,
    lastInteractionTick: null,
  }
  // Relationship rows are keyed by sorted pair, so orient the deltas correctly.
  const aIsFirst = aId < bId
  const relationships = new Map(state.relationships)
  relationships.set(key, {
    affection: adjustFeeling(prev.affection, aIsFirst ? outcome.deltas.aToB.affection : outcome.deltas.bToA.affection),
    trust: adjustFeeling(prev.trust, aIsFirst ? outcome.deltas.aToB.trust : outcome.deltas.bToA.trust),
    // Settling reduces what is owed; lending increases it.
    debt: prev.debt + (aIsFirst ? -moved + lent : moved - lent),
    grievance: prev.grievance,
    encounters: prev.encounters,
    lastInteractionTick: state.tick,
  })

  a.activity = null
  b.activity = null
  return { ...state, agents, relationships }
}

/** Frees a pair whose scene could not be resolved, leaving no trace. */
export function abandonScene(state: WorldState, aId: AgentId, bId: AgentId): WorldState {
  return {
    ...state,
    agents: state.agents.map((x) =>
      x.id === aId || x.id === bId ? { ...x, activity: null } : x,
    ) as Agent[],
  }
}
