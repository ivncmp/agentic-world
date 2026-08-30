/**
 * How feelings move. Two rules, both of which exist because a hard clamp plus
 * one-way accumulation produced a village of mutual enemies by day 8: of 56
 * pairs, one was warm, eleven were pinned at exactly −1.00, and the rest sat
 * slightly negative.
 *
 * The bug was structural, not a tuning accident. `grievance` already decays
 * daily, but `affection` and `trust` only ever had things *added* to them and
 * were then clamped. Conflict scenes outnumber pleasant ones — that is what the
 * gate selects for — so the only available direction was down, and the floor
 * was an absorbing state nothing could climb out of.
 */

/**
 * Fraction of a feeling that survives a day with no contact at all.
 */
export const FEELING_DAILY_DECAY = 0.97

/**
 * Apply a delta with diminishing returns near the extremes.
 *
 * Pushing further out gets harder the stronger the feeling already is, so the
 * scale is asymptotic rather than clamped: you approach ±1 without ever landing
 * on it. That matters because a hard clamp destroys ordering — once three
 * different people are all at exactly −1.00 the world can no longer tell
 * "annoyed" from "mortal enemy", and neither can the scene prompt that reads
 * the number back.
 *
 * Pulling *toward* neutral is never damped: forgiving is not made harder by
 * having hated hard.
 */
export function adjustFeeling(current: number, delta: number): number {
  if (delta === 0) return current
  const outward = Math.sign(delta) === Math.sign(current) || current === 0
  const scaled = outward ? delta * (1 - Math.abs(current)) : delta
  return Math.max(-1, Math.min(1, current + scaled))
}

/**
 * One day of cooling toward neutral. Feelings that are not reinforced fade, the
 * same way a wrong does — a half-life of about three weeks, so a friendship
 * survives a holiday but a grudge nobody feeds does not become permanent.
 *
 * This is what makes the floor escapable, and it is why the world can now hold
 * a spectrum instead of collapsing to hostility.
 */
export const coolFeeling = (v: number): number => {
  const next = v * FEELING_DAILY_DECAY
  return Math.abs(next) < 0.01 ? 0 : next
}
