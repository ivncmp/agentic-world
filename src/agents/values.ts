/**
 * Personality values: seven axes chosen because the reflex layer can consult
 * each one to pick an action. Descriptive models (Big Five) are not usable
 * here — an axis earns its place only if some decision branches on it.
 */
export const VALUE_AXES = [
  'honesty', // lie or steal when cornered
  'industriousness', // work vs slack off
  'thrift', // save vs spend
  'sociability', // seek company vs avoid it
  'riskTolerance', // gamble, borrow, take chances
  'loyalty', // honour debts and friendships vs self-interest
  'pride', // refuse help vs ask for it
] as const

export type ValueAxis = (typeof VALUE_AXES)[number]

/** Every axis runs −1..+1. */
export type ValueVector = Record<ValueAxis, number>

/**
 * One piece of owner guidance on one axis. Guidance decays: educating pushes,
 * but stops mattering unless reinforced. Without decay agents accumulate an
 * ever-growing rulebook and stop surprising their owner.
 */
export type GuidanceEntry = {
  delta: number
  setAt: number // epoch ms
  halfLifeDays: number
}

/**
 * Personality is three strata that sum. Keeping them separate is what lets
 * creation, education and lived experience each remain visible and revisable.
 */
export type PersonalityValues = {
  base: ValueVector // owner-authored at creation; effectively immutable
  drift: ValueVector // written by nightly reflection — what life did
  guidance: Partial<Record<ValueAxis, GuidanceEntry>> // owner education; decays
}

const DAY_MS = 86_400_000

export const clampAxis = (n: number): number => Math.max(-1, Math.min(1, n))

export function zeroVector(): ValueVector {
  return Object.fromEntries(VALUE_AXES.map((a) => [a, 0])) as ValueVector
}

/** Remaining strength of a guidance entry after exponential half-life decay. */
export function decayedGuidance(entry: GuidanceEntry, now: number): number {
  const ageDays = Math.max(0, now - entry.setAt) / DAY_MS
  return entry.delta * 0.5 ** (ageDays / entry.halfLifeDays)
}

/**
 * effective = clamp(base + drift + decayed guidance)
 *
 * Drift is deliberately allowed to overpower base: an agent whose life
 * contradicts how its owner wrote it is the story working, not a bug.
 */
export function resolveValues(v: PersonalityValues, now: number): ValueVector {
  const out = zeroVector()
  for (const axis of VALUE_AXES) {
    const g = v.guidance[axis]
    out[axis] = clampAxis(v.base[axis] + v.drift[axis] + (g ? decayedGuidance(g, now) : 0))
  }
  return out
}
