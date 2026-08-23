import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import { viceDef } from '../agents/vices.js'
import type { LocationKind } from '../world/locations.js'

/**
 * The scene gate. Pure TypeScript, runs on every co-located pair every tick,
 * and decides which encounters are worth an expensive LLM call.
 *
 * Scored rather than boolean on purpose: the threshold and the budgets below
 * are the project's cost dial. Turning them up means fewer calls and less
 * drama. Tune here first — never by making the prompt cheaper.
 */
/**
 * Debt was weighted 3.0 — second only to grievance — and the effect was that
 * money decided almost every scene the world paid for: 24% of resolved scenes
 * moved credits and the dialogue was wall-to-wall debt collection. Owing someone
 * is a real reason to talk, but it should compete with knowing them, liking
 * them and wanting the same thing, not outrank all three. Lowering it does not
 * make the world blander; it lets the other axes reach the top of the ranking.
 */
export const GATE_WEIGHTS = {
  debt: 1.6,
  grievance: 3.4,
  familiarity: 2.0,
  feeling: 2.0, // |affection| — love and hate both make scenes
  goalConflict: 2.0,
  viceUrge: 1.5,
  timeApart: 0.5,
  noise: 0.3,
  alreadySpokeToday: -2.0,
} as const

/**
 * A scene needs a *reason*, not just a score. Time apart and noise alone could
 * push two strangers over the threshold, and the model would dutifully write
 * "neither makes an impression on the other" — a paid call that produced
 * nothing. Debt, strong feeling, goal conflict or a triggered vice must carry
 * the encounter; the incidental terms only break ties between real candidates.
 */
export const MIN_SUBSTANCE = 0.6

export const GATE_DEFAULTS = {
  /** Rejects mere co-location. Volume is controlled by the budget, not here. */
  threshold: 2.0,
  maxScenesPerTick: 5,
  maxScenesPerAgentPerDay: 10,
} as const

export type SceneBudget = {
  maxScenesPerTick: number
  maxScenesPerAgentPerDay: number
}

export type GateContext = {
  tick: number
  ticksPerDay: number
  locationKind: LocationKind
  /** Scenes this pair has already had today. */
  interactionsToday: number
  /** Injected so ticks stay deterministic and testable. */
  random: () => number
}

const goalsConflict = (a: Agent, b: Agent): boolean =>
  a.goals.some((ga) =>
    b.goals.some((gb) => ga.kind === gb.kind && ga.targetId != null && ga.targetId === gb.targetId),
  )

const viceUrgeHere = (agent: Agent, where: LocationKind): number => {
  let worst = 0
  for (const v of agent.vices) {
    const def = viceDef(v.kind)
    if (def.triggers.includes(where)) worst = Math.max(worst, v.urge * def.conflictWeight)
  }
  return worst
}

/** Higher means the encounter is more likely to be worth resolving with a model. */
/** Co-located ticks at which two people count as properly familiar. Roughly
 *  two game days of shared rooms — colleagues get there in a week, neighbours
 *  who only pass in the street take far longer. */
export const FAMILIARITY_SATURATION = 500

/** The part of the score that reflects a real reason to talk. */
export function encounterSubstance(
  a: Agent,
  b: Agent,
  rel: Relationship,
  locationKind: LocationKind,
): number {
  const w = GATE_WEIGHTS
  return (
    Math.min(1, Math.abs(rel.debt) / 100) * w.debt +
    rel.grievance * w.grievance +
    Math.min(1, rel.encounters / FAMILIARITY_SATURATION) * w.familiarity +
    Math.abs(rel.affection) * w.feeling +
    (goalsConflict(a, b) ? w.goalConflict : 0) +
    Math.max(viceUrgeHere(a, locationKind), viceUrgeHere(b, locationKind)) * w.viceUrge
  )
}

/**
 * Returns 0 for encounters with no substance behind them, so they never become
 * candidates at all — cheaper and clearer than letting them compete and lose.
 */
export function scoreEncounter(
  a: Agent,
  b: Agent,
  rel: Relationship,
  ctx: GateContext,
): number {
  const w = GATE_WEIGHTS
  const substance = encounterSubstance(a, b, rel, ctx.locationKind)
  if (substance < MIN_SUBSTANCE) return 0

  const apart =
    rel.lastInteractionTick == null
      ? 1
      : Math.min(1, (ctx.tick - rel.lastInteractionTick) / ctx.ticksPerDay)

  return (
    substance +
    apart * w.timeApart +
    ctx.random() * w.noise +
    ctx.interactionsToday * w.alreadySpokeToday
  )
}

export type SceneCandidate = {
  a: AgentId
  b: AgentId
  score: number
}

/**
 * Turns scored candidates into the scenes we will actually pay for.
 *
 * This is the real cost dial. The threshold only discards the boring; encounter
 * density swings with where agents happen to be, so a threshold alone yields an
 * unpredictable number of calls per day. The budget makes spend a decision
 * instead of an emergent property: best candidates first, hard caps applied.
 */
export function selectScenes(
  candidates: readonly SceneCandidate[],
  scenesTodayByAgent: ReadonlyMap<AgentId, number>,
  budget: SceneBudget = GATE_DEFAULTS,
): SceneCandidate[] {
  const spent = new Map(scenesTodayByAgent)
  const chosen: SceneCandidate[] = []
  // Nobody holds two conversations at once. Enforced here rather than at
  // candidate collection, because busy is only set once selection is done.
  const engaged = new Set<AgentId>()

  for (const c of [...candidates].sort((x, y) => y.score - x.score)) {
    if (chosen.length >= budget.maxScenesPerTick) break
    if (engaged.has(c.a) || engaged.has(c.b)) continue
    const usedA = spent.get(c.a) ?? 0
    const usedB = spent.get(c.b) ?? 0
    if (usedA >= budget.maxScenesPerAgentPerDay) continue
    if (usedB >= budget.maxScenesPerAgentPerDay) continue
    engaged.add(c.a)
    engaged.add(c.b)
    chosen.push(c)
    spent.set(c.a, usedA + 1)
    spent.set(c.b, usedB + 1)
  }
  return chosen
}

export function shouldTriggerScene(
  a: Agent,
  b: Agent,
  rel: Relationship,
  ctx: GateContext,
  threshold: number = GATE_DEFAULTS.threshold,
): boolean {
  return scoreEncounter(a, b, rel, ctx) > threshold
}
