/**
 * Agent bodies: one rigged Kenney character per agent, its walk route, and the
 * off-screen portrait pass that gives the sidebar the same face as the street.
 */
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { hash } from '../core/hash.js'
import { CHARACTER_IDS, characterIdFor } from '../core/characters-data.js'
import { registerPortrait } from '../ui/avatar.js'
import type { CityGrid } from './grid.js'
import { INDOOR_KINDS, type ModelLibrary } from './assets.js'
import type { AgentSnapshot, WorldInfo } from '../core/connection.js'

/** Everything the render loop needs to draw and animate one agent. */
export type AgentView = {
  id: string
  name: string
  mesh: THREE.Group
  mixer: THREE.AnimationMixer | null
  clips: Map<string, THREE.AnimationClip>
  currentAnim: string
  /** Smoothed draw position, in grid units. */
  x: number
  y: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Engine-reported journey progress, and the eased value chasing it. */
  targetP: number
  p: number
  travelling: boolean
  spread: { x: number; y: number }
  state: string
  partner: string | null
  at: string
  /** The scale set by ModelLibrary normalisation, preserved for door animation. */
  baseScale: number
  /** 1 = fully visible outdoors, 0 = hidden indoors. Animated smoothly. */
  doorScale: number
}

export function animForState(state: string): string {
  switch (state) {
    case 'travel':
      return 'walk'
    case 'scene':
      return 'idle'
    case 'work':
    case 'relax':
    case 'eat':
    case 'browse':
    case 'sleep':
      return 'sit'
    default:
      return 'idle'
  }
}

/** Fallback body for when a character GLB failed to load. */
function capsuleBody(): THREE.Group {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.15, 0.5, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x3498db }),
  )
  body.position.y = 0.4
  body.castShadow = true
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xf0d0b0 }),
  )
  head.position.y = 0.8
  head.castShadow = true
  const group = new THREE.Group()
  group.add(body, head)
  return group
}

export type AgentActors = {
  views: Map<string, AgentView>
  /** Roots to raycast for hover and click. */
  pickable: THREE.Object3D[]
  labels: Map<string, HTMLDivElement>
}

export function createAgents(
  scene: THREE.Scene,
  grid: CityGrid,
  world: WorldInfo,
  models: ModelLibrary,
  overlay: HTMLElement,
): AgentActors {
  const views = new Map<string, AgentView>()
  const pickable: THREE.Object3D[] = []
  const labels = new Map<string, HTMLDivElement>()

  for (const a of world.agents) {
    const charKey = `char-${characterIdFor(a.id)}`
    const template = models.get(charKey)

    let group: THREE.Group
    let mixer: THREE.AnimationMixer | null = null
    const clips = new Map<string, THREE.AnimationClip>()

    if (template) {
      // SkeletonUtils.clone, not Object3D.clone — a plain clone shares the skeleton
      group = SkeletonUtils.clone(template) as THREE.Group
      const rawClips = models.clipsFor(charKey)
      if (rawClips) {
        mixer = new THREE.AnimationMixer(group)
        for (const clip of rawClips) clips.set(clip.name, clip)
        const idle = clips.get('idle')
        if (idle) mixer.clipAction(idle).play()
      }
    } else {
      group = capsuleBody()
    }

    group.userData = { agentId: a.id, agentName: a.name, pick: { agentId: a.id } }
    pickable.push(group)

    const home = world.locations.find((l) => l.id === `home-${a.id}`)
    const start = { x: home?.x ?? grid.size / 2, y: home?.y ?? grid.size / 2 }
    group.position.copy(grid.worldPos(start.x, start.y))
    scene.add(group)

    const label = document.createElement('div')
    label.className = 'agent-label'
    label.textContent = a.name
    label.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: a.id } }))
    })
    overlay.appendChild(label)
    labels.set(a.id, label)

    views.set(a.id, {
      id: a.id,
      name: a.name,
      mesh: group,
      mixer,
      clips,
      currentAnim: 'idle',
      x: start.x,
      y: start.y,
      from: start,
      to: start,
      targetP: 1,
      p: 1,
      travelling: false,
      spread: { x: 0, y: 0 },
      state: 'idle',
      partner: null,
      at: home?.id ?? '',
      baseScale: group.scale.x,
      doorScale: 1,
    })
  }

  return { views, pickable, labels }
}

/**
 * Head-and-shoulders portraits rendered off-screen from the character GLBs, so
 * DOM avatars are literally the same model as the body in the street.
 */
