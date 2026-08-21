import { describe, it, expect } from 'vitest'
import { tick, pairKey, type WorldState } from '../tick.js'
import { zeroVector, type ValueVector } from '../../agents/values.js'
import type { Agent } from '../../agents/agent.js'
import type { Location } from '../../world/locations.js'

const LOCATIONS: Location[] = [
  { id: 'home-1', kind: 'home', name: 'Home', district: 'D', tile: { x: 0, y: 0 } },
  { id: 'bar-1', kind: 'bar', name: 'Bar', district: 'D', tile: { x: 1, y: 0 } },
  { id: 'office-1', kind: 'office', name: 'Office', district: 'D', tile: { x: 2, y: 0 } },
  { id: 'shop-1', kind: 'shop', name: 'Shop', district: 'D', tile: { x: 3, y: 0 } },
]

const calm = { hunger: 0, energy: 0, social: 0, hygiene: 0, fun: 0 }

const agent = (id: string, over: Partial<Agent> = {}, base: Partial<ValueVector> = {}): Agent => ({
  id,
  name: id,
  ownerId: 'owner-1',
  occupation: 'clerk',
  values: { base: { ...zeroVector(), ...base }, drift: zeroVector(), guidance: {} },
  vices: [
    { kind: 'grudge', urge: 0 },
    { kind: 'idleness', urge: 0 },
  ],
  needs: { ...calm },
  money: 100,
  location: 'bar-1',
  job: null,
  housing: { kind: 'none', due: 0, arrears: 0 },
  lastTheftTick: null,
  lastReflectionDay: 0,
  activity: null,
  goals: [],
  constraints: [],
  ...over,
})

const world = (agents: Agent[], over: Partial<WorldState> = {}): WorldState => ({
  tick: 100,
  agents,
  locations: LOCATIONS,
  relationships: new Map(),
  scenesTodayByAgent: new Map(),
  scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(),
  notableToday: new Set(),
  openings: new Map([['office-1', 5]]),
  ...over,
})

const deps = (over: Partial<Parameters<typeof tick>[1]> = {}) => ({
  now: 1_755_000_000_000,
  random: () => 0.5,
  ...over,
})

describe('tick', () => {
  it('does not mutate the state it was given', () => {
    const a = agent('a')
    const before = JSON.stringify(a.needs)
    tick(world([a]), deps())
    expect(JSON.stringify(a.needs)).toBe(before)
  })

  it('is deterministic for the same input and random source', () => {
    const w = world([agent('a'), agent('b')])
    const one = tick(w, deps())
    const two = tick(w, deps())
    expect(JSON.stringify(one.state.agents)).toBe(JSON.stringify(two.state.agents))
  })

  it('advances the clock and lets needs build', () => {
    const r = tick(world([agent('a')]), deps())
    expect(r.state.tick).toBe(101)
    expect(r.state.agents[0]!.needs.hunger).toBeGreaterThan(0)
  })

  it('walks for as long as the distance takes, arriving only at the end', () => {
    // Homes are private: agent 'a' heads for home-a, not the shared 'home-1'.
    const sleepy = agent('a', { needs: { ...calm, energy: 0.9 }, location: 'bar-1' })
    const w = world([sleepy])
    const withHome = {
      ...w,
      locations: [
        ...w.locations,
        { id: 'home-a', kind: 'home' as const, name: "A's", district: 'D', tile: { x: 12, y: 12 } },
      ],
    }
    // Set at midnight, when heading home to sleep is unambiguous: at 8am a
    // tired agent correctly prefers looking for work over going to bed.
    let r = tick({ ...withHome, tick: 287 }, deps())
    // Still at the bar, but walking — the viewer can interpolate from here.
    expect(r.state.agents[0]!.location).toBe('bar-1')
    expect(r.state.agents[0]!.activity?.kind).toBe('travel')
    expect(r.state.agents[0]!.activity?.from).toBe('bar-1')

    for (let i = 0; i < 8; i++) r = tick(r.state, deps())
    expect(r.state.agents[0]!.location).toBe('home-a')
  })
})

