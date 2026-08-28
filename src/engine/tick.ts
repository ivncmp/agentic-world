import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import { decayNeeds, growViceUrges } from '../agents/needs.js'
import { resolveValues } from '../agents/values.js'
import { viceDef } from '../agents/vices.js'
import type { Location, LocationId, LocationKind, Tile } from '../world/locations.js'
import { travelTicks, MIN_STAY_TICKS } from '../world/locations.js'
import { occupationDef } from '../world/occupations.js'
import { deriveGoals, HOME_DEPOSIT } from '../agents/goals.js'
import { scoreEncounter, selectScenes, GATE_DEFAULTS, type SceneCandidate, type SceneBudget } from '../cognition/gate.js'
import { chooseAction, ACTION_TICKS, type Action, type FriendLocation } from './actions.js'
import { adjustFeeling, coolFeeling } from './relationship.js'
import { hourOfDay, isDayBoundary, dayOfWeek as dayOfWeekFn, minutes, TICKS_PER_DAY, TICKS_PER_HOUR } from './clock.js'
import { detectCrisis, type CrisisJob } from './crisis-detect.js'

export type WorldEvent =
  | { type: 'scene_started'; tick: number; a: AgentId; b: AgentId }
  | { type: 'scene_abandoned'; tick: number; a: AgentId; b: AgentId }
  | { type: 'passing'; tick: number; a: AgentId; b: AgentId; where: LocationId }
  | { type: 'bought_home'; tick: number; agent: AgentId }
  | { type: 'action'; tick: number; agent: AgentId; action: Action }
  | { type: 'theft'; tick: number; thief: AgentId; victim: AgentId; amount: number }
  | { type: 'rent_missed'; tick: number; agent: AgentId; arrears: number }
  | { type: 'rent_warning'; tick: number; agent: AgentId; arrears: number }
  | { type: 'evicted'; tick: number; agent: AgentId; arrears: number }
  | { type: 'wage_garnished'; tick: number; agent: AgentId; amount: number; remaining: number }
  | { type: 'hired'; tick: number; agent: AgentId }

export type WorldState = {
  tick: number
  agents: readonly Agent[]
  locations: readonly Location[]
  /** Keyed by pairKey(a, b). */
  relationships: ReadonlyMap<string, Relationship>
  scenesTodayByAgent: ReadonlyMap<AgentId, number>
  /** Scenes per pair today, keyed by pairKey. Damps repeat conversations. */
  scenesTodayByPair: ReadonlyMap<string, number>
  /** Free, wordless encounters today, keyed by pairKey. */
  passingTodayByPair: ReadonlyMap<string, number>
  /** Agents whose day contained something worth consolidating tonight. */
  notableToday: ReadonlySet<AgentId>
  /** Workplace id -> remaining vacancies. Hiring consumes one. */
  openings: ReadonlyMap<LocationId, number>
}

export type TickDeps = {
  now: number
  random: () => number
  ticksPerDay?: number
  budget?: SceneBudget
  /** Override when the caller knows how long its provider really takes. */
  scenePatienceTicks?: number
}

export type TickResult = {
  state: WorldState
  events: WorldEvent[]
  /** Queued for the cognition worker. The tick itself never waits on these. */
  sceneJobs: SceneCandidate[]
  reflectionJobs: AgentId[]
  deliberationJobs: AgentId[]
  crisisJobs: CrisisJob[]
}

/**
 * How long a pair will stand there waiting for cognition before giving up.
 *
 * ⚠️ This is a *real-time* concern wearing world-time clothes. What it guards
 * against is a stuck worker, and workers are slow in seconds, not in world
 * minutes. Expressed only in ticks it silently depends on how fast the
 * simulation runs: at 2s per tick, 15 world minutes is six real seconds, and a
 * scene that takes twenty is abandoned every single time — which is exactly
 * what happened. A caller that knows its own latency must override this.
 */
export const SCENE_PATIENCE_TICKS = minutes(15)

/** Warmth from simply being around someone. Small on purpose: it should take
 *  many shared rooms to matter, and it must never manufacture drama by itself. */
export const PASSING_AFFECTION = 0.02

