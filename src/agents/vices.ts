/**
 * Vices are not low values — they are active pulls with a trigger, a growing
 * urge and a cost. DESIGN.md makes two mandatory per agent: they are the
 * designed friction that stops the world becoming uniformly pleasant.
 */
import type { LocationKind } from '../world/locations.js'
import { timesPerDay } from '../engine/clock.js'

/**
 * Where a vice bites, how fast it builds, and what indulging it costs.
 */
export type ViceDefinition = {
  label: string
  /**
   * Where the urge is provoked.
   */
  triggers: readonly LocationKind[]
  /**
   * How many times a day the urge crosses VICE_URGE_THRESHOLD if left untended.
   * Stated as a frequency rather than a per-tick delta: a vice is meant to be
   * an episodic crisis, and "twice a day" survives a change of tick size where
   * "0.0035" quietly would not.
   */
  bitesPerDay: number
  /**
   * Credits burned per indulgence.
   */
  moneyCost: number
  /**
   * How much an active urge raises the odds of a scene.
   */
  conflictWeight: number
}

/**
 * Closed catalogue, extensible by adding entries: `ViceKind` is derived from
 * the keys, so a new vice widens the type automatically while an arbitrary
 * string still fails to compile. Free-text vices would need an LLM call to
 * interpret, which the reflex layer cannot afford.
 */
export const VICE_CATALOG = {
  gambling: {
    label: 'Gambling',
    triggers: ['bar'],
    bitesPerDay: 2,
    moneyCost: 40,
    conflictWeight: 1.5,
  },
  drinking: {
    label: 'Drinking',
    triggers: ['bar'],
    bitesPerDay: 3,
    moneyCost: 12,
    conflictWeight: 1.2,
  },
  vanity: {
    label: 'Vanity',
    triggers: ['shop'],
    bitesPerDay: 1,
    moneyCost: 60,
    conflictWeight: 0.8,
  },
  envy: {
    label: 'Envy',
    triggers: ['office', 'home'],
    bitesPerDay: 2,
    moneyCost: 0,
    conflictWeight: 2.0,
  },
  grudge: {
    label: 'Grudge-holding',
    triggers: ['bar', 'office', 'shop', 'home'],
    bitesPerDay: 1.5,
    moneyCost: 0,
    conflictWeight: 2.5,
  },
  idleness: {
    label: 'Idleness',
    triggers: ['home'],
    bitesPerDay: 3,
    moneyCost: 0,
    conflictWeight: 0.5,
  },
} as const satisfies Record<string, ViceDefinition>

/**
 * Derived from the catalogue's keys, so adding an entry widens the type while
 * an arbitrary string still fails to compile. Free-text vices would need a
 * model call to interpret, which the reflex layer cannot afford.
 */
export type ViceKind = keyof typeof VICE_CATALOG

/**
 * A vice as carried by an agent: the kind, plus an `urge` that climbs until it
 * is indulged.
 */
export type ViceInstance = {
  kind: ViceKind
  urge: number // 0..1
}

/**
 * The static definition behind an agent's vice: label, trigger, cost.
 */
export const viceDef = (kind: ViceKind): ViceDefinition => VICE_CATALOG[kind]

/**
 * Per-tick urge growth, derived so a vice reaches `threshold` at its own daily
 * frequency.
 */
export const urgeGrowth = (kind: ViceKind, threshold: number): number =>
  timesPerDay(VICE_CATALOG[kind].bitesPerDay, threshold)