describe('owner constraints reach the reflex layer', () => {
  /** Hungry with nothing in their pocket to buy food — the only state that robs. */
  const desperate = (constraints: string[]) =>
    agent(
      'thief',
      {
        money: 0,
        needs: { ...calm, hunger: 0.9 },
        housing: { kind: 'rent', due: 50, arrears: 100 },
        location: 'bar-1',
        constraints,
      },
      { honesty: -1, loyalty: -1 },
    )
  const mark = agent('mark', { money: 500, location: 'bar-1' })

  it('a starving, dishonest agent steals', () => {
    const r = tick(world([desperate([]), mark]), deps())
    expect(r.events.some((e) => e.type === 'theft')).toBe(true)
  })

  it('a dishonest but comfortable agent has no reason to steal', () => {
    // Regression: theft used to score on dishonesty alone, so any crooked agent
    // robbed on every idle tick and the economy collapsed. Desperation and
    // dishonesty must multiply, not add.
    const comfortable = agent(
      'crook',
      { money: 500, housing: { kind: 'rent', due: 40, arrears: 0 }, location: 'bar-1' },
      { honesty: -1, loyalty: -1 },
    )
    const r = tick(world([comfortable, mark]), deps())
    expect(r.events.some((e) => e.type === 'theft')).toBe(false)
  })

  /**
   * Being short of the rent is an ordinary condition halfway through any month.
   * Treating it as desperation made robbery a budgeting tool — 3.7 thefts a day
   * among eight neighbours. Theft now needs an empty pocket *and* an empty
   * stomach.
   */
  it('being behind on rent is not on its own a reason to rob anyone', () => {
    const skint = agent(
      'skint',
      {
        money: 5,
        needs: { ...calm },
        housing: { kind: 'rent', due: 50, arrears: 200 },
        location: 'bar-1',
      },
      { honesty: -1, loyalty: -1 },
    )
    const r = tick(world([skint, mark]), deps())
    expect(r.events.some((e) => e.type === 'theft')).toBe(false)
  })

  /** You do not rob the people you are fond of, however hungry you are. */
  it('will not rob someone it is fond of', () => {
    const thief = desperate([])
    const friendly = new Map([
      [pairKey('thief', 'mark'), {
        affection: 0.6, trust: 0.5, debt: 0, grievance: 0,
        encounters: 400, lastInteractionTick: null,
      }],
    ])
    const r = tick(world([thief, mark], { relationships: friendly }), deps())
    expect(r.events.some((e) => e.type === 'theft')).toBe(false)
  })

  it('the same agent does not, once the owner forbids it', () => {
    const r = tick(world([desperate(['no_theft']), mark]), deps())
    expect(r.events.some((e) => e.type === 'theft')).toBe(false)
  })
})

