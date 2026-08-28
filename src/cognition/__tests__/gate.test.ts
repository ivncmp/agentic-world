import { describe, it, expect } from 'vitest'
import {
  scoreEncounter,
  shouldTriggerScene,
  selectScenes,
  GATE_DEFAULTS,
  MIN_SUBSTANCE,
  type GateContext,
} from '../gate.js'
import type { Agent, Relationship } from '../../agents/agent.js'
import { zeroVector } from '../../agents/values.js'

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  ownerId: 'owner-1',
  occupation: 'clerk',
  values: { base: zeroVector(), drift: zeroVector(), guidance: {} },
  vices: [
    { kind: 'grudge', urge: 0 },
    { kind: 'idleness', urge: 0 },
  ],
  needs: { hunger: 0.3, energy: 0.7, social: 0.4, hygiene: 0.8, fun: 0.3 },
  money: 100,
  location: 'bar-1',
  job: null,
  housing: { kind: 'rent', due: 50, arrears: 0 },
  arrivedTick: null,
  lastTheftTick: null,
  lastReflectionDay: 0,
  activity: null,
  goals: [],
  constraints: [],
  interests: [],
  deliberation: null,
  lastDeliberationTick: 0, lastCrisisTick: 0,
  ...over,
})

const rel = (over: Partial<Relationship> = {}): Relationship => ({
  affection: 0,
  trust: 0,
  debt: 0,
  grievance: 0,
  encounters: 0,
  lastInteractionTick: null,
  ...over,
})

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  tick: 100,
  ticksPerDay: 288,
  locationKind: 'bar',
  interactionsToday: 0,
  random: () => 0.5,
  ...over,
})

describe('scene gate', () => {
  it('ignores two strangers who merely share a room', () => {
    expect(shouldTriggerScene(agent('a'), agent('b'), rel(), ctx())).toBe(false)
  })

  it('fires on a serious unpaid debt', () => {
    expect(shouldTriggerScene(agent('a'), agent('b'), rel({ debt: 150 }), ctx())).toBe(true)
  })

  /**
   * Debt used to be weighted 3.0 and a fifty-credit IOU bought a scene on its
   * own, so the world's dialogue was wall-to-wall debt collection. Owing someone
   * a little is now a contributing reason, not a sufficient one.
   */
  it('does not spend a call on a modest debt alone', () => {
    expect(shouldTriggerScene(agent('a'), agent('b'), rel({ debt: 30 }), ctx())).toBe(false)
  })

  it('lets a modest debt tip the balance once there is a relationship too', () => {
    const strangers = rel({ debt: 30 })
    const neighbours = rel({ debt: 30, encounters: 400, affection: 0.4 })
    expect(shouldTriggerScene(agent('a'), agent('b'), strangers, ctx())).toBe(false)
    expect(shouldTriggerScene(agent('a'), agent('b'), neighbours, ctx())).toBe(true)
  })

  it('treats hatred as interesting as love', () => {
    const love = scoreEncounter(agent('a'), agent('b'), rel({ affection: 0.9 }), ctx())
    const hate = scoreEncounter(agent('a'), agent('b'), rel({ affection: -0.9 }), ctx())
    expect(love).toBeCloseTo(hate, 6)
  })

  it('fires when both chase the same thing', () => {
    const goals = [{ kind: 'get_job' as const, targetId: 'office-1', priority: 0.9 }]
    const score = scoreEncounter(agent('a', { goals }), agent('b', { goals }), rel(), ctx())
    expect(score).toBeGreaterThan(GATE_DEFAULTS.threshold)
  })

  it('a vice only counts where it is triggered', () => {
    const a = agent('a', { vices: [{ kind: 'gambling', urge: 1 }, { kind: 'envy', urge: 0 }] })
    const atBar = scoreEncounter(a, agent('b'), rel(), ctx({ locationKind: 'bar' }))
    const atShop = scoreEncounter(a, agent('b'), rel(), ctx({ locationKind: 'shop' }))
    expect(atBar).toBeGreaterThan(atShop)
  })

  it('damps a pair that has already talked today', () => {
    const r = rel({ debt: 150 })
    expect(shouldTriggerScene(agent('a'), agent('b'), r, ctx({ interactionsToday: 0 }))).toBe(true)
    expect(shouldTriggerScene(agent('a'), agent('b'), r, ctx({ interactionsToday: 2 }))).toBe(false)
  })

  it('is deterministic for a fixed random source', () => {
    const args = [agent('a'), agent('b'), rel({ debt: 30 })] as const
    expect(scoreEncounter(...args, ctx({ random: () => 0.42 }))).toBe(
      scoreEncounter(...args, ctx({ random: () => 0.42 })),
    )
  })
})