/** How much bad blood one robbery leaves behind. */
export const GRIEVANCE_PER_THEFT = 0.35

/**
 * Fraction of a grievance that survives each day, before personality. A
 * fortnight roughly halves it: long enough that a wrong shapes the next few
 * weeks of a relationship, short enough that the world is not permanently
 * poisoned by one bad night.
 */
export const GRIEVANCE_DAILY_DECAY = 0.95

/** Layer 1.5: deliberation fires every 12 game-hours. */
export const DELIBERATION_INTERVAL = 144
/** Deliberation results expire after 12 game-hours. */
export const DELIBERATION_TTL = 144

/** Crisis monologue cooldown: 4 game-hours between inner thoughts. */
export const CRISIS_COOLDOWN = 48

/** Arrears thresholds, in multiples of the agent's rent. */
export const ARREARS_WARNING_FACTOR = 2
export const ARREARS_EVICTION_FACTOR = 5
/** Fraction of each wage tick diverted to pay down arrears. */
export const GARNISHMENT_RATE = 0.25

/** Events worth tracking in the day's notable set. */
const isNotable = (e: WorldEvent): AgentId[] => {
  switch (e.type) {
    case 'theft': return [e.thief, e.victim]
    case 'scene_started': return [e.a, e.b]
    case 'rent_missed':
    case 'rent_warning':
    case 'evicted':
    case 'wage_garnished':
    case 'hired':
    case 'bought_home': return [e.agent]
    default: return []
  }
}

const UNINTERRUPTIBLE = new Set(['scene', 'sleep'])

const interruptible = (a: Agent): boolean =>
  a.activity == null || !UNINTERRUPTIBLE.has(a.activity.kind)

export const pairKey = (a: AgentId, b: AgentId): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

const emptyRel = (): Relationship => ({
  affection: 0,
  trust: 0,
  debt: 0,
  grievance: 0,
  encounters: 0,
  lastInteractionTick: null,
})

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Money is displayed and reasoned about by people; keep it in whole credits. */
const credits = (n: number) => Math.round(n * 100) / 100

/**
 * One world step. Pure, synchronous, allocation-light: no I/O, no model calls,
 * no awaiting. Expensive cognition leaves as queued jobs and resolves later —
 * a tick that lags behind never blocks the clock.
 */
