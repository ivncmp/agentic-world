import { describe, it, expect } from 'vitest'
import { detectCrisis, type CrisisContext } from '../crisis-detect.js'
import type { Agent } from '../../agents/agent.js'
import { zeroVector } from '../../agents/values.js'

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({
  id, name: id, ownerId: 'o', occupation: 'clerk',
  values: { base: zeroVector(), drift: zeroVector(), guidance: {} },
  vices: [{ kind: 'grudge', urge: 0 }, { kind: 'idleness', urge: 0 }],
  needs: { hunger: 0.2, energy: 0.3, social: 0.4, hygiene: 0.2, fun: 0.3 },
  money: 80, location: 'bar-1', job: null,
  housing: { kind: 'rent', due: 25, arrears: 0 },
  arrivedTick: null, lastTheftTick: null, lastReflectionDay: 0,
  activity: null, goals: [], constraints: [], interests: [],
  deliberation: null, lastDeliberationTick: 0, lastCrisisTick: 0,
  ...over,
})

const ctx = (over: Partial<CrisisContext> = {}): CrisisContext => ({
  hour: 15,
  coLocated: [],
  scenesToday: 0,
  ...over,
})

describe('detectCrisis', () => {
  it('returns null when no crisis condition is met', () => {
    expect(detectCrisis(agent('a'), ctx())).toBeNull()
  })

  it('detects vice temptation when urge >= 0.7', () => {
    const a = agent('a', { vices: [{ kind: 'gambling', urge: 0.75 }, { kind: 'idleness', urge: 0 }] })
    const result = detectCrisis(a, ctx())
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('vice_temptation')
    expect(result!.context).toContain('75%')
  })

  it('does not trigger vice temptation below 0.7', () => {
    const a = agent('a', { vices: [{ kind: 'gambling', urge: 0.6 }, { kind: 'idleness', urge: 0 }] })
    expect(detectCrisis(a, ctx())).toBeNull()
  })

  it('detects theft temptation when starving with marks nearby', () => {
    const a = agent('a', { money: 3, needs: { hunger: 0.5, energy: 0.3, social: 0.4, hygiene: 0.2, fun: 0.3 } })
    const mark = agent('b', { money: 50, name: 'Bob' })
    const result = detectCrisis(a, ctx({ coLocated: [mark] }))
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('theft_temptation')
    expect(result!.context).toContain('Bob')
  })

  it('does not detect theft if agent has no_theft constraint', () => {
    const a = agent('a', {
      money: 3, constraints: ['no_theft'],
      needs: { hunger: 0.5, energy: 0.3, social: 0.4, hygiene: 0.2, fun: 0.3 },
    })
    const mark = agent('b', { money: 50 })
    expect(detectCrisis(a, ctx({ coLocated: [mark] }))).toBeNull()
  })

  it('detects deep debt when arrears >= 2x rent', () => {
    const a = agent('a', { housing: { kind: 'rent', due: 25, arrears: 55 } })
    const result = detectCrisis(a, ctx())
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('deep_debt')
    expect(result!.context).toContain('55')
  })

  it('detects isolation when lonely in the afternoon with no scenes', () => {
    const a = agent('a', { needs: { hunger: 0.2, energy: 0.3, social: 0.7, hygiene: 0.2, fun: 0.3 } })
    const result = detectCrisis(a, ctx({ hour: 16, scenesToday: 0 }))
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('isolation')
  })

  it('does not detect isolation if agent had scenes today', () => {
    const a = agent('a', { needs: { hunger: 0.2, energy: 0.3, social: 0.7, hygiene: 0.2, fun: 0.3 } })
    expect(detectCrisis(a, ctx({ hour: 16, scenesToday: 1 }))).toBeNull()
  })

  it('does not detect isolation before afternoon', () => {
    const a = agent('a', { needs: { hunger: 0.2, energy: 0.3, social: 0.7, hygiene: 0.2, fun: 0.3 } })
    expect(detectCrisis(a, ctx({ hour: 10, scenesToday: 0 }))).toBeNull()
  })

  it('vice temptation has priority over debt', () => {
    const a = agent('a', {
      vices: [{ kind: 'gambling', urge: 0.8 }, { kind: 'idleness', urge: 0 }],
      housing: { kind: 'rent', due: 25, arrears: 60 },
    })
    const result = detectCrisis(a, ctx())
    expect(result!.kind).toBe('vice_temptation')
  })
})