describe('scene budget', () => {
  const cand = (a: string, b: string, score: number, location = 'bar-1') => ({ a, b, score, location })

  it('spends on the best candidates first', () => {
    const picked = selectScenes(
      [cand('a', 'b', 1, 'loc-1'), cand('c', 'd', 9, 'loc-2'), cand('e', 'f', 5, 'loc-3')],
      new Map(),
      { maxScenesPerTick: 2, maxScenesPerAgentPerDay: 6, maxScenesPerLocationPerTick: 2 },
    )
    expect(picked.map((c) => c.score)).toEqual([9, 5])
  })

  it('never exceeds the per-tick cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => cand(`a${i}`, `b${i}`, i, `loc-${i}`))
    expect(selectScenes(many, new Map(), GATE_DEFAULTS)).toHaveLength(
      GATE_DEFAULTS.maxScenesPerTick,
    )
  })

  it('skips an agent who has used up their day', () => {
    const picked = selectScenes(
      [cand('spent', 'x', 10, 'loc-1'), cand('fresh', 'y', 1, 'loc-2')],
      new Map([['spent', 6]]),
      { maxScenesPerTick: 3, maxScenesPerAgentPerDay: 6, maxScenesPerLocationPerTick: 3 },
    )
    expect(picked.map((c) => c.a)).toEqual(['fresh'])
  })

  it('caps scenes per location to prevent crowd lock-in', () => {
    const picked = selectScenes(
      [cand('a', 'b', 10, 'bar-1'), cand('c', 'd', 9, 'bar-1'), cand('e', 'f', 8, 'bar-1'), cand('g', 'h', 7, 'park-1')],
      new Map(),
      { maxScenesPerTick: 6, maxScenesPerAgentPerDay: 6, maxScenesPerLocationPerTick: 2 },
    )
    const atBar = picked.filter((c) => c.location === 'bar-1')
    expect(atBar).toHaveLength(2)
    expect(picked).toHaveLength(3) // 2 at bar + 1 at park
  })

  it('counts both participants against their daily allowance', () => {
    const picked = selectScenes(
      [cand('a', 'b', 9, 'loc-1'), cand('a', 'c', 8, 'loc-2')],
      new Map(),
      { maxScenesPerTick: 5, maxScenesPerAgentPerDay: 1, maxScenesPerLocationPerTick: 5 },
    )
    expect(picked).toHaveLength(1)
  })
})

describe('a scene needs a reason, not just a score', () => {
  it('will not fire on two strangers however long since they last met', () => {
    // Time apart and noise used to be able to carry an encounter on their own,
    // and the model would write "neither makes an impression on the other" —
    // a paid call that produced nothing.
    const old = rel({ lastInteractionTick: -100_000 })
    expect(scoreEncounter(agent('a'), agent('b'), old, ctx({ tick: 100_000 }))).toBe(0)
  })

  /**
   * Debt used to be weighted 3.0 and money decided almost every scene the world
   * paid for. It is 1.6 now, deliberately, so that owing someone *competes*
   * with knowing them rather than outranking it — see GATE_WEIGHTS. These two
   * cases are that decision written down: a bare debt is a real reason but not
   * a sufficient one, and a debt between people who actually know each other
   * clears the bar comfortably.
   */
  it('treats a bare debt as substance, but not enough on its own', () => {
    const owed = rel({ debt: 60, lastInteractionTick: 99 })
    const score = scoreEncounter(agent('a'), agent('b'), owed, ctx())
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(GATE_DEFAULTS.threshold)
  })

  it('fires when a debt sits between two people who know each other', () => {
    const owed = rel({ debt: 60, encounters: 300, affection: -0.3, lastInteractionTick: 99 })
    expect(scoreEncounter(agent('a'), agent('b'), owed, ctx())).toBeGreaterThan(
      GATE_DEFAULTS.threshold,
    )
  })

  it('counts a strong bond as substance, not just a grievance', () => {
    const close = rel({ affection: 0.95 })
    expect(scoreEncounter(agent('a'), agent('b'), close, ctx())).toBeGreaterThan(0)
  })
})

describe('a wrong is not a debt', () => {
  it('bad blood is substance on its own, with no money involved', () => {
    const wronged = rel({ grievance: 0.4 })
    expect(scoreEncounter(agent('a'), agent('b'), wronged, ctx())).toBeGreaterThan(
      GATE_DEFAULTS.threshold,
    )
    expect(wronged.debt).toBe(0)
  })

  it('a small grudge alone is not enough to spend a call on', () => {
    expect(scoreEncounter(agent('a'), agent('b'), rel({ grievance: 0.1 }), ctx())).toBe(0)
  })
})
