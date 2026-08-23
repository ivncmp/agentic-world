import { describe, it, expect } from 'vitest'
import {
  buildScenePrompt,
  parseSceneOutcome,
  canLend,
  LEND_MIN_ENCOUNTERS,
  type ThirdParty,
} from '../scene.js'
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
  needs: { hunger: 0.2, energy: 0.7, social: 0.4, hygiene: 0.8, fun: 0.3 },
  money: 100,
  location: 'bar-1',
  job: null,
  housing: { kind: 'rent', due: 40, arrears: 0 },
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

const prompt = (r: Relationship): string =>
  buildScenePrompt({
    a: agent('Marta'),
    b: agent('Juan'),
    rel: r,
    aboutB: [],
    aboutA: [],
    place: 'The Anchor',
    hour: 20,
    now: 1_755_000_000_000,
  })

const close = rel({ encounters: LEND_MIN_ENCOUNTERS, trust: 0.4 })

/**
 * Lending used to be a soft hint in the prompt — "people rarely lend to someone
 * they do not trust" — and the model lent anyway, leaving a third of all pairs
 * in town owing money to someone they barely knew. Money between people should
 * follow a relationship, not create one, so the engine decides.
 */
describe('lending is a property of the relationship, not the model', () => {
  it('refuses a loan between two people who barely know each other', () => {
    expect(canLend(rel({ trust: 0.9, encounters: 3 }))).toBe(false)
  })

  it('refuses a loan between two people who know but distrust each other', () => {
    expect(canLend(rel({ trust: -0.2, encounters: 500 }))).toBe(false)
  })

  it('allows one between familiar, trusting people', () => {
    expect(canLend(close)).toBe(true)
  })

  it('tells the model outright when a loan is off the table', () => {
    expect(prompt(rel())).toContain('MUST be 0')
    expect(prompt(close)).not.toContain('MUST be 0')
  })

  it('still allows money to move as a payment when lending is barred', () => {
    // Settling up or buying a round is not a loan, and barring loans must not
    // freeze the economy between strangers.
    expect(prompt(rel())).toContain('transfer')
  })

  it('discards a loan the model invents anyway', () => {
    const json = JSON.stringify({
      dialogue: [{ speaker: 'Marta', line: 'Here, take it.' }],
      outcome: 'Marta lent Juan money.',
      memoryA: 'I lent Juan fifty.',
      memoryB: 'Marta lent me fifty.',
      deltas: { aToB: { trust: 0, affection: 0 }, bToA: { trust: 0, affection: 0 } },
      transfer: 0,
      loan: 50,
    })
    expect(parseSceneOutcome(json, 'Marta', 'Juan', false).loan).toBe(0)
    expect(parseSceneOutcome(json, 'Marta', 'Juan', true).loan).toBe(50)
  })
})

describe('scene prompt', () => {
  it('states bad blood as bad blood, never as money', () => {
    const p = prompt(rel({ grievance: 0.8 }))
    expect(p).toContain('bad blood')
    expect(p).not.toContain('owes')
  })

  it('reports a debt when there is one', () => {
    expect(prompt(rel({ debt: 90 }))).toContain('owes 90 credits')
  })

  it('highlights shared interests between agents', () => {
    const p = buildScenePrompt({
      a: agent('Marta', { interests: ['football', 'cooking'] }),
      b: agent('Juan', { interests: ['football', 'cars'] }),
      rel: rel(),
      aboutB: [],
      aboutA: [],
      place: 'The Anchor',
      hour: 20,
      now: 1_755_000_000_000,
    })
    expect(p).toContain('They both enjoy football')
  })

  it('omits shared interests line when none overlap', () => {
    const p = buildScenePrompt({
      a: agent('Marta', { interests: ['cooking'] }),
      b: agent('Juan', { interests: ['cars'] }),
      rel: rel(),
      aboutB: [],
      aboutA: [],
      place: 'The Anchor',
      hour: 20,
      now: 1_755_000_000_000,
    })
    expect(p).not.toContain('They both enjoy')
  })

  it('lists third parties both agents know', () => {
    const thirds: ThirdParty[] = [{
      id: 'elena-1', name: 'Elena',
      fromA: rel({ affection: 0.3, trust: -0.1, encounters: 10 }),
      fromB: rel({ affection: 0.6, trust: 0.5, encounters: 20 }),
    }]
    const p = buildScenePrompt({
      a: agent('Marta'), b: agent('Juan'), rel: rel(),
      aboutB: [], aboutA: [], place: 'The Anchor', hour: 20,
      now: 1_755_000_000_000, knownInCommon: thirds,
    })
    expect(p).toContain('People they both know')
    expect(p).toContain('Elena')
    expect(p).toContain('gossipA')
  })

  it('omits gossip fields when no third parties exist', () => {
    const p = prompt(rel())
    expect(p).not.toContain('gossipA')
    expect(p).not.toContain('People they both know')
  })
})

describe('gossip parsing', () => {
  const validIds = new Set(['elena-1', 'pedro-1'])

  const sceneWith = (gossipA: unknown[], gossipB: unknown[] = []) =>
    JSON.stringify({
      dialogue: [{ speaker: 'Marta', line: 'Hey.' }],
      outcome: 'They spoke.', memoryA: 'mem', memoryB: 'mem',
      thoughtA: '', thoughtB: '',
      deltas: { aToB: { trust: 0, affection: 0 }, bToA: { trust: 0, affection: 0 } },
      transfer: 0, loan: 0,
      gossipA, gossipB,
    })

  it('parses valid gossip entries', () => {
    const result = parseSceneOutcome(
      sceneWith([{ about: 'elena-1', text: 'Elena stole from Pedro last week.' }]),
      'Marta', 'Juan', true, validIds,
    )
    expect(result.gossipA).toHaveLength(1)
    expect(result.gossipA[0]).toEqual({ about: 'elena-1', text: 'Elena stole from Pedro last week.' })
    expect(result.gossipB).toHaveLength(0)
  })

  it('discards gossip about unknown agents', () => {
    const result = parseSceneOutcome(
      sceneWith([{ about: 'nobody-99', text: 'Some random person.' }]),
      'Marta', 'Juan', true, validIds,
    )
    expect(result.gossipA).toHaveLength(0)
  })

  it('caps gossip at 2 entries per side', () => {
    const result = parseSceneOutcome(
      sceneWith([
        { about: 'elena-1', text: 'First.' },
        { about: 'pedro-1', text: 'Second.' },
        { about: 'elena-1', text: 'Third — should be dropped.' },
      ]),
      'Marta', 'Juan', true, validIds,
    )
    expect(result.gossipA).toHaveLength(2)
  })

  it('returns empty arrays when gossip fields are missing', () => {
    const json = JSON.stringify({
      dialogue: [], outcome: 'ok', memoryA: '', memoryB: '',
      thoughtA: '', thoughtB: '',
      deltas: { aToB: { trust: 0, affection: 0 }, bToA: { trust: 0, affection: 0 } },
      transfer: 0, loan: 0,
    })
    const result = parseSceneOutcome(json, 'A', 'B')
    expect(result.gossipA).toEqual([])
    expect(result.gossipB).toEqual([])
  })

  it('handles malformed gossip entries gracefully', () => {
    const result = parseSceneOutcome(
      sceneWith([42, null, { about: 'elena-1' }, { text: 'no about' }, { about: 'elena-1', text: 'ok' }]),
      'Marta', 'Juan', true, validIds,
    )
    expect(result.gossipA).toEqual([{ about: 'elena-1', text: 'ok' }])
  })
})
