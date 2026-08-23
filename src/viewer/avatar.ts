/**
 * Tiny face avatars extracted from the character sprite sheets.
 *
 * The idle-facing-camera frame (row 0, dir 1, frame 0) is cropped to the head
 * region and cached as a data URL so DOM elements can show it inline.
 */
import { sheetKeyFor, SHEET_DIR, FRAME_SIZE, CHARACTER_IDS } from './character.js'
import { hash } from './atlas.js'

const FACING_DIR = 1
const COLS = 8
const DIRS = 8
const AVATAR_FRAME = FACING_DIR * COLS

const HEAD_TOP = 12
const HEAD_LEFT = 16
const HEAD_SIZE = 44

const cache = new Map<string, string>()
let ready = false

export function avatarDataUrl(agentId: string): string {
  return cache.get(agentId) ?? ''
}

export function buildAvatarCache(agentIds: string[]): Promise<void> {
  if (ready) return Promise.resolve()

  const sheetIds = new Map<string, string[]>()
  for (const id of agentIds) {
    const key = sheetKeyFor(id)
    const list = sheetIds.get(key) ?? []
    list.push(id)
    sheetIds.set(key, list)
  }

  const promises: Promise<void>[] = []
  for (const [key, ids] of sheetIds) {
    const charId = CHARACTER_IDS[hash(ids[0]!, 'who') % CHARACTER_IDS.length]!
    const path = `${SHEET_DIR}/character-${charId}.png`
    promises.push(
      loadAndCrop(path).then((dataUrl) => {
        for (const id of ids) cache.set(id, dataUrl)
      }),
    )
  }

  return Promise.all(promises).then(() => { ready = true })
}

export function addToCache(agentId: string): Promise<void> {
  if (cache.has(agentId)) return Promise.resolve()
  const charId = CHARACTER_IDS[hash(agentId, 'who') % CHARACTER_IDS.length]!
  const path = `${SHEET_DIR}/character-${charId}.png`
  return loadAndCrop(path).then((dataUrl) => { cache.set(agentId, dataUrl) })
}

function loadAndCrop(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const frameX = (AVATAR_FRAME % COLS) * FRAME_SIZE
      const frameY = Math.floor(AVATAR_FRAME / COLS) * FRAME_SIZE
      const c = document.createElement('canvas')
      c.width = HEAD_SIZE
      c.height = HEAD_SIZE
      const ctx = c.getContext('2d')!
      ctx.drawImage(
        img,
        frameX + HEAD_LEFT, frameY + HEAD_TOP, HEAD_SIZE, HEAD_SIZE,
        0, 0, HEAD_SIZE, HEAD_SIZE,
      )
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve('')
    img.src = src
  })
}

export function avatarImg(agentId: string, size = 22): string {
  const url = avatarDataUrl(agentId)
  if (!url) return ''
  return `<img src="${url}" width="${size}" height="${size}" style="vertical-align:-6px;margin-right:5px;border-radius:50%;image-rendering:pixelated">`
}
