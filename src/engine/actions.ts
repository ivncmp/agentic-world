import type { Agent, AgentId } from '../agents/agent.js'
import type { ValueVector } from '../agents/values.js'
import { viceDef } from '../agents/vices.js'
import type { LocationId, LocationKind } from '../world/locations.js'
import { occupationDef } from '../world/occupations.js'
import { savingDrive, socialDrive } from '../agents/goals.js'
import { hours } from './clock.js'

/**
 * Layer 1. Utility AI: every candidate action is scored from needs, values and
 * context, and the best one wins. Pure arithmetic — this runs for every agent
 * on every tick and must never touch a model.
 */
export type ActionKind =
  | 'eat'
  | 'sleep'
  | 'work'
  | 'socialize'
  | 'seek_job'
  | 'indulge_vice'
  | 'steal'
  | 'relax'
  | 'exercise'
  | 'browse'
  | 'wash'
  | 'travel'
  | 'idle'

export type Action = {
  kind: ActionKind
  /** Where the action must happen; the agent travels first if elsewhere. */
  at: LocationId
  targetAgent?: AgentId
}

export type FriendLocation = {
  friendId: AgentId
  affection: number
  locationId: LocationId
  locationKind: LocationKind
}

export type ActionContext = {
  tick: number
  hour: number
  /** 0 = Sunday, 6 = Saturday. */
  dayOfWeek: number
  /** Resolved personality — base + drift + decayed guidance. */
  values: ValueVector
  locationKindOf: (id: LocationId) => LocationKind
  /** This agent's own home — homes are private, one per agent. */
  homeId: LocationId
  /** Where this agent's job is, if they have one. */
  workplaceId: LocationId | null
  /** Nearest location of a kind. Null when the world has none. */
  findLocation: (kind: LocationKind) => LocationId | null
  /** Other agents currently sharing the agent's location. */
  co: readonly Agent[]
  /** How many agents are at a given location (excluding self). */
  crowdAt: (loc: LocationId) => number
  /**
   * How this agent feels about another, −1..1. Read only when weighing theft,
   * so the relationship map never has to be walked on an ordinary tick.
   */
  feelingToward: (other: AgentId) => number
  /** Friends (affection >= 0.25) currently at public locations. */
  friendLocations: readonly FriendLocation[]
  random: () => number
}

/**
 * How strongly the clock itself pushes towards sleep, independent of tiredness.
 * Without this, sleep is purely need-driven: agents nap at 5am and 3pm alike,
 * never sleep through the night, and spend the small hours milling about in
 * public — which is where the midnight crowd came from.
 */
export function sleepPull(hour: number): number {
  if (hour >= 23 || hour < 7) return 1 // night: turn in even if not tired
  if (hour === 22) return 0.3 // winding down
  return -0.8 // any waking hour: resist. Evenings are for living, not napping.
}

const onShift = (a: Agent, hour: number, dow: number): boolean =>
  a.job != null && hour >= a.job.shiftStart && hour < a.job.shiftEnd &&
  occupationDef(a.occupation).workDays.includes(dow)

/**
 * How badly the agent is short of what they owe. Drives work, job-seeking and —
 * for the dishonest — theft. This is the economy feeding the drama.
 */
export function moneyPressure(a: Agent): number {
  const owed = a.housing.due + a.housing.arrears
  if (owed <= 0) return 0
  return Math.max(0, Math.min(1, (owed - a.money) / Math.max(owed, 1)))
}

/**
 * How long each action occupies an agent, in ticks (5 game minutes each).
 * Work stays at one tick on purpose: it is continuous, and re-deciding each
 * tick is what lets someone leave for lunch or walk out of a bad shift.
 */
export const ACTION_HOURS: Record<ActionKind, number> = {
  sleep: 2, // a block; a night is several
  eat: 0.25,
  work: 0, // continuous — re-decided each tick so someone can leave for lunch
  socialize: 0.25,
  seek_job: 1 / 6,
  indulge_vice: 0.5,
  steal: 0,
  relax: 0.5,
  exercise: 0.5,
  browse: 1 / 3,
  wash: 1 / 6,
  travel: 0, // set by distance
  idle: 0,
}