export function tick(state: WorldState, deps: TickDeps): TickResult {
  const ticksPerDay = deps.ticksPerDay ?? TICKS_PER_DAY
  const nextTick = state.tick + 1
  const hour = hourOfDay(nextTick, ticksPerDay)
  const dow = dayOfWeekFn(nextTick, ticksPerDay)
  const events: WorldEvent[] = []

  const openings = new Map(state.openings)
  const notable = new Set(state.notableToday)
  const kindOf = new Map(state.locations.map((l) => [l.id, l.kind]))
  // Venues indexed by kind, then chosen per agent. Sending everyone to the
  // first location of a kind made 21 of 30 public places unreachable and put
  // all eight agents in one park — the whole city collapsed to one square.
  const byKind = new Map<LocationKind, Location[]>()
  for (const l of state.locations) {
    if (l.kind === 'home') continue
    const list = byKind.get(l.kind)
    if (list == null) byKind.set(l.kind, [l])
    else list.push(l)
  }
  const tileOf = new Map<LocationId, Tile>(state.locations.map((l) => [l.id, l.tile]))
  const districtOf = new Map<AgentId, string>()
  for (const l of state.locations) {
    if (l.kind === 'home' && l.residentId != null) districtOf.set(l.residentId, l.district)
  }

  /**
   * An agent's habitual venue of a kind: their own district first, so people
   * who live near each other keep running into each other and relationships
   * have somewhere to form. Deterministic, so habits are stable across ticks.
   */
  const haunt = (agentId: AgentId, kind: LocationKind): LocationId | null => {
    const options = byKind.get(kind)
    if (options == null || options.length === 0) return null
    const home = districtOf.get(agentId)
    const local = options.filter((l) => l.district === home)
    const pool = local.length > 0 ? local : options
    let h = 0
    for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0
    return pool[h % pool.length]?.id ?? null
  }

  // Working copies; effects below mutate these, never the input state.
  const draft = new Map<AgentId, Agent>(
    state.agents.map((a) => [
      a.id,
      { ...a, needs: decayNeeds(a.needs), vices: growViceUrges(a) },
    ]),
  )

  // Declared before action selection because `feelingToward` reads it while
  // scoring theft. Left below the loop it is in the temporal dead zone, and the
  // "you do not rob someone you are fond of" check threw instead of deciding —
  // swallowed by the server's per-tick catch, so the world just skipped a tick.
  const relationships = new Map(state.relationships)

  const occupants = (loc: LocationId, self: AgentId): Agent[] =>
    [...draft.values()].filter((o) => o.id !== self && o.location === loc)

  const crowdAt = (loc: LocationId, self: AgentId): number =>
    [...draft.values()].reduce((n, o) => n + (o.id !== self && o.location === loc ? 1 : 0), 0)

  for (const id of draft.keys()) {
    const agent = draft.get(id)
    if (agent == null) continue

    // An expiring activity must not cost a tick: clearing it and skipping
    // action selection showed up as a phantom "idle" between two sleep blocks.
    // Waking up and deciding what to do next happens in the same moment.
    let current = agent
    const act = current.activity
    if (act != null) {
      const isScene = act.kind === 'scene'
      const patience = isScene ? (deps.scenePatienceTicks ?? SCENE_PATIENCE_TICKS) : 0
      if (nextTick < act.endsTick + patience) continue // still occupied
      if (isScene && act.with != null) {
        events.push({ type: 'scene_abandoned', tick: nextTick, a: current.id, b: act.with })
      }
      // A walk lands its agent at the destination.
      const arrived = act.from != null
      current = { ...current, location: arrived ? act.at : current.location, activity: null, arrivedTick: arrived ? nextTick : current.arrivedTick }
      draft.set(id, current)
    }

    // Minimum stay: an agent who just arrived must stay a while before leaving.
    const locKind = kindOf.get(current.location)
    const minStay = locKind != null ? (MIN_STAY_TICKS[locKind] ?? 0) : 0
    if (minStay > 0 && current.arrivedTick != null && nextTick - current.arrivedTick < minStay) continue

    // Build friend locations for this agent.
    const friends: FriendLocation[] = []
    for (const [key, rel] of relationships) {
      if (rel.affection < 0.25) continue
      const parts = key.split(':')
      const otherId = parts[0] === current.id ? parts[1] : parts[1] === current.id ? parts[0] : null
      if (otherId == null) continue
      const other = draft.get(otherId)
      if (other == null || other.activity?.kind === 'travel') continue
      const otherKind = kindOf.get(other.location)
      if (otherKind == null || otherKind === 'home') continue
      friends.push({ friendId: otherId, affection: rel.affection, locationId: other.location, locationKind: otherKind })
    }

    const action = chooseAction(current, {
      tick: nextTick,
      hour,
      dayOfWeek: dow,
      values: resolveValues(current.values, deps.now),
      locationKindOf: (l) => kindOf.get(l) ?? 'home',
      homeId: current.location.startsWith('home-') ? current.location : `home-${current.id}`,
      workplaceId: current.job?.employerId ?? null,
      findLocation: (k) => haunt(current.id, k),
      co: occupants(current.location, current.id),
      crowdAt: (loc) => crowdAt(loc, current.id),
      feelingToward: (other) => relationships.get(pairKey(current.id, other))?.affection ?? 0,
      friendLocations: friends,
      random: deps.random,
    })

    // Walking takes as long as the distance demands; the agent stays at the
    // origin until it arrives, so the viewer can interpolate the trip.
    if (action.at !== current.location) {
      const here = tileOf.get(current.location)
      const there = tileOf.get(action.at)
      const ticks = here != null && there != null ? travelTicks(here, there) : 1
      draft.set(id, {
        ...current,
        arrivedTick: null,
        activity: {
          kind: 'travel',
          at: action.at,
          from: current.location,
          startedTick: nextTick,
          endsTick: nextTick + ticks,
        },
      })
      events.push({ type: 'action', tick: nextTick, agent: id, action: { kind: 'travel', at: action.at } })
      continue
    }

    const after = applyAction(current, action, draft, events, nextTick, deps, openings, kindOf)
    const duration = ACTION_TICKS[action.kind] ?? 1
    draft.set(id, {
      ...after,
      activity: { kind: action.kind, at: action.at, startedTick: nextTick, endsTick: nextTick + duration },
    })
    events.push({ type: 'action', tick: nextTick, agent: id, action })
  }

  for (const e of events) for (const who of isNotable(e)) notable.add(who)

  // A theft that leaves no grievance is invisible to the gate, and the scene
  // layer would never dramatise it. This is the reflex layer feeding cognition.
  for (const e of events) {
    if (e.type !== 'theft') continue
    const key = pairKey(e.thief, e.victim)
    const prev = relationships.get(key) ?? emptyRel()
    relationships.set(key, {
      ...prev,
      trust: adjustFeeling(prev.trust, -0.35),
      affection: adjustFeeling(prev.affection, -0.25),
      // A robbery is a wrong, not a loan. Writing it into `debt` made the
      // thief a debtor and the scene a collection call.
      grievance: Math.min(1, prev.grievance + GRIEVANCE_PER_THEFT),
    })
  }
  const scenesToday = new Map(state.scenesTodayByAgent)
  const scenesByPair = new Map(state.scenesTodayByPair)
  const passingByPair = new Map(state.passingTodayByPair)

  // Day rollover at midnight: charge housing, reset daily counters, re-derive
  // goals and queue reflection. Reflection is the only per-agent model call,
  // and it is bounded by agent count rather than by how eventful the day was.
  const reflectionJobs: AgentId[] = []
  if (isDayBoundary(nextTick, ticksPerDay)) {
    const today = Math.floor(nextTick / ticksPerDay)
    scenesToday.clear()
    // Halve rather than clear: a hard reset at midnight released every damped
    // pair at once and fired ~80% of the day's scenes in a single hour.
    for (const [k, n] of scenesByPair) {
      const decayed = Math.floor(n / 2)
      if (decayed > 0) scenesByPair.set(k, decayed)
      else scenesByPair.delete(k)
    }
    for (const [id, a] of draft) {
      if (a.housing.kind !== 'none') {
        if (a.money >= a.housing.due) {
          draft.set(id, { ...a, money: a.money - a.housing.due })
        } else {
          const arrears = a.housing.arrears + a.housing.due
          draft.set(id, { ...a, housing: { ...a.housing, arrears } })
          events.push({ type: 'rent_missed', tick: nextTick, agent: id, arrears })
          notable.add(id)
        }
      }

      // Wage garnishment: working agents with arrears lose a cut of their
      // daily earnings toward the debt. One event per day, not per tick.
      const preGarnish = draft.get(id) ?? a
      if (preGarnish.housing.arrears > 0 && preGarnish.job != null) {
        const dailyWage = preGarnish.job.wage * (preGarnish.job.shiftEnd - preGarnish.job.shiftStart)
        const garnish = Math.min(credits(dailyWage * GARNISHMENT_RATE), preGarnish.housing.arrears)
        if (garnish > 0) {
          const paid = { ...preGarnish, housing: { ...preGarnish.housing, arrears: credits(preGarnish.housing.arrears - garnish) } }
          draft.set(id, paid)
          events.push({ type: 'wage_garnished', tick: nextTick, agent: id, amount: credits(garnish), remaining: paid.housing.arrears })
          notable.add(id)
        }
      }

      // Arrears consequences: escalating pressure that makes debt dramatic.
      const current = draft.get(id) ?? a
      if (current.housing.kind !== 'none' && current.housing.arrears > 0) {
        const threshold = current.housing.due
        if (current.housing.arrears >= threshold * ARREARS_EVICTION_FACTOR) {
          // Eviction: lose the home, arrears wiped, becomes homeless.
          const lostArrears = current.housing.arrears
          draft.set(id, { ...current, housing: { kind: 'none', due: 0, arrears: 0 }, job: null })
          if (current.job != null) {
            const eid = current.job.employerId
            openings.set(eid, (openings.get(eid) ?? 0) + 1)
          }
          events.push({ type: 'evicted', tick: nextTick, agent: id, arrears: lostArrears })
          notable.add(id)
        } else if (current.housing.arrears >= threshold * ARREARS_WARNING_FACTOR) {
          events.push({ type: 'rent_warning', tick: nextTick, agent: id, arrears: current.housing.arrears })
          notable.add(id)
        }
      }

      reflectionJobs.push(id)
      draft.set(id, { ...(draft.get(id) ?? a), lastReflectionDay: today })
    }
    notable.clear()

    // Aspirational sink: surplus turns into property, and the agent stops
    // renting. Without somewhere for wealth to go it just piles up.
    for (const [id, a] of draft) {
      if (a.housing.kind === 'rent' && a.housing.arrears === 0 && a.money >= HOME_DEPOSIT) {
        draft.set(id, {
          ...a,
          money: a.money - HOME_DEPOSIT,
          housing: { kind: 'mortgage', due: Math.round(a.housing.due * 0.6), arrears: 0 },
        })
        events.push({ type: 'bought_home', tick: nextTick, agent: id })
      }
    }

    // Wrongs fade — but not at the same rate for everyone. Loyalty forgives;
    // the grudge vice is what finally makes that vice mean something.
    //
    // Feelings cool too, and for the same reason. Only grievance used to decay,
    // so affection and trust ratcheted one way: the gate selects for conflict,
    // conflict scenes subtract, and nothing ever added back. Cooling is what
    // lets a pair climb off the floor and keeps the world a spectrum.
    for (const [key, rel] of relationships) {
      const affection = coolFeeling(rel.affection)
      const trust = coolFeeling(rel.trust)
      if (rel.grievance <= 0) {
        if (affection !== rel.affection || trust !== rel.trust) {
          relationships.set(key, { ...rel, affection, trust })
        }
        continue
      }
      const parties = key.split(':').map((id) => draft.get(id)).filter((x) => x != null)
      let rate = GRIEVANCE_DAILY_DECAY
      for (const who of parties) {
        const v = resolveValues(who.values, deps.now)
        rate -= Math.max(0, v.loyalty) * 0.03
        if (who.vices.some((x) => x.kind === 'grudge')) rate += 0.04
      }
      const next = rel.grievance * Math.min(0.999, Math.max(0.7, rate))
      relationships.set(key, {
        ...rel, affection, trust, grievance: next < 0.01 ? 0 : next,
      })
    }

    // Goals are derived, not stored, so they cannot drift from the world.
    for (const [id, a] of draft) {
      const creditors = [...relationships.entries()]
        .filter(([k, r]) => k.includes(a.id) && r.debt !== 0)
        .map(([k]) => k.split(':').find((x) => x !== a.id))
        .filter((x): x is string => x != null)
      const acquaintances = [...relationships.keys()].filter((k) => k.includes(a.id)).length
      const def = occupationDef(a.occupation)
      const vacancy = [...openings.entries()].find(
        ([lid, free]) => free > 0 && kindOf.get(lid) === def.worksAt,
      )?.[0]
      const stranger = [...draft.keys()].find(
        (other) => other !== a.id && !relationships.has(pairKey(a.id, other)),
      )
      draft.set(id, {
        ...a,
        goals: deriveGoals(a, {
          values: resolveValues(a.values, deps.now),
          creditors,
          acquaintances,
          vacancy: vacancy ?? null,
          strangerId: stranger ?? null,
        }),
      })
    }
  }

  // Layer 1.5: expire stale deliberations and queue new ones.
  const deliberationJobs: AgentId[] = []
  for (const [id, a] of draft) {
    if (a.deliberation != null && nextTick - a.deliberation.setTick >= DELIBERATION_TTL) {
      draft.set(id, { ...a, deliberation: null })
    }
  }
  for (const [id, a] of draft) {
    if (nextTick - a.lastDeliberationTick < DELIBERATION_INTERVAL) continue
    if (a.activity != null && UNINTERRUPTIBLE.has(a.activity.kind)) continue
    // Stagger so all agents don't deliberate on the same tick.
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    const offset = (h % 12) * TICKS_PER_HOUR
    if ((nextTick + offset) % DELIBERATION_INTERVAL !== 0) continue
    deliberationJobs.push(id)
    draft.set(id, { ...(draft.get(id) ?? a), lastDeliberationTick: nextTick })
  }

  // Layer 1.5r: detect crisis moments worth an inner thought.
  const crisisJobs: CrisisJob[] = []
  for (const [id, a] of draft) {
    if (nextTick - a.lastCrisisTick < CRISIS_COOLDOWN) continue
    if (a.activity != null && UNINTERRUPTIBLE.has(a.activity.kind)) continue
    const crisis = detectCrisis(a, {
      hour,
      coLocated: [...draft.values()].filter((o) => o.id !== id && o.location === a.location),
      scenesToday: scenesToday.get(id) ?? 0,
    })
    if (crisis != null) {
      crisisJobs.push({ agent: id, kind: crisis.kind, context: crisis.context, tick: nextTick })
      draft.set(id, { ...a, lastCrisisTick: nextTick })
    }
  }

  // Gate every co-located pair, then let the budget decide what we pay for.
  const agents = [...draft.values()]
  const candidates: SceneCandidate[] = []
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]
      const b = agents[j]
      if (a == null || b == null || a.location !== b.location) continue
      // Bumping into someone interrupts most of what you were doing — that is
      // how chance encounters work. Only an existing conversation and sleep are
      // protected; blocking every activity silences the social layer entirely,
      // because after adding durations agents are nearly always occupied.
      if (!interruptible(a) || !interruptible(b)) continue
      const key = pairKey(a.id, b.id)
      const rel = relationships.get(key) ?? emptyRel()
      const score = scoreEncounter(a, b, rel, {
        tick: nextTick,
        ticksPerDay,
        locationKind: kindOf.get(a.location) ?? 'home',
        interactionsToday: scenesByPair.get(key) ?? 0,
        random: deps.random,
      })
      if (score > GATE_DEFAULTS.threshold) {
        candidates.push({ a: a.id, b: b.id, score, location: a.location })
        continue
      }

      // Sharing a room with nothing to say still counts for something, and it
      // costs nothing — no model, no tokens. Familiarity is counted every tick
      // so it accumulates at the pace people actually get to know each other;
      // the warmth bump and the feed entry stay once a day so neither the
      // relationship nor the log is swamped.
      const first = (passingByPair.get(key) ?? 0) === 0
      relationships.set(key, {
        ...rel,
        encounters: rel.encounters + 1,
        ...(first
          ? { affection: adjustFeeling(rel.affection, PASSING_AFFECTION) }
          : {}),
      })
      if (!first) continue
      passingByPair.set(key, 1)
      events.push({ type: 'passing', tick: nextTick, a: a.id, b: b.id, where: a.location })
    }
  }
  const sceneJobs = selectScenes(candidates, scenesToday, deps.budget ?? GATE_DEFAULTS)
  const agentsOut = () => [...draft.values()]
  for (const s of sceneJobs) {
    for (const who of [s.a, s.b] as const) {
      const who2 = who === s.a ? s.b : s.a
      const ag = draft.get(who)
      if (ag != null)
        draft.set(who, {
          ...ag,
          activity: { kind: 'scene', at: ag.location, with: who2, startedTick: nextTick, endsTick: nextTick },
        })
    }
    events.push({ type: 'scene_started', tick: nextTick, a: s.a, b: s.b })
    notable.add(s.a)
    notable.add(s.b)
    scenesToday.set(s.a, (scenesToday.get(s.a) ?? 0) + 1)
    scenesToday.set(s.b, (scenesToday.get(s.b) ?? 0) + 1)
    const k = pairKey(s.a, s.b)
    scenesByPair.set(k, (scenesByPair.get(k) ?? 0) + 1)
  }

  return {
    state: {
      ...state,
      tick: nextTick,
      agents: agentsOut(),
      relationships,
      scenesTodayByAgent: scenesToday,
      scenesTodayByPair: scenesByPair,
      passingTodayByPair: passingByPair,
      notableToday: notable,
      openings,
    },
    events,
    sceneJobs,
    reflectionJobs,
    deliberationJobs,
    crisisJobs,
  }
}

