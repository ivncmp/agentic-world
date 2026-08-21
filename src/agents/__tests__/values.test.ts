import { describe, it, expect } from 'vitest'
import { resolveValues, zeroVector, decayedGuidance, type PersonalityValues } from '../values.js'

const DAY = 86_400_000
const NOW = 1_755_000_000_000

const personality = (over: Partial<PersonalityValues> = {}): PersonalityValues => ({
  base: zeroVector(),
  drift: zeroVector(),
  guidance: {},
  ...over,
})

describe('guidance decay', () => {
  it('halves after exactly one half-life', () => {
    const e = { delta: 0.4, setAt: NOW - 7 * DAY, halfLifeDays: 7 }
    expect(decayedGuidance(e, NOW)).toBeCloseTo(0.2, 6)
  })

  it('is at full strength the moment it is set', () => {
    expect(decayedGuidance({ delta: 0.4, setAt: NOW, halfLifeDays: 7 }, NOW)).toBeCloseTo(0.4, 6)
  })

  it('fades towards nothing, so owners must keep educating', () => {
    const e = { delta: 0.9, setAt: NOW - 70 * DAY, halfLifeDays: 7 }
    expect(Math.abs(decayedGuidance(e, NOW))).toBeLessThan(0.001)
  })
})

describe('resolveValues', () => {
  it('sums the three strata', () => {
    const p = personality({
      base: { ...zeroVector(), honesty: 0.5 },
      drift: { ...zeroVector(), honesty: -0.2 },
      guidance: { honesty: { delta: 0.4, setAt: NOW, halfLifeDays: 7 } },
    })
    expect(resolveValues(p, NOW).honesty).toBeCloseTo(0.7, 6)
  })

  it('lets life contradict the owner — drift can flip an axis outright', () => {
    const p = personality({
      base: { ...zeroVector(), honesty: 0.8 },
      drift: { ...zeroVector(), honesty: -1.0 },
    })
    expect(resolveValues(p, NOW).honesty).toBeCloseTo(-0.2, 6)
  })

  it('clamps to the −1..1 range', () => {
    const p = personality({
      base: { ...zeroVector(), loyalty: 0.9 },
      drift: { ...zeroVector(), loyalty: 0.9 },
    })
    expect(resolveValues(p, NOW).loyalty).toBe(1)
  })
})
