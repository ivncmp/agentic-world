/**
 * Stable per-id hash: the same venue draws the same building every reload.
 *
 * Re-exported from the shared implementation so the viewer and the cognition
 * prompts cannot drift into two different hashes.
 */
export { hash, pickBy } from '../../shared/hash.js'