function applyAction(
  agent: Agent,
  action: Action,
  draft: Map<AgentId, Agent>,
  events: WorldEvent[],
  tickNo: number,
  deps: TickDeps,
  openings: Map<LocationId, number>,
  kindOf: ReadonlyMap<LocationId, LocationKind>,
): Agent {
  switch (action.kind) {
    case 'eat':
      return { ...agent, needs: { ...agent.needs, hunger: clamp01(agent.needs.hunger - 0.6) }, money: agent.money - 8 }

    case 'sleep':
      return { ...agent, needs: { ...agent.needs, energy: clamp01(agent.needs.energy - 0.7) } }

    case 'work': {
      if (agent.job == null) return agent
      const hasCoworkers = [...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
      return {
        ...agent,
        money: credits(agent.money + agent.job.wage / TICKS_PER_HOUR),
        needs: {
          ...agent.needs,
          energy: clamp01(agent.needs.energy + 0.04),
          fun: clamp01(agent.needs.fun + 0.015),
          social: clamp01(agent.needs.social - (hasCoworkers ? 0.01 : 0)),
        },
      }
    }

    case 'seek_job': {
      if (deps.random() > 0.06) return agent
      const def = occupationDef(agent.occupation)
      // An engineer looks for engineering work; wages differ by occupation.
      const vacancy = [...openings.entries()].find(
        ([id, free]) => free > 0 && kindOf.get(id) === def.worksAt,
      )
      if (vacancy == null) return agent
      openings.set(vacancy[0], vacancy[1] - 1)
      events.push({ type: 'hired', tick: tickNo, agent: agent.id })
      return {
        ...agent,
        job: {
          employerId: vacancy[0],
          wage: def.wage,
          shiftStart: def.shiftStart,
          shiftEnd: def.shiftEnd,
        },
      }
    }

    case 'relax': {
      const coLocated = [...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
      return { ...agent, needs: { ...agent.needs, fun: clamp01(agent.needs.fun - 0.5), social: clamp01(agent.needs.social - (coLocated ? 0.1 : 0)) } }
    }

    case 'exercise': {
      const coLocated = [...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
      return {
        ...agent,
        money: agent.money - 10,
        needs: {
          ...agent.needs,
          fun: clamp01(agent.needs.fun - 0.45),
          hygiene: clamp01(agent.needs.hygiene + 0.2),
          social: clamp01(agent.needs.social - (coLocated ? 0.1 : 0)),
        },
      }
    }

    case 'browse': {
      const coLocated = [...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
      return {
        ...agent,
        money: agent.money - 25,
        needs: { ...agent.needs, fun: clamp01(agent.needs.fun - 0.6), social: clamp01(agent.needs.social - (coLocated ? 0.1 : 0)) },
      }
    }

    case 'wash':
      return { ...agent, needs: { ...agent.needs, hygiene: clamp01(agent.needs.hygiene - 0.8) } }

    case 'socialize':
      return { ...agent, needs: { ...agent.needs, social: clamp01(agent.needs.social - 0.3), fun: clamp01(agent.needs.fun - 0.15) } }

    case 'indulge_vice': {
      const kind = action.targetAgent
      const indulged = agent.vices.find((v) => v.kind === kind) ?? agent.vices[0]
      const fullCost = viceDef(indulged.kind).moneyCost
      const cost = Math.min(fullCost, agent.money)
      const vices = agent.vices.map((v) =>
        v.kind === indulged.kind ? { ...v, urge: cost >= fullCost ? 0 : v.urge * 0.3 } : v,
      ) as Agent['vices']
      return { ...agent, vices, money: agent.money - cost }
    }

    case 'steal': {
      const victim = action.targetAgent == null ? undefined : draft.get(action.targetAgent)
      if (victim == null) return agent
      const amount = Math.floor(Math.min(victim.money, 30))
      if (amount <= 0) return agent
      draft.set(victim.id, { ...victim, money: victim.money - amount })
      events.push({ type: 'theft', tick: tickNo, thief: agent.id, victim: victim.id, amount })
      return { ...agent, money: agent.money + amount, lastTheftTick: tickNo }
    }

    default:
      return agent
  }
}