export function renderPortraits(models: ModelLibrary): void {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  r.setClearColor(0x000000, 0)
  r.outputColorSpace = THREE.SRGBColorSpace

  const stage = new THREE.Scene()
  stage.add(new THREE.AmbientLight(0xffffff, 2.0))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(1, 2, 3)
  stage.add(key)
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50)

  for (const id of CHARACTER_IDS) {
    const template = models.get(`char-${id}`)
    if (!template) continue
    const model = SkeletonUtils.clone(template)
    stage.add(model)

    const box = new THREE.Box3().setFromObject(model)
    const h = box.max.y - box.min.y
    const target = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + h * 0.86, 0)
    cam.position.set(target.x, target.y + h * 0.02, target.z + h * 0.62)
    cam.lookAt(target)
    r.render(stage, cam)
    registerPortrait(id, canvas.toDataURL('image/png'))

    stage.remove(model)
  }
  r.dispose()
}

export function isIndoors(grid: CityGrid, v: AgentView): boolean {
  if (v.travelling) return false
  const loc = grid.locById.get(v.at)
  return loc != null && INDOOR_KINDS.has(loc.kind)
}

/**
 * Agents walk the streets rather than cutting across blocks: out to the nearest
 * road, along it, then in to the destination.
 */
export function routePoint(v: AgentView, p: number, period: number): { x: number; y: number } {
  const toStreet = (n: number): number => Math.round(n / period) * period
  const { from, to } = v
  const roadY = toStreet(from.y)
  const roadX = toStreet(to.x)

  const legs: [{ x: number; y: number }, { x: number; y: number }][] = [
    [from, { x: from.x, y: roadY }],
    [
      { x: from.x, y: roadY },
      { x: roadX, y: roadY },
    ],
    [
      { x: roadX, y: roadY },
      { x: roadX, y: to.y },
    ],
    [{ x: roadX, y: to.y }, to],
  ]
  const lengths = legs.map(([a, b]) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y))
  const total = lengths.reduce((s, l) => s + l, 0)
  if (total < 1e-6) return { ...to }

  let want = p * total
  for (let i = 0; i < legs.length; i++) {
    const len = lengths[i]!
    if (want <= len || i === legs.length - 1) {
      const t = len < 1e-6 ? 1 : Math.min(1, want / len)
      const [a, b] = legs[i]!
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    want -= len
  }
  return { ...to }
}

/** Fan agents sharing a tile apart, keeping conversation partners face to face. */
function spreadOffset(a: AgentSnapshot, here: string[]): { x: number; y: number } {
  if (here.length < 2) return { x: 0, y: 0 }
  if (a.partner != null && here.includes(a.partner)) {
    const first = a.id < a.partner
    return { x: first ? -0.3 : 0.3, y: first ? 0.3 : -0.3 }
  }
  const i = here.indexOf(a.id)
  const angle = (i / here.length) * Math.PI * 2 + (hash(a.id) % 100) / 100
  const r = 0.34
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
}

/** Fold an engine state message into the views the render loop interpolates. */
export function updateAgentViews(views: Map<string, AgentView>, agents: AgentSnapshot[]): void {
  const crowd = new Map<string, string[]>()
  for (const a of agents) {
    const key = `${Math.round(a.x)},${Math.round(a.y)}`
    const list = crowd.get(key) ?? []
    list.push(a.id)
    crowd.set(key, list)
  }

  for (const a of agents) {
    const v = views.get(a.id)
    if (v == null) continue
    v.state = a.state
    v.partner = a.partner
    v.at = a.at
    v.travelling = a.state === 'travel' && a.progress < 1
    v.from = a.from
    v.to = a.to
    v.targetP = a.progress
    if (!v.travelling) v.p = 1
    else if (v.p > a.progress) v.p = a.progress
    v.spread = spreadOffset(a, crowd.get(`${Math.round(a.x)},${Math.round(a.y)}`) ?? [a.id])
  }
}

/** Crossfade to the clip the agent's current state calls for. */
export function syncAnimation(v: AgentView, walking: boolean, dtSec: number): void {
  const wantAnim = walking ? 'walk' : animForState(v.state)
  if (v.mixer && wantAnim !== v.currentAnim) {
    const nextClip = v.clips.get(wantAnim) ?? v.clips.get('idle')
    const prevClip = v.clips.get(v.currentAnim)
    if (nextClip) {
      const next = v.mixer.clipAction(nextClip)
      next.reset().play()
      if (prevClip) v.mixer.clipAction(prevClip).crossFadeTo(next, 0.25, true)
    }
    v.currentAnim = wantAnim
  }
  v.mixer?.update(dtSec)
}