describe('economy and cognition queueing', () => {
  it('accrues arrears at nightfall when rent cannot be paid', () => {
    const broke = agent('a', { money: 0, housing: { kind: 'rent', due: 50, arrears: 0 } })
    const r = tick(world([broke], { tick: 287 }), deps({ ticksPerDay: 288 }))
    expect(r.events.some((e) => e.type === 'rent_missed')).toBe(true)
    expect(r.state.agents[0]!.housing.arrears).toBe(50)
  })

  it('queues no reflection at all outside the day rollover', () => {
    expect(tick(world([agent('a')]), deps()).reflectionJobs).toHaveLength(0)
  })

  it('does not reflect on a day where nothing happened', () => {
    // Four of four diaries on a quiet day said "nothing happened" — four paid
    // calls to confirm a void. Reflection is the one cost no gate can reduce,
    // so it has to be earned.
    const w = world([agent('a'), agent('b')], { tick: 287 })
    expect(tick(w, deps({ ticksPerDay: 288 })).reflectionJobs).toHaveLength(0)
  })

  it('reflects on a day that contained something', () => {
    const broke = agent('a', { money: 0, housing: { kind: 'rent', due: 50, arrears: 0 } })
    const r = tick(world([broke], { tick: 287 }), deps({ ticksPerDay: 288 }))
    expect(r.events.some((e) => e.type === 'rent_missed')).toBe(true)
    expect(r.reflectionJobs).toEqual(['a'])
  })

  it('reflects on a quiet life eventually, so nobody goes months unexamined', () => {
    const forgotten = agent('a', { lastReflectionDay: 0 })
    // Day 4 rollover: three quiet days is the limit.
    const r = tick(world([forgotten], { tick: 288 * 4 - 1 }), deps({ ticksPerDay: 288 }))
    expect(r.reflectionJobs).toEqual(['a'])
  })

  it('never queues more scenes than the budget allows', () => {
    const crowd = Array.from({ length: 8 }, (_, i) =>
      agent(`a${i}`, { location: 'bar-1' }),
    )
    const rels = new Map(
      crowd.flatMap((a, i) =>
        crowd.slice(i + 1).map((b) => [pairKey(a.id, b.id), {
          affection: 0.9, trust: 0, debt: 200, grievance: 0, encounters: 0, lastInteractionTick: null,
        }] as const),
      ),
    )
    const r = tick(world(crowd, { relationships: rels }), deps())
    expect(r.sceneJobs.length).toBeLessThanOrEqual(3)
    expect(r.sceneJobs.length).toBeGreaterThan(0)
  })
})

describe('occupations drive the job market', () => {
  it('hires into a workplace matching the occupation, at that wage', () => {
    const jobless = agent('a', { occupation: 'engineer', job: null, location: 'office-1' })
    const w = world([jobless])
    // random() = 0.02 clears the 0.06 hiring roll.
    const r = tick({ ...w, openings: new Map([['office-1', 1]]) }, deps({ random: () => 0.02 }))
    expect(r.state.agents[0]!.job?.employerId).toBe('office-1')
    expect(r.state.agents[0]!.job?.wage).toBe(24) // engineer, not a flat rate
  })

  it('cannot be hired where there are no vacancies', () => {
    const jobless = agent('a', { occupation: 'engineer', job: null, location: 'office-1' })
    const w = world([jobless])
    const r = tick({ ...w, openings: new Map([['office-1', 0]]) }, deps({ random: () => 0.02 }))
    expect(r.state.agents[0]!.job).toBeNull()
  })
})

describe('wages', () => {
  it('pays an hourly wage pro-rata per tick, not once per tick', () => {
    const worker = agent('a', {
      occupation: 'engineer',
      job: { employerId: 'office-1', wage: 24, shiftStart: 0, shiftEnd: 24 },
      location: 'office-1',
      money: 0,
      needs: { ...calm },
    })
    const r = tick(world([worker]), deps())
    // 24/hour over a 5-minute tick = 2, not 24.
    expect(r.state.agents[0]!.money).toBeCloseTo(2, 6)
  })
})

describe('daily rhythm', () => {
  it('a rested agent still heads home at night', () => {
    const rested = agent('a', { needs: { ...calm, energy: 0.1 }, location: 'bar-1' })
    const w = world([rested], { tick: 287 }) // next tick rolls to hour 0
    const r = tick(
      {
        ...w,
        locations: [
          ...w.locations,
          { id: 'home-a', kind: 'home' as const, name: "A's", district: 'D', tile: { x: 5, y: 5 } },
        ],
      },
      deps(),
    )
    expect(r.state.agents[0]!.activity?.at).toBe('home-a')
  })

  it('does not nap in the middle of the working day when only mildly tired', () => {
    const midday = 12 * 12 // hour 12
    const mild = agent('a', { needs: { ...calm, energy: 0.55 }, location: 'bar-1' })
    const r = tick(world([mild], { tick: midday - 1 }), deps())
    const acted = r.events.find((e) => e.type === 'action')
    expect(acted?.type === 'action' && acted.action.kind).not.toBe('sleep')
  })
})

