/**
 * Single source of truth for which Kenney character model represents an agent.
 *
 * Both the 3D scene and the DOM avatars resolve through `characterIdFor`, so a
 * sidebar face always matches the body walking the street.
 */
import { hash } from './hash.js'

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

export type CharacterId = (typeof CHARACTER_IDS)[number]

export const CHARACTER_GLB = (id: string): string => `/assets/people/Models/GLB format/character-${id}.glb`

export function characterIdFor(agentId: string): CharacterId {
  return CHARACTER_IDS[hash(agentId) % CHARACTER_IDS.length]!
}
