/**
 * World time.
 *
 * A tick is a configurable slice of *world* time, separate from how fast we
 * simulate it. Real time would be tedious to watch; this lets a day pass in
 * seconds while the world still believes a day passed.
 *
 * ⚠️ Everything tuned against the clock must be expressed in world duration —
 * hours, or times-per-day — and converted with the helpers below. Constants
 * written directly in ticks silently rebalance the whole world when the tick
 * size changes: at 10-minute ticks, hardcoded per-tick need decay halves how
 * often agents eat, and a 24-tick sleep becomes four hours instead of two.
 */

/** World minutes that pass per tick. The one knob; everything else derives. */
export const MINUTES_PER_TICK = Number(process.env.MINUTES_PER_TICK ?? 5)

export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR

/** Where the world's calendar starts when a server boots with no saved state. */
export const WORLD_EPOCH_ISO = '1984-12-13T00:00:00.000Z'
export const WORLD_EPOCH = Date.parse(WORLD_EPOCH_ISO)

export const MS_PER_TICK = MINUTES_PER_TICK * 60_000

/** The in-world instant a tick happens at. */
export const worldTime = (tick: number): Date => new Date(WORLD_EPOCH + tick * MS_PER_TICK)

export const tickAt = (instant: Date | number): number =>
  Math.round(((typeof instant === 'number' ? instant : instant.getTime()) - WORLD_EPOCH) / MS_PER_TICK)

// ---- converting world durations into ticks --------------------------------

export const hours = (h: number): number => Math.max(1, Math.round(h * TICKS_PER_HOUR))
export const minutes = (m: number): number => Math.max(1, Math.round(m / MINUTES_PER_TICK))

/** A rate given per day, expressed per tick. */
export const perDay = (amount: number): number => amount / TICKS_PER_DAY

/**
 * How much a 0..1 meter must grow each tick to cross `threshold` `times` a day.
 * Keeps vice and need tuning readable: "gambling bites twice a day" rather
 * than "0.0035, trust me".
 */
export const timesPerDay = (times: number, threshold = 1): number =>
  (threshold * times) / TICKS_PER_DAY

export const hourOfDay = (tick: number, ticksPerDay = TICKS_PER_DAY): number =>
  Math.floor(((tick % ticksPerDay) / ticksPerDay) * 24)

export const dayOf = (tick: number, ticksPerDay = TICKS_PER_DAY): number =>
  Math.floor(tick / ticksPerDay)

/**
 * The tick that rolls over to a new day — midnight, not dusk. Everything
 * book-keeping-shaped happens here: rent is charged, daily counters reset,
 * goals are re-derived and reflection is queued.
 */
export const isDayBoundary = (tick: number, ticksPerDay = TICKS_PER_DAY): boolean =>
  tick % ticksPerDay === 0
