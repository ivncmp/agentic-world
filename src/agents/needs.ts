/**
 * Needs and vice urges — the pressure that makes the reflex layer act.
 *
 * Needs count *up* toward 1 = desperate, so decay adds pressure rather than
 * removing it. Rates are written per world day and converted to per tick, so
 * the numbers stay meaningful if the tick size ever changes.
 *
 * Every need must have something that satisfies it. A decaying need with no
 * consumer is dead weight that quietly starves an agent of options.
 */
import type { Agent, Needs } from './agent.js'
import { urgeGrowth } from './vices.js'
import { perDay } from '../engine/clock.js'
import { VICE_URGE_THRESHOLD } from '../engine/actions.js'

/**
 * How far each need travels across a whole world day, on the 0..1 scale.
 * Written per *day* rather than per tick so the numbers stay meaningful and
 * survive a change of tick size — hunger crossing 1.7 a day means roughly
 * three meals whether a tick is five minutes or fifteen.
 */
export const NEED_PER_DAY: Needs = {
  hunger: 1.73,
  energy: 1.44,
  social: 1.73,
  hygiene: 0.86,
  fun: 1.44,
}

/**
 * The per-day rates above, converted to the per-tick amounts the loop adds.
 */
export const NEED_DECAY: Needs = {
  hunger: perDay(NEED_PER_DAY.hunger),
  energy: perDay(NEED_PER_DAY.energy),
  social: perDay(NEED_PER_DAY.social),
  hygiene: perDay(NEED_PER_DAY.hygiene),
  fun: perDay(NEED_PER_DAY.fun),
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Needs count *up* towards 1 = desperate, so decay adds pressure.
 */
export function decayNeeds(needs: Needs): Needs {
  return {
    hunger: clamp01(needs.hunger + NEED_DECAY.hunger),
    energy: clamp01(needs.energy + NEED_DECAY.energy),
    social: clamp01(needs.social + NEED_DECAY.social),
    hygiene: clamp01(needs.hygiene + NEED_DECAY.hygiene),
    fun: clamp01(needs.fun + NEED_DECAY.fun),
  }
}

/**
 * Pushes each vice's urge up by its own rate. Calibrated against
 * `VICE_URGE_THRESHOLD` so a vice fires one to three times a day — often enough
 * to shape a life, rare enough to stay an event.
 */
export function growViceUrges(agent: Agent): Agent['vices'] {
  return agent.vices.map((v) => ({
    ...v,
    urge: clamp01(v.urge + urgeGrowth(v.kind, VICE_URGE_THRESHOLD)),
  })) as Agent['vices']
}
