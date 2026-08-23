import { describe, it, expect } from 'vitest'
import { parseReflection, MAX_DRIFT_PER_NIGHT } from '../reflection.js'
import { applyReflection } from '../../engine/apply-reflection.js'
import { zeroVector } from '../../agents/values.js'
import type { Agent } from '../../agents/agent.js'
import type { WorldState } from '../../engine/tick.js'

const agent = (id: string): Agent => ({
  id, name: id, ownerId: 'o', occupation: 'clerk',
  values: { base: { ...zeroVector(), honesty: 0.5 }, drift: zeroVector(), guidance: {} },
  vices: [{ kind: 'grudge', urge: 0 }, { kind: 'idleness', urge: 0 }],
  needs: { hunger: 0, energy: 0, social: 0, hygiene: 0, fun: 0 },
  money: 100, location: 'home-1', job: null,
  housing: { kind: 'none', due: 0, arrears: 0 },
  arrivedTick: null,
  lastTheftTick: null,
  lastReflectionDay: 0, activity: null, goals: [], constraints: [], interests: [],
})

const world = (agents: Agent[]): WorldState => ({
  tick: 288, agents, locations: [], relationships: new Map(),
  scenesTodayByAgent: new Map(), scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(),
  notableToday: new Set(), openings: new Map(),
})

describe('parseReflection', () => {
  it('caps how far one night can move a trait', () => {
    const o = parseReflection('{"diary":"d","consolidated":"c","drift":{"honesty":-5}}', 'x')
    expect(o.drift.honesty).toBe(-MAX_DRIFT_PER_NIGHT)
  })

  it('keeps only axes the day actually moved', () => {
    const o = parseReflection('{"diary":"d","consolidated":"c","drift":{"honesty":0,"loyalty":0.05}}', 'x')
    expect(Object.keys(o.drift)).toEqual(['loyalty'])
  })

  it('survives a model that answers with prose around the JSON', () => {
    const o = parseReflection('Here you go:\n{"diary":"d","consolidated":"c"}\nHope that helps', 'x')
    expect(o.diary).toBe('d')
  })

  it('falls back rather than throwing on a malformed body', () => {
    const o = parseReflection('{"drift":"nonsense"}', 'Marta')
    expect(o.diary).toContain('Marta')
    expect(o.drift).toEqual({})
  })
})

describe('applyReflection', () => {
  it('is the writer of drift — the stratum life owns', () => {
    const s = applyReflection(world([agent('a')]), 'a', {
      diary: '', consolidated: '', drift: { honesty: -0.1 }, relationships: [],
    })
    expect(s.agents[0]!.values.drift.honesty).toBeCloseTo(-0.1, 6)
    // base is untouched: the owner's authorship survives what life did.
    expect(s.agents[0]!.values.base.honesty).toBe(0.5)
  })

  it('accumulates night after night, so a life can outweigh an owner', () => {
    let s = world([agent('a')])
    for (let i = 0; i < 8; i++)
      s = applyReflection(s, 'a', { diary: '', consolidated: '', drift: { honesty: -0.1 }, relationships: [] })
    expect(s.agents[0]!.values.drift.honesty).toBeCloseTo(-0.8, 6)
  })

  it('revises relationships without inventing a self-relationship', () => {
    const s = applyReflection(world([agent('a'), agent('b')]), 'a', {
      diary: '', consolidated: '', drift: {},
      relationships: [{ agent: 'b', trust: -0.2, affection: -0.1 }, { agent: 'a', trust: 1, affection: 1 }],
    })
    expect(s.relationships.get('a:b')?.trust).toBeCloseTo(-0.2, 6)
    expect(s.relationships.has('a:a')).toBe(false)
  })
})
