/**
 * FNV-1a over the joined parts. Stable across processes, builds and reloads.
 *
 * Used wherever something must look varied without being random: which building
 * the viewer draws on a filler tile, which angle a prompt takes this tick. The
 * tick loop and the viewer both have to stay reproducible, so neither may reach
 * for `Math.random`.
 */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Deterministically picks one entry from a non-empty list. */
export function pickBy<T>(items: readonly T[], ...parts: (string | number)[]): T {
  return items[hash(...parts) % items.length]!
}
