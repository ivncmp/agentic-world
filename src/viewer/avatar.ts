/**
 * Face avatars for DOM lists.
 *
 * Portraits are rendered once from the same Kenney GLB models the 3D scene
 * uses (see `CityScene3D.renderPortraits`), keyed by character id — so a face
 * in the sidebar is always the character walking around the city.
 */
import { characterIdFor } from './characters-data.js'

const portraits = new Map<string, string>()

export function registerPortrait(charId: string, dataUrl: string): void {
  portraits.set(charId, dataUrl)
}

export function avatarDataUrl(agentId: string): string {
  return portraits.get(characterIdFor(agentId)) ?? ''
}

export function avatarImg(agentId: string, size = 22): string {
  const url = avatarDataUrl(agentId)
  if (!url) return ''
  return `<img src="${url}" width="${size}" height="${size}" style="vertical-align:-6px;margin-right:5px;border-radius:50%;background:var(--panel-2,#1b2430)">`
}
