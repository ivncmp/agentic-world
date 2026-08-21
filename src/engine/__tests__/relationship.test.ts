import { describe, it, expect } from 'vitest'
import { adjustFeeling, coolFeeling, FEELING_DAILY_DECAY } from '../relationship.js'

describe('adjustFeeling', () => {
  it('applies a delta at full strength from neutral', () => {
    expect(adjustFeeling(0, -0.3)).toBeCloseTo(-0.3)
    expect(adjustFeeling(0, 0.25)).toBeCloseTo(0.25)
  })

  it('damps a push that goes further out', () => {
    // At −0.8 a further −0.3 must land well short of −1.1-clamped-to-−1.
    expect(adjustFeeling(-0.8, -0.3)).toBeCloseTo(-0.86)
    expect(adjustFeeling(0.9, 0.5)).toBeCloseTo(0.95)
  })

  it('never damps a pull back toward neutral', () => {
    // Forgiving is not made harder by having hated hard.
    expect(adjustFeeling(-0.9, 0.3)).toBeCloseTo(-0.6)
    expect(adjustFeeling(0.9, -0.3)).toBeCloseTo(0.6)
  })

  /**
   * The regression this whole module exists for: eleven pairs sat at exactly
   * −1.00, which made "annoyed" and "mortal enemy" the same number. Repeated
   * hostility must keep them apart.
   */
  it('preserves ordering under sustained hostility', () => {
    let mild = 0
    let severe = 0
    for (let i = 0; i < 20; i++) {
      mild = adjustFeeling(mild, -0.1)
      severe = adjustFeeling(severe, -0.4)
    }
    expect(severe).toBeLessThan(mild)
    expect(mild).toBeGreaterThan(-1)
    expect(severe).toBeGreaterThan(-1)
  })

  /**
   * In exact arithmetic the scale is asymptotic and −1 is unreachable; in
   * float64 enough sustained hostility rounds onto it. Asserting "never
   * reaches" would be testing a mathematical idealisation the machine does not
   * honour, so assert what the design actually needs: getting there takes
   * implausible, uninterrupted hostility, and it is not an absorbing state —
   * a day of cooling always lifts a pair back off the floor.
   */
  it('only pins to the extreme under implausible sustained hostility', () => {
    let v = 0
    for (let i = 0; i < 10; i++) v = adjustFeeling(v, -0.9)
    expect(v).toBeGreaterThan(-1)

    for (let i = 0; i < 500; i++) v = adjustFeeling(v, -0.9)
    expect(v).toBeLessThan(-0.99)
    expect(coolFeeling(v)).toBeGreaterThan(v)
  })
})

describe('coolFeeling', () => {
  it('pulls toward neutral from both directions', () => {
    expect(coolFeeling(-1)).toBeCloseTo(-FEELING_DAILY_DECAY)
    expect(coolFeeling(0.5)).toBeCloseTo(0.5 * FEELING_DAILY_DECAY)
  })

  it('snaps a negligible feeling to exactly zero', () => {
    // Otherwise relationships accumulate endless 1e-8 noise that never settles.
    expect(coolFeeling(0.005)).toBe(0)
  })

  it('lets a pair climb off the floor given enough quiet days', () => {
    let v = -1
    for (let day = 0; day < 30; day++) v = coolFeeling(v)
    expect(v).toBeGreaterThan(-0.5)
  })

  it('leaves neutral alone', () => {
    expect(coolFeeling(0)).toBe(0)
  })
})