/** Durations in ticks, derived so the tick size stays a real parameter. */
export const ACTION_TICKS = Object.fromEntries(
  Object.entries(ACTION_HOURS).map(([k, h]) => [k, h === 0 ? 1 : hours(h)]),
) as Record<ActionKind, number>

/** Half a world day. Theft is a crisis move, not a livelihood. */
/**
 * Robbery is a shock, not a habit. At twelve hours an agent could steal twice a
 * day forever; three days makes it something that happens to a relationship
 * rather than something that describes it.
 */
export const THEFT_COOLDOWN_TICKS = hours(72)

/**
 * A vice must actually build before it wins a tick. Without this an urge of
 * 0.02 outscores idling, so agents indulge every few ticks and the economy
 * drains — vices should be episodic crises, not a constant background hum.
 */
export const VICE_URGE_THRESHOLD = 0.5

/**
 * Satiation thresholds. Without these a consumption action beats idling at a
 * trivial need level — an agent 8% hungry eats, 13 times a day, and the economy
 * drains. A need must actually bite before it is worth acting on.
 */
export const NEED_THRESHOLD = {
  hunger: 0.45,
  energy: 0.5,
  social: 0.2,
  hygiene: 0.5,
  fun: 0.4,
} as const

export type ScoredAction = { action: Action; score: number }

/**
 * Values enter here and only here. An axis is only real if it changes a score
 * in this function; adding an axis without touching this is decoration.
 */
/**
 * People avoid crowded places. A packed bar is less appealing than a quiet one.
 * No penalty up to 3 occupants; beyond that each extra person subtracts 0.12
 * from the action score. At 9 occupants (the screenshot that inspired this)
 * the penalty is −0.72, which kills most leisure and social scores.
 */
const crowdPenalty = (crowd: number): number => Math.max(0, (crowd - 3) * 0.12)

