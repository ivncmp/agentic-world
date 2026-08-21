/**
 * Seeded LCG. Every generated world and every soak run is reproducible, so a
 * behaviour change is attributable to the change and not to luck.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const pick = <T>(rng: () => number, xs: readonly T[]): T => {
  const item = xs[Math.floor(rng() * xs.length)]
  if (item === undefined) throw new Error('pick from empty list')
  return item
}

export const range = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))
