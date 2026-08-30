/**
 * Single source of truth for which Kenney character model represents an agent.
 *
 * Both the 3D scene and the DOM avatars resolve through `characterIdFor`, so a
 * sidebar face always matches the body walking the street.
 */
import { hash } from './hash.js'

/**
 * The 18 rigged Kenney characters available to represent an agent.
 */
export const CHARACTER_IDS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
] as const

/**
 * Derived from the array above.
 */
export type CharacterId = (typeof CHARACTER_IDS)[number]

/**
 * Path to one character's model. Textures are external — see the viewer README.
 */
export const CHARACTER_GLB = (id: string): string => `/assets/people/Models/GLB format/character-${id}.glb`

/**
 * The single source of truth for which face belongs to which agent. Both the 3D
 * scene and the DOM avatars resolve through here; a second mapping is how the
 * sidebar once showed a different person from the one in the street.
 */
export function characterIdFor(agentId: string): CharacterId {
  return CHARACTER_IDS[hash(agentId) % CHARACTER_IDS.length]!
}