export function scoreActions(agent: Agent, ctx: ActionContext): ScoredAction[] {
  const v = ctx.values
  const out: ScoredAction[] = []
  const pressure = moneyPressure(agent)
  // An agent saving for something works harder and spends less. This is what
  // stops a comfortable agent idling: ambition, not need.
  const saving = savingDrive(agent.goals)
  const seeking = socialDrive(agent.goals)
  const push = (kind: ActionKind, at: LocationId | null, score: number, targetAgent?: AgentId) => {
    if (at != null && score > 0) out.push({ action: { kind, at, targetAgent }, score })
  }

  const home = ctx.homeId

  // Thrifty agents mentally reserve rent money. The reserve scales with thrift:
  // at thrift 0.5 they hold back one day's rent; at 1.0, two days.
  const rentReserve = Math.max(0, v.thrift + 0.5) * agent.housing.due
  const discretionary = Math.max(0, agent.money - rentReserve)

  // Survival drives, largely value-independent. Crowd aversion applies here
  // too: with only one supermarket, the morning rush puts everyone in the same
  // queue — a packed shop nudges agents toward a quieter café or bar.
  const EAT_COST = 8
  if (agent.needs.hunger >= NEED_THRESHOLD.hunger && agent.money >= EAT_COST) {
    const superId = ctx.findLocation('supermarket')
    const barId = ctx.findLocation('bar')
    const cafeId = ctx.findLocation('cafe')
    push('eat', superId, agent.needs.hunger * 1.2 - (superId ? crowdPenalty(ctx.crowdAt(superId)) : 0))
    push('eat', barId, agent.needs.hunger * (0.9 + v.sociability * 0.4) - (barId ? crowdPenalty(ctx.crowdAt(barId)) : 0))
    push('eat', cafeId, agent.needs.hunger * (0.9 + v.sociability * 0.35) - (cafeId ? crowdPenalty(ctx.crowdAt(cafeId)) : 0))
  }
  // Tiredness *and* the hour. Either can carry it: an exhausted agent sleeps in
  // the afternoon, a rested one still turns in at night.
  const pull = sleepPull(ctx.hour)
  if (agent.needs.energy >= NEED_THRESHOLD.energy || pull >= 1) {
    push('sleep', home, agent.needs.energy * 0.8 + pull * 0.9)
  }

  // Work: industriousness decides whether the shift is honoured; money need
  // can drag even the lazy in.
  if (onShift(agent, ctx.hour, ctx.dayOfWeek) && ctx.workplaceId != null) {
    push('work', ctx.workplaceId, Math.max(0.8, 0.6 + v.industriousness * 0.5 + pressure * 0.6 + saving * 0.7))
  }
  if (agent.job == null) {
    const hiringHall = ctx.findLocation(occupationDef(agent.occupation).worksAt)
    push('seek_job', hiringHall, 0.3 + v.industriousness * 0.4 + pressure * 0.8 + saving * 0.5)
  }

  // Company. Pride suppresses seeking others out when things are going badly.
  // Vice frustration makes agents irritable and less inclined to socialize.
  const viceFrustration = agent.vices.reduce((max, vi) => {
    const def = viceDef(vi.kind)
    return def.moneyCost > discretionary && vi.urge > max ? vi.urge : max
  }, 0)
  if (ctx.co.length > 0 && agent.needs.social >= NEED_THRESHOLD.social) {
    push(
      'socialize',
      agent.location,
      0.3 + agent.needs.social * (0.6 + v.sociability * 0.4) + seeking * 0.5
        - v.pride * pressure * 0.2 - viceFrustration * 0.25,
    )
  }

  // Vices pull hardest where they are triggered; thrift resists the costly ones.
  // A broke agent can still indulge at reduced cost — you gamble what you have,
  // not what the house wants. The economy drains less but the urge resets.
  for (const vice of agent.vices) {
    if (vice.urge < VICE_URGE_THRESHOLD) continue
    const def = viceDef(vice.kind)
    const where = def.triggers.find((k) => ctx.findLocation(k) != null)
    if (where == null) continue
    const canAffordFull = def.moneyCost <= discretionary
    const canAffordPartial = def.moneyCost > 0 && discretionary >= def.moneyCost * 0.25
    if (!canAffordFull && !canAffordPartial) continue
    const costResistance = def.moneyCost > 0 ? v.thrift * 0.5 + saving * 0.6 : 0
    const desperationBonus = !canAffordFull && canAffordPartial ? 0.15 : 0
    push(
      'indulge_vice',
      ctx.findLocation(where),
      vice.urge * (1 + v.riskTolerance * 0.3) + desperationBonus - costResistance,
      vice.kind as unknown as string,
    )
  }

  // Theft is the *intersection* of desperation and low honesty, so the two
  // multiply: no matter how dishonest, an agent with nothing to worry about has
  // no reason to steal. Adding these instead makes dishonesty alone sufficient
  // and the world collapses into a kleptocracy — measured, not hypothetical.
  //
  // But `moneyPressure` was the wrong measure of desperation. It reports being
  // short of the rent, which is an ordinary condition halfway through any month,
  // and at a threshold of 0.15 that made robbery a routine budgeting tool:
  // 3.7 thefts a day among eight neighbours who all know each other. Real theft
  // comes from having no other option at all, so the bar is now literal —
  // hungry with not enough in your pocket to buy food.
  //
  // Owner constraints veto outright: this is where the owner loop reaches the
  // reflex layer.
  // Vice frustration: a costly vice at full urge the agent can't afford is
  // desperation that feeds into theft — and dampens sociability.
  const frustrated = agent.vices.some(
    (vi) => vi.urge >= 0.85 && viceDef(vi.kind).moneyCost > discretionary,
  )

  const starving = agent.money < EAT_COST && agent.needs.hunger >= NEED_THRESHOLD.hunger
  const theftCooledDown =
    agent.lastTheftTick == null || ctx.tick - agent.lastTheftTick >= THEFT_COOLDOWN_TICKS
  if (!agent.constraints.includes('no_theft') && (starving || frustrated) && theftCooledDown) {
    // You do not rob the people you are fond of. Among eight neighbours this is
    // most of what stops theft being the default answer to an empty pocket.
    const marks = ctx.co.filter((o) => o.money >= EAT_COST && ctx.feelingToward(o.id) < 0.15)
    const victim = marks.reduce<Agent | null>(
      (best, o) => (best == null || o.money > best.money ? o : best),
      null,
    )
    if (victim != null) {
      const willingness = Math.max(0, (1 - v.honesty) / 2 - Math.max(0, v.loyalty) * 0.3)
      push('steal', agent.location, (0.5 + pressure * 0.5) * willingness * 1.4, victim.id)
    }
  }

  // Friends: go where a friend is. Earned through prior co-location and scenes
  // (affection >= 0.25), so strangers never trigger this. Crowd aversion
  // prevents the snowball where everyone piles onto the same bar.
  for (const fl of ctx.friendLocations) {
    if (fl.locationId === agent.location) continue
    const score = 0.3 + fl.affection * 0.5 + seeking * 0.4 + v.sociability * 0.2
      - crowdPenalty(ctx.crowdAt(fl.locationId))
    push('socialize', fl.locationId, score)
  }

  // Leisure. The city has ten kinds of place and the engine used four; these
  // give the other half a purpose and, more importantly, give off-shift hours
  // somewhere to go. Which one an agent picks falls out of thrift and sociability.
  if (agent.needs.fun >= NEED_THRESHOLD.fun) {
    const parkId = ctx.findLocation('park')
    push('relax', parkId, agent.needs.fun * (0.8 + v.thrift * 0.3) - (parkId ? crowdPenalty(ctx.crowdAt(parkId)) : 0))
    if (discretionary >= 5) {
      const cafeId = ctx.findLocation('cafe')
      push('relax', cafeId, agent.needs.fun * (0.7 + v.sociability * 0.2) - (cafeId ? crowdPenalty(ctx.crowdAt(cafeId)) : 0))
    }
    if (discretionary >= 10) {
      const gymId = ctx.findLocation('gym')
      const bowlId = ctx.findLocation('bowling')
      push('exercise', gymId, agent.needs.fun * (0.6 - v.thrift * 0.2) - (gymId ? crowdPenalty(ctx.crowdAt(gymId)) : 0))
      push('exercise', bowlId, agent.needs.fun * (0.65 + v.sociability * 0.15) - (bowlId ? crowdPenalty(ctx.crowdAt(bowlId)) : 0))
    }
    if (discretionary >= 15) {
      const cinId = ctx.findLocation('cinema')
      push('browse', cinId, agent.needs.fun * (0.7 - v.thrift * 0.2) - (cinId ? crowdPenalty(ctx.crowdAt(cinId)) : 0))
    }
    if (discretionary >= 25) {
      const shopId = ctx.findLocation('shop')
      push('browse', shopId, agent.needs.fun * (0.7 - v.thrift * 0.5) - (shopId ? crowdPenalty(ctx.crowdAt(shopId)) : 0))
    }
  }
  if (agent.needs.hygiene >= NEED_THRESHOLD.hygiene) {
    push('wash', home, agent.needs.hygiene * 0.9)
  }

  // Idling in place is invisible: no encounters, no story. An unmotivated agent
  // drifts somewhere public instead, and sociability picks where. This is the
  // cheapest way to turn dead time into co-location, which is what feeds scenes.
  // At night, boredom sends you home, not to the bar.
  const haunt = pull >= 0.4 ? home : v.sociability > 0 ? (ctx.findLocation('cafe') ?? ctx.findLocation('bar') ?? home) : (ctx.findLocation('park') ?? home)
  const hauntCrowd = haunt !== home ? crowdPenalty(ctx.crowdAt(haunt)) : 0
  push('idle', haunt, 0.05 + ctx.random() * 0.05 + Math.max(0, v.sociability) * 0.06 - hauntCrowd)
  push('idle', agent.location, 0.05 + ctx.random() * 0.04)

  // Layer 1.5: deliberation biases shift action scores for the next ~12 hours.
  if (agent.deliberation != null) {
    for (const b of agent.deliberation.biases) {
      for (const s of out) {
        if (s.action.kind === b.action) s.score += b.bias
      }
    }
  }

  return out
}

export function chooseAction(agent: Agent, ctx: ActionContext): Action {
  const scored = scoreActions(agent, ctx)
  if (scored.length === 0) return { kind: 'idle', at: agent.location }
  return scored.reduce((best, s) => (s.score > best.score ? s : best)).action
}
