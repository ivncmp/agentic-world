/**
 * The agent schema — the source of truth for what an agent *is*.
 *
 * Deliberately data, not behaviour: an agent is a row, not a process. There is
 * no process per agent and no model client per agent; the engine reads these
 * fields every tick and the cognition routes read them when building a prompt.
 *
 * Where each part lives is a deliberate split. The fields here are in Postgres
 * because the tick loop touches them constantly. The *narrative* behind them —
 * why this agent distrusts that one — lives in dbrain, recalled by relevance.
 */
import type { PersonalityValues } from './values.js'
import type { ActionKind } from '../engine/actions.js'
import type { ViceInstance } from './vices.js'
import type { LocationId } from '../world/locations.js'
import type { Occupation } from '../world/occupations.js'

/**
 * Slug, not a UUID: it appears in prompts, memories and the viewer.
 */
export type AgentId = string

/**
 * What an agent is doing *over time*. Actions are not instantaneous: walking
 * across the neighbourhood takes minutes, a meal takes a quarter of an hour,
 * a night's sleep takes hours. The viewer reads this to know what animation to
 * play and, during a walk, exactly where between two tiles the agent is.
 */
export type Activity = {
  kind: string
  /**
   * Where the activity happens, or the destination while walking.
   */
  at: LocationId
  /**
   * Origin while walking; absent otherwise.
   */
  from?: LocationId
  startedTick: number
  endsTick: number
  /**
   * The other party, for scenes.
   */
  with?: AgentId
}
/**
 * The human who authored this agent. Never appears inside the world.
 */
export type OwnerId = string

/**
 * Drives that decay each tick and push the reflex layer to act. 0..1.
 */
export type Needs = {
  hunger: number
  energy: number
  social: number
  hygiene: number
  /**
   * Boredom. Off-shift hours are most of the day; without this they are dead.
   */
  fun: number
}

/**
 * Closed set: a goal only exists if the reflex layer knows how to pursue it.
 * Adding a kind means adding the scoring that reads it.
 */
export type GoalKind = 'get_job' | 'buy_home' | 'repay_debt' | 'befriend' | 'start_business'

/**
 * Two agents chasing the same goal + target is a conflict the gate scores.
 */
export type Goal = {
  kind: GoalKind
  targetId?: string
  priority: number // 0..1
}

/**
 * What the agent *is*. Independent of employment: an unemployed engineer is
 * still an engineer, and looks for engineering work.
 */
export type Job = {
  employerId: string
  wage: number
  shiftStart: number // hour of the game day, 0..23
  shiftEnd: number
}

/**
 * Rent is charged daily and missing it accumulates `arrears`. Note that arrears
 * currently have no consequence — see documentation/economy.md.
 */
export type Housing = {
  kind: 'rent' | 'mortgage' | 'none'
  due: number // credits per period
  arrears: number // unpaid — the drama generator
}

/**
 * A thumb on the scale for one action, produced by deliberation and read by
 * `scoreActions`. This is the whole reason deliberation is affordable: it
 * biases the free layer instead of deciding anything itself.
 */
export type ActionBias = {
  action: ActionKind
  bias: number // -1.0..+1.0, additive to scoreActions
}

/**
 * Someone this agent wants to find, and why. Raises the gate's score for that pair.
 */
export type SeekScene = {
  target: AgentId
  reason: string
}

/**
 * An agent's current intent. Expires after `DELIBERATION_TTL` ticks so a plan
 * made this morning does not steer them all week.
 */
export type Deliberation = {
  setTick: number
  biases: ActionBias[]
  seekScene: SeekScene[]
  conversationSeed: string | null
}

/**
 * One inhabitant. Every field here is read by the tick loop, which is why the
 * type stays flat and free of anything requiring a lookup to interpret.
 */
export type Agent = {
  id: AgentId
  name: string
  ownerId: OwnerId

  occupation: Occupation
  values: PersonalityValues
  /**
   * Exactly two, chosen at creation. Non-negotiable: friction by design.
   */
  vices: [ViceInstance, ViceInstance]
  /**
   * Hobbies and interests — conversation material beyond work and money.
   */
  interests: string[]

  needs: Needs
  money: number
  location: LocationId
  job: Job | null
  housing: Housing

  /**
   * Tick when the agent arrived at their current location (for minimum stay).
   */
  arrivedTick: number | null
  /**
   * Cooldown anchor: you cannot rob the neighbourhood every five minutes.
   */
  lastTheftTick: number | null

  /**
   * Day of the agent's last reflection, so quiet lives still get one eventually.
   */
  lastReflectionDay: number

  /**
   * Occupied until `endsTick`: the agent holds position and skips action
   * selection. Scenes use it so a resolving pair cannot wander apart before
   * the outcome lands; ordinary activities use it so a meal or a night's sleep
   * takes the time it should. The *agent* blocks — the world never does.
   */
  activity: Activity | null

  goals: Goal[]
  /**
   * Hard limits set by the owner, e.g. "no_theft". Honoured by the reflex layer.
   */
  constraints: string[]

  /**
   * Layer 1.5 output. Expires after DELIBERATION_TTL ticks. Null = no active plan.
   */
  deliberation: Deliberation | null
  lastDeliberationTick: number

  /**
   * Cooldown anchor for crisis monologue (reactive micro-cognition).
   */
  lastCrisisTick: number
}

/**
 * Relationship numbers are a denormalised cache in Postgres, not the source of
 * truth. The gate reads them for every co-located pair every tick, so they must
 * be local; dbrain holds the narrative that explains them. Nightly reflection
 * writes both, and on divergence dbrain wins.
 */
export type Relationship = {
  affection: number // −1..1
  trust: number // −1..1
  /**
   * A voluntary loan, in credits, that one owes the other. Negative reverses
   * the direction. Debt is *settleable* — it can be paid and then it is gone.
   */
  debt: number
  /**
   * Bad blood: harm done, on a 0..1 scale, with no direction. A theft used to
   * be written into `debt`, so the scene prompt announced "you owe me thirty
   * credits" about money that had been stolen, and every conversation in the
   * town became a polite debt collection. They are different things — a debt
   * is settled, a wrong is resented — and conflating them let a robbery be
   * *paid off* and erased, losing exactly the memory that makes the world
   * interesting.
   *
   * Undirected on purpose: who did what to whom is narrative, and narrative
   * lives in dbrain. This number exists only to tell the gate there is
   * something here worth a conversation.
   */
  grievance: number
  /**
   * Ticks these two have spent in the same room. Familiarity is its own route
   * to having something to say: affection alone grows at +0.02 a day, so
   * reaching scene-worthiness on warmth would take a month, and the world could
   * only ever produce conflict. People who see each other constantly have a
   * reason to talk long before they have a grievance.
   */
  encounters: number
  lastInteractionTick: number | null
}