describe('in-conversation state', () => {
  const pair = () => [
    agent('a', { location: 'bar-1' }),
    agent('b', { location: 'bar-1' }),
  ]
  const tense = new Map([['a:b', { affection: 0, trust: 0, debt: 300, grievance: 0, encounters: 0, lastInteractionTick: null }]])

  it('holds both agents in place once a scene starts', () => {
    const r = tick(world(pair(), { relationships: tense }), deps())
    expect(r.sceneJobs.length).toBe(1)
    expect(r.state.agents.every((x) => x.activity?.kind === 'scene')).toBe(true)
    expect(r.events.some((e) => e.type === 'scene_started')).toBe(true)
  })

  it('a busy agent takes no action of its own', () => {
    const busy = tick(world(pair(), { relationships: tense }), deps())
    const next = tick(busy.state, deps())
    expect(next.events.some((e) => e.type === 'action')).toBe(false)
  })

  it('gives up if cognition never comes back, rather than freezing forever', () => {
    let r = tick(world(pair(), { relationships: tense }), deps())
    let abandoned = false
    for (let i = 0; i < 5; i++) {
      r = tick(r.state, deps())
      if (r.events.some((e) => e.type === 'scene_abandoned')) abandoned = true
    }
    // Freed once patience runs out. They may well fall straight into another
    // encounter — the point is that nothing is stuck waiting forever.
    expect(abandoned).toBe(true)
  })

  it('will not pull a busy agent into a second scene', () => {
    const three = [...pair(), agent('c', { location: 'bar-1' })]
    const rels = new Map([
      ['a:b', { affection: 0, trust: 0, debt: 300, grievance: 0, encounters: 0, lastInteractionTick: null }],
      ['a:c', { affection: 0, trust: 0, debt: 300, grievance: 0, encounters: 0, lastInteractionTick: null }],
    ])
    const r = tick(world(three, { relationships: rels }), deps())
    const involved = r.sceneJobs.flatMap((s) => [s.a, s.b])
    expect(new Set(involved).size).toBe(involved.length)
  })
})

describe('daily counters', () => {
  it('clears passing pairs at the day rollover', () => {
    const two = [agent('a', { location: 'bar-1' }), agent('b', { location: 'bar-1' })]
    // Build up a passing record, then cross midnight.
    let r = tick(world(two), deps())
    expect(r.state.passingTodayByPair.size).toBeGreaterThan(0)
    const atMidnight = tick({ ...r.state, tick: 287 }, deps({ ticksPerDay: 288 }))
    // Whatever is there afterwards belongs to the new day, not the old one.
    expect(atMidnight.state.passingTodayByPair.size).toBeLessThanOrEqual(1)
  })
})

describe('scene patience', () => {
  it('honours a caller-supplied window instead of the world-time default', () => {
    // The default is 3 ticks. A live engine running at 2s/tick needs ~60 to
    // cover a 2-minute provider timeout; without the override every scene is
    // abandoned before the model answers.
    const two = [agent('a', { location: 'bar-1' }), agent('b', { location: 'bar-1' })]
    const rels = new Map([
      ['a:b', { affection: 0, trust: 0, debt: 300, grievance: 0, encounters: 0, lastInteractionTick: null }],
    ])
    let r = tick(world(two, { relationships: rels }), deps())
    expect(r.sceneJobs).toHaveLength(1)
    for (let i = 0; i < 10; i++) r = tick(r.state, deps({ scenePatienceTicks: 60 }))
    expect(r.events.some((e) => e.type === 'scene_abandoned')).toBe(false)
    expect(r.state.agents.every((x) => x.activity?.kind === 'scene')).toBe(true)
  })
})
