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

/** Derived, never configured — everything time-related hangs off these two. */
export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR

/** Where the world's calendar starts when a server boots with no saved state. */
export const WORLD_EPOCH_ISO = '1984-12-13T00:00:00.000Z'
/** The epoch as milliseconds. A fixed instant, so tick ↔ date round-trips. */
export const WORLD_EPOCH = Date.parse(WORLD_EPOCH_ISO)

/** Real milliseconds a tick *represents*, not how long it takes to compute. */
export const MS_PER_TICK = MINUTES_PER_TICK * 60_000

/** The in-world instant a tick happens at. */
export const worldTime = (tick: number): Date => new Date(WORLD_EPOCH + tick * MS_PER_TICK)

/** The inverse of `worldTime` — used to read a tick back out of a dbrain fact. */
export const tickAt = (instant: Date | number): number =>
  Math.round(((typeof instant === 'number' ? instant : instant.getTime()) - WORLD_EPOCH) / MS_PER_TICK)

// ---- converting world durations into ticks --------------------------------

/** Ticks in a span of game hours. Always at least one, so nothing is instant. */
export const hours = (h: number): number => Math.max(1, Math.round(h * TICKS_PER_HOUR))
/** Ticks in a span of game minutes. Always at least one. */
export const minutes = (m: number): number => Math.max(1, Math.round(m / MINUTES_PER_TICK))

/** A rate given per day, expressed per tick. */
/**
 * Spreads a per-day quantity across the ticks in a day.
 *
 * Rates are written per day and converted here, never written per tick. A wage
 * paid per tick once earned 92x rent a day, and the number looked reasonable
 * right up until someone read the ledger.
 */
export const perDay = (amount: number): number => amount / TICKS_PER_DAY

/**
 * How much a 0..1 meter must grow each tick to cross `threshold` `times` a day.
 * Keeps vice and need tuning readable: "gambling bites twice a day" rather
 * than "0.0035, trust me".
 */
export const timesPerDay = (times: number, threshold = 1): number => (threshold * times) / TICKS_PER_DAY

/** Hour of the game day, 0..23. Drives shifts, sleep and the viewer's sun. */
export const hourOfDay = (tick: number, ticksPerDay = TICKS_PER_DAY): number =>
  Math.floor(((tick % ticksPerDay) / ticksPerDay) * 24)

/** Which game day a tick falls in, counting from the epoch. */
export const dayOf = (tick: number, ticksPerDay = TICKS_PER_DAY): number => Math.floor(tick / ticksPerDay)

/**
 * The tick that rolls over to a new day — midnight, not dusk. Everything
 * book-keeping-shaped happens here: rent is charged, daily counters reset,
 * goals are re-derived and reflection is queued.
 */
export const isDayBoundary = (tick: number, ticksPerDay = TICKS_PER_DAY): boolean => tick % ticksPerDay === 0

/** 0 = Sunday, 6 = Saturday. Derived from the epoch (Thu Dec 13, 1984). */
/** 0 = Sunday. Occupations use it so weekends actually differ from weekdays. */
export const dayOfWeek = (tick: number, ticksPerDay = TICKS_PER_DAY): number =>
  worldTime(Math.floor(tick / ticksPerDay) * ticksPerDay).getUTCDay()
