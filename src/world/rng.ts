/**
 * Seeded LCG. Every generated world and every soak run is reproducible, so a
 * behaviour change is attributable to the change and not to luck.
 */
/**
 * A seeded PRNG. Everything random in world generation goes through one of
 * these, so the same seed always produces the same town.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** One element, chosen with the given generator rather than `Math.random`. */
export const pick = <T>(rng: () => number, xs: readonly T[]): T => {
  const item = xs[Math.floor(rng() * xs.length)]
  if (item === undefined) throw new Error('pick from empty list')
  return item
}

/** An integer in `[min, max]`, inclusive. */
export const range = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))
