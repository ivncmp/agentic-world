/**
 * The city, drawn.
 *
 * Three things change on three different clocks: the map never changes, agents
 * move every tick and are interpolated every frame, and conversations play back
 * at reading pace.
 */
import Phaser from 'phaser'
import {
  TILE_W, TILE_H, STOREY, GROUND_ANCHOR_Y, BASE_ANCHOR_Y,
  LAYER, depthAt, rotateTile, rotateMask, toScreen, type Rot,
} from './iso.js'
import {
  ROADS_DIR, DETAILS_DIR, GROUND_KEYS, PROP_KEYS, DETAIL_SPRITES, DETAIL_SCALE,
  ROAD_BY_MASK, BUILDING_TILES, buildingKey, buildingPath, KIND_COLOR, hash,
} from './atlas.js'
import { buildCityMap, type CityMap } from './city-map.js'
import {
  Character, animForState, dirFor, characterSheets, FRAME_SIZE,
  type AnimName,
} from './character.js'
import { SpeechBubble, Conversation } from './bubble.js'
import { avatarDataUrl } from './avatar.js'
import type { EngineConnection, WorldInfo, LocationInfo, AgentSnapshot, StateMsg, FeedItem } from './connection.js'
import { cssHex } from './theme.js'

type Point = { x: number; y: number }

/** Location kinds that are enclosed buildings — characters go invisible inside. */
const INDOOR_KINDS = new Set(['home', 'bar', 'office', 'shop', 'supermarket', 'clinic', 'school', 'gym', 'garage', 'cinema', 'bowling', 'cafe'])

const STATE_LABEL: Record<string, string> = {
  eat: 'eating', sleep: 'sleeping', work: 'working', socialize: 'chatting',
  seek_job: 'job seeking', indulge_vice: 'indulging', steal: 'stealing',
  relax: 'relaxing', exercise: 'exercising', browse: 'browsing', wash: 'washing',
  idle: 'idle', scene: 'talking',
}

const ROLE_LABEL: Record<string, string> = {
  residential: 'Residential', civic: 'Offices', plaza: 'Plaza', green: 'Park',
}
const ROLE_COLOR: Record<string, number> = {
  residential: 0x94a3b8, civic: 0x60a5fa, plaza: 0xfbbf24, green: 0x4ade80,
}

type AgentView = {
  id: string
  name: string
  char: Character
  badge: Phaser.GameObjects.Container
  /** Drawn position, in world tiles. */
  x: number
  y: number
  /** The journey the engine says this agent is on. */
  from: Point
  to: Point
  /** Server-reported progress, and the eased value actually drawn. */
  targetP: number
  p: number
  travelling: boolean
  /** Where this agent stands within its tile, to keep a crowd legible. */
  spread: Point
  dir: number
  state: string
  partner: string | null
  /** Current location id from the engine. */
  at: string
}

type VenueView = {
  loc: LocationInfo
  /** Screen position of the building's roof, for tooltip anchoring. */
  px: number
  py: number
  rx: number
  ry: number
  roof: number
}

export class WorldScene extends Phaser.Scene {
  private conn!: EngineConnection
  private world!: WorldInfo
  private map!: CityMap
  /**
   * Camera orientation. Pinned to 0 for now: turning the map also has to turn
   * every street's connection mask, and that came out inverted — crossroads
   * drew as straight road and the grid fell apart into stripes. The projection
   * below already carries `rot` correctly, so re-enabling is a matter of
   * fixing `rotateMask`'s direction, not of rebuilding this.
   */
  private readonly rot: Rot = 0


  private views = new Map<string, AgentView>()
  private bubbles = new Map<string, SpeechBubble>()
  private talk: Conversation | null = null
  private queue: Conversation[] = []

  /** Location id → info, for resolving agent positions to kinds. */
  private locById = new Map<string, LocationInfo>()
  /** Venue views for hover tooltips and occupant indicators. */
  private venueViews = new Map<string, VenueView>()
  /** The shared hover tooltip — moves to whatever is under the pointer. */
  private tooltip!: Phaser.GameObjects.Container
  private tooltipText!: Phaser.GameObjects.Text
  private tooltipBg!: Phaser.GameObjects.Graphics
  /** Occupant indicators above buildings. */
  private occupantBadges = new Map<string, Phaser.GameObjects.Container>()
  /** Currently hovered target, to avoid rebuilding tooltip every frame. */
  private hoveredId: string | null = null
  /** Sprites of the currently tinted building, so we can clear the old one. */
  private tintedSprites: Phaser.GameObjects.Image[] = []
  private tooltipAvatars: Phaser.GameObjects.Image[] = []
  private badgeOccupants = new Map<string, string>()
  private pendingAvatars = new Set<string>()

  constructor() {
    super({ key: 'WorldScene' })
  }

  init(data: { connection: EngineConnection; world: WorldInfo }): void {
    this.conn = data.connection
    this.world = data.world
  }

  preload(): void {
    for (const k of GROUND_KEYS) this.load.image(k, `${ROADS_DIR}/${k}.png`)
    for (const k of PROP_KEYS) this.load.image(k, `${ROADS_DIR}/${k}.png`)
    for (const [key, file] of Object.entries(DETAIL_SPRITES)) {
      this.load.image(key, `${DETAILS_DIR}/${file}.png`)
    }
    for (const n of BUILDING_TILES) this.load.image(buildingKey(n), buildingPath(n))
    for (const s of characterSheets()) {
      this.load.spritesheet(s.key, s.path, { frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE })
    }
  }

  create(): void {
    for (const l of this.world.locations) this.locById.set(l.id, l)
    this.map = buildCityMap(this.world)
    this.drawGround()
    this.drawStructures()
    this.createAgents()
    this.createTooltip()
    this.setupCamera()
    this.listenToEngine()
    this.fitCamera()
  }

  // ---- the map -------------------------------------------------------------

  private project(x: number, y: number): { px: number; py: number; rx: number; ry: number } {
    const r = rotateTile(x, y, this.rot, this.map.size)
    const s = toScreen(r.x, r.y)
    return { px: s.px, py: s.py, rx: r.x, ry: r.y }
  }

  /**
   * Every ground slab as an individual sprite.
   *
   * Phaser 4's RenderTexture does not render its framebuffer content, so the
   * bake-into-one-texture optimisation that worked in Phaser 3 is not viable.
   * All ground sprites share the same depth layer so they never interleave
   * with buildings — the texture-swap cost stays low.
   */
  private drawGround(): void {
    for (const cell of this.map.cells) {
      const { px, py, rx, ry } = this.project(cell.x, cell.y)
      const key =
        cell.ground === 'street'
          ? ROAD_BY_MASK[rotateMask(cell.mask, this.rot)] ?? 'road'
          : cell.ground
      this.add
        .image(px, py, key)
        .setOrigin(0.5, GROUND_ANCHOR_Y / TILE_H)
        .setDepth(depthAt(rx, ry, LAYER.ground))
    }
  }

  /**
   * Buildings, trees and street furniture. Venue buildings get an interactive
   * hit area so the tooltip can fire on hover.
   */
  private drawStructures(): void {
    for (const cell of this.map.cells) {
      const { px, py, rx, ry } = this.project(cell.x, cell.y)

      if (cell.building != null) {
        const roof = cell.building.length * STOREY
        const sprites: Phaser.GameObjects.Image[] = []
        cell.building.forEach((n, i) => {
          sprites.push(
            this.add
              .image(px, py + BASE_ANCHOR_Y - i * STOREY, buildingKey(n))
              .setOrigin(0.5, 1)
              .setDepth(depthAt(rx, ry, LAYER.building) + i * 0.01),
          )
        })

        // Every sprite in the stack is interactive. Hovering any one
        // highlights the whole building and shows one tooltip; leaving the
        // last sprite clears both. The tinted-sprites field ensures only
        // one building is highlighted at a time.
        const hoverIn = (id: string, kind: 'venue' | 'filler') => {
          if (this.hoveredId === id) return
          this.clearBuildingHover()
          this.tintedSprites = sprites
          for (const s of sprites) s.setTint(0xc8d8ff)
          this.input.setDefaultCursor('pointer')
          if (kind === 'venue') {
            this.showTooltip(id, 'venue')
          } else {
            const label = ROLE_LABEL[cell.role] ?? 'Building'
            const dot = ROLE_COLOR[cell.role] ?? 0x94a3b8
            this.hoveredId = id
            const scale = 1 / this.cameras.main.zoom
            this.rebuildTooltip(label, dot)
            this.tooltip.setPosition(px, py + BASE_ANCHOR_Y - roof - 18 * scale)
            this.tooltip.setScale(scale)
            this.tooltip.setDepth(depthAt(rx, ry, LAYER.label) + 4000)
            this.tooltip.setVisible(true)
          }
        }
        const hoverOut = (id: string) => {
          if (this.hoveredId !== id) return
          this.clearBuildingHover()
        }

        const hoverId = cell.venue?.id ?? `filler-${cell.x}-${cell.y}`
        const hoverKind = cell.venue != null ? 'venue' as const : 'filler' as const

        if (cell.venue != null) {
          this.venueViews.set(cell.venue.id, { loc: cell.venue, px, py, rx, ry, roof })
        }
        for (const spr of sprites) {
          spr.setInteractive({ cursor: 'pointer' })
          spr.on('pointerover', () => hoverIn(hoverId, hoverKind))
          spr.on('pointerout', () => hoverOut(hoverId))
          spr.on('pointerup', (p: Phaser.Input.Pointer) => {
            if (p.getDistance() > 6) return
            if (this.isOverCard(p)) return
            const cam = this.cameras.main
            cam.pan(px, py, 400, 'Sine.easeInOut')
            cam.zoomTo(Math.max(cam.zoom, 1), 400)
            if (cell.venue != null) {
              window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: cell.venue.id } }))
            } else {
              window.dispatchEvent(new CustomEvent('aw:venue-click', {
                detail: { id: null, role: cell.role },
              }))
            }
          })
        }
      }

      for (const prop of cell.props) {
        const off = toScreen(prop.ox ?? 0, prop.oy ?? 0)
        const img = this.add
          .image(px + off.px, py + off.py, prop.key)
          .setOrigin(0.5, 1)
          .setDepth(depthAt(rx + (prop.ox ?? 0), ry + (prop.oy ?? 0), LAYER.prop))
        if (prop.key in DETAIL_SPRITES) img.setScale(DETAIL_SCALE)
      }
    }
  }

  // ---- tooltip & hover -------------------------------------------------------

  private createTooltip(): void {
    this.tooltipBg = this.add.graphics()
    this.tooltipText = this.add.text(0, 0, '', {
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontSize: '11px',
      color: getComputedStyle(document.documentElement).getPropertyValue('--tooltip-fg').trim(),
      lineSpacing: 4,
    })
    this.tooltipText.setResolution(3)
    this.tooltip = this.add.container(0, 0, [this.tooltipBg, this.tooltipText])
    this.tooltip.setVisible(false)
    this.tooltip.setDepth(2_000_000)
  }

  private showTooltip(id: string, kind: 'venue' | 'agent'): void {
    this.hoveredId = id
    const scale = 1 / this.cameras.main.zoom
    if (kind === 'venue') {
      const vv = this.venueViews.get(id)
      if (vv == null) return
      const occupants = this.getOccupants(id)
      const dot = KIND_COLOR[vv.loc.kind] ?? 0x94a3b8
      let label = vv.loc.name
      const avLines: { id: string; line: number }[] = []
      if (occupants.length > 0) {
        label += '\n' + occupants.map((v, i) => {
          this.ensureAvatarTexture(v.id)
          avLines.push({ id: v.id, line: i + 1 })
          return '     ' + v.name
        }).join('\n')
      }
      this.rebuildTooltip(label, dot, avLines)
      this.tooltip.setPosition(vv.px, vv.py + BASE_ANCHOR_Y - vv.roof - 18 * scale)
      this.tooltip.setScale(scale)
      this.tooltip.setDepth(depthAt(vv.rx, vv.ry, LAYER.label) + 4000)
    } else {
      const v = this.views.get(id)
      if (v == null) return
      this.ensureAvatarTexture(v.id)
      this.rebuildTooltip(v.name, 0xffffff, [{ id: v.id, line: 0 }])
      const { px, py, rx, ry } = this.project(v.x, v.y)
      this.tooltip.setPosition(px, py - 42 * scale)
      this.tooltip.setScale(scale)
      this.tooltip.setDepth(depthAt(rx, ry, LAYER.label) + 4000)
    }
    this.tooltip.setVisible(true)
  }

  private hideTooltip(id: string): void {
    if (this.hoveredId !== id) return
    this.hoveredId = null
    this.tooltip.setVisible(false)
  }

  private clearBuildingHover(): void {
    for (const s of this.tintedSprites) s.clearTint()
    this.tintedSprites = []
    this.hoveredId = null
    this.tooltip.setVisible(false)
    this.input.setDefaultCursor('default')
  }

  private ensureAvatarTexture(agentId: string): void {
    const key = `avatar-${agentId}`
    if (this.textures.exists(key) || this.pendingAvatars.has(key)) return
    const url = avatarDataUrl(agentId)
    if (url) {
      this.pendingAvatars.add(key)
      this.textures.addBase64(key, url)
    }
  }

  private rebuildTooltip(text: string, dot: number, avatars?: { id: string; line: number }[]): void {
    for (const img of this.tooltipAvatars) this.tooltip.remove(img, true)
    this.tooltipAvatars = []

    this.tooltipText.setText(text)
    const w = this.tooltipText.width + 26
    const h = this.tooltipText.height + 10
    this.tooltipText.setPosition(-w / 2 + 18, -h / 2 + 5)
    this.tooltipBg.clear()
    this.tooltipBg.fillStyle(cssHex('--tooltip-bg'), 0.9)
    this.tooltipBg.lineStyle(1, cssHex('--tooltip-border'), 1)
    this.tooltipBg.fillRoundedRect(-w / 2, -h / 2, w, h, 10)
    this.tooltipBg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10)

    const nLines = text.split('\n').length
    const lineH = this.tooltipText.height / nLines
    const textY = -h / 2 + 5

    const hasLine0Av = avatars?.some((a) => a.line === 0)
    if (!hasLine0Av) {
      this.tooltipBg.fillStyle(dot, 1)
      this.tooltipBg.fillCircle(-w / 2 + 11, textY + lineH / 2, 3.5)
    }

    if (avatars?.length) {
      for (const av of avatars) {
        const key = `avatar-${av.id}`
        if (!this.textures.exists(key)) continue
        const y = textY + av.line * lineH + lineH / 2
        const x = av.line === 0 ? -w / 2 + 11 : -w / 2 + 24
        const sz = av.line === 0 ? 14 : 12
        const img = this.add.image(x, y, key)
        img.setDisplaySize(sz, sz)
        this.tooltip.add(img)
        this.tooltipAvatars.push(img)
      }
    }
  }

  private getOccupants(locationId: string): AgentView[] {
    const result: AgentView[] = []
    for (const v of this.views.values()) {
      if (v.at === locationId && !v.travelling) result.push(v)
    }
    return result
  }

  private updateOccupantBadges(): void {
    const scale = 1 / this.cameras.main.zoom
    for (const [locId, vv] of this.venueViews) {
      const occupants = this.getOccupants(locId)
      let badge = this.occupantBadges.get(locId)
      if (occupants.length === 0) {
        if (badge != null) badge.setVisible(false)
        this.badgeOccupants.delete(locId)
        continue
      }
      const occKey = occupants.map(v => v.id).join(',')
      const lines = occupants
        .map(v => `     ${v.name} · ${STATE_LABEL[v.state] ?? v.state}`)
        .join('\n')
      if (badge == null) {
        const t = this.add.text(0, 0, '', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '10px',
          color: getComputedStyle(document.documentElement).getPropertyValue('--tooltip-fg').trim(),
          lineSpacing: 3,
        })
        t.setResolution(3)
        const bg = this.add.graphics()
        badge = this.add.container(0, 0, [bg, t])
        this.occupantBadges.set(locId, badge)
      }
      const t = badge.list[1] as Phaser.GameObjects.Text
      const bg = badge.list[0] as Phaser.GameObjects.Graphics
      t.setText(lines)
      const pad = 10
      const w = t.width + pad * 2
      const h = t.height + pad
      const arrow = 6
      t.setPosition(-w / 2 + pad, -h / 2 + pad / 2)
      bg.clear()
      bg.fillStyle(cssHex('--badge-bg'), 0.88)
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8)
      bg.fillTriangle(-arrow, h / 2, arrow, h / 2, 0, h / 2 + arrow)

      if (this.badgeOccupants.get(locId) !== occKey) {
        this.badgeOccupants.set(locId, occKey)
        while (badge.list.length > 2) badge.remove(badge.list[badge.list.length - 1]!, true)
        let allLoaded = true
        for (const v of occupants) {
          this.ensureAvatarTexture(v.id)
          const key = `avatar-${v.id}`
          if (!this.textures.exists(key)) { allLoaded = false; continue }
          const img = this.add.image(0, 0, key)
          img.setDisplaySize(12, 12)
          badge.add(img)
        }
        if (!allLoaded) this.badgeOccupants.delete(locId)
      }

      const nLines = occupants.length
      const lineH = t.height / nLines
      const textY = -h / 2 + pad / 2
      let imgIdx = 2
      for (let i = 0; i < nLines && imgIdx < badge.list.length; i++) {
        const img = badge.list[imgIdx] as Phaser.GameObjects.Image
        if (img == null) break
        img.setPosition(-w / 2 + pad + 8, textY + i * lineH + lineH / 2)
        imgIdx++
      }

      badge.setPosition(vv.px, vv.py + BASE_ANCHOR_Y - vv.roof - (arrow + 4) * scale)
      badge.setScale(scale)
      badge.setDepth(depthAt(vv.rx, vv.ry, LAYER.label) + 3000)
      badge.setVisible(true)
    }
  }

  // ---- people --------------------------------------------------------------

  private createAgents(): void {
    for (const a of this.world.agents) {
      const home = this.world.locations.find((l) => l.id === `home-${a.id}`)
      const start = { x: home?.x ?? this.map.size / 2, y: home?.y ?? this.map.size / 2 }
      const char = new Character(this, a.id)
      const badge = this.makeBadge(a.name)
      badge.setVisible(false)
      this.views.set(a.id, {
        id: a.id, name: a.name, char, badge,
        x: start.x, y: start.y,
        from: start, to: start,
        targetP: 1, p: 1, travelling: false,
        spread: { x: 0, y: 0 },
        dir: 1, state: 'idle', partner: null,
        at: home?.id ?? '',
      })

      char.container.setInteractive(
        new Phaser.Geom.Rectangle(-14, -34, 28, 38),
        Phaser.Geom.Rectangle.Contains,
      )
      char.container.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() > 6) return
        if (this.isOverCard(p)) return
        window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: a.id } }))
      })
      char.container.on('pointerover', () => this.showTooltip(a.id, 'agent'))
      char.container.on('pointerout', () => this.hideTooltip(a.id))
      this.bubbles.set(a.id, new SpeechBubble(this))
    }
  }

  private makeBadge(name: string): Phaser.GameObjects.Container {
    const t = this.add.text(0, 0, name, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: getComputedStyle(document.documentElement).getPropertyValue('--badge-fg').trim(),
    })
    t.setResolution(3)
    const w = t.width + 12
    t.setPosition(-t.width / 2, -t.height / 2)
    const g = this.add.graphics()
    g.fillStyle(cssHex('--badge-bg'), 0.55)
    g.fillRoundedRect(-w / 2, -9, w, 18, 9)
    return this.add.container(0, 0, [g, t])
  }

  applyTheme(): void {
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--tooltip-fg').trim()
    const badgeFg = getComputedStyle(document.documentElement).getPropertyValue('--badge-fg').trim()
    this.tooltipText.setColor(fg)
    for (const badge of this.occupantBadges.values()) {
      const t = badge.list[1] as Phaser.GameObjects.Text
      t.setColor(fg)
    }
    for (const v of this.views.values()) {
      const t = v.badge.list[1] as Phaser.GameObjects.Text
      t.setColor(badgeFg)
      const g = v.badge.list[0] as Phaser.GameObjects.Graphics
      g.clear()
      const w = t.width + 12
      g.fillStyle(cssHex('--badge-bg'), 0.55)
      g.fillRoundedRect(-w / 2, -9, w, 18, 9)
    }
  }

  private isOverCard(p: Phaser.Input.Pointer): boolean {
    const ev = p.event
    const cx = 'clientX' in ev ? ev.clientX : (ev as TouchEvent).touches?.[0]?.clientX ?? 0
    const cy = 'clientY' in ev ? ev.clientY : (ev as TouchEvent).touches?.[0]?.clientY ?? 0
    const el = document.elementFromPoint(cx, cy)
    return el != null && (el.closest('#agent-card') != null || el.closest('#venue-card') != null || el.closest('#controls') != null)
  }

  private isIndoors(v: AgentView): boolean {
    if (v.travelling) return false
    const loc = this.locById.get(v.at)
    return loc != null && INDOOR_KINDS.has(loc.kind)
  }

  // ---- camera --------------------------------------------------------------

  private setupCamera(): void {
    const cam = this.cameras.main

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.0012 * cam.zoom, 0.18, 2.4))
    })

    let dragging = false
    let lastX = 0
    let lastY = 0
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.isOverCard(p)) return
      dragging = true
      lastX = p.x
      lastY = p.y
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return
      cam.scrollX -= (p.x - lastX) / cam.zoom
      cam.scrollY -= (p.y - lastY) / cam.zoom
      lastX = p.x
      lastY = p.y
    })
    this.input.on('pointerup', () => { dragging = false })

    window.addEventListener('aw:zoom', (e) => {
      const d = (e as CustomEvent<{ dir: number }>).detail.dir
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (d > 0 ? 1.25 : 0.8), 0.18, 2.4))
    })
    window.addEventListener('aw:fit', () => this.fitCamera())
    window.addEventListener('aw:follow', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id
      const v = this.views.get(id)
      if (v == null) return
      const { px, py } = this.project(v.x, v.y)
      cam.pan(px, py, 400, 'Sine.easeInOut')
      cam.zoomTo(Math.max(cam.zoom, 1), 400)
    })
  }

  private fitCamera(): void {
    const cam = this.cameras.main
    const n = this.map.size
    const centre = toScreen((n - 1) / 2, (n - 1) / 2)
    cam.centerOn(centre.px, centre.py)
    const spanW = n * TILE_W
    const spanH = n * TILE_H + 260
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / spanW, cam.height / spanH) * 0.95, 0.18, 2.4))
  }

  // ---- engine --------------------------------------------------------------

  private listenToEngine(): void {
    this.conn.onState((s: StateMsg) => {
      this.updateAgents(s.agents)
    })
    this.conn.onFeed((item: FeedItem) => {
      if (item.kind !== 'scene') return
      const d = item.detail
      if (d?.a == null || d.b == null || d.dialogue == null) return
      this.queue.push(new Conversation(d.a, d.b, d.dialogue, d.outcome ?? null))
      if (this.queue.length > 3) this.queue.shift()
    })
  }

  private updateAgents(agents: AgentSnapshot[]): void {
    // Agents on the same tile would draw exactly on top of each other, so a
    // room with four people in it looks like a room with one.
    const crowd = new Map<string, string[]>()
    for (const a of agents) {
      const key = `${Math.round(a.x)},${Math.round(a.y)}`
      const list = crowd.get(key) ?? []
      list.push(a.id)
      crowd.set(key, list)
    }

    for (const a of agents) {
      const v = this.views.get(a.id)
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

      v.spread = this.spreadOffset(a, crowd.get(`${Math.round(a.x)},${Math.round(a.y)}`) ?? [a.id])
    }
  }

  /**
   * Where an agent is along its journey, routed down the streets.
   *
   * The engine walks in a straight line because distance is all it needs to
   * bill time for; on screen that cuts through buildings. Same departure, same
   * arrival, believable middle: out to the nearest road, along it, then in.
   */
  private routePoint(v: AgentView, p: number): Point {
    const period = this.world.city.streetPeriod
    const toStreet = (n: number): number => Math.round(n / period) * period
    const { from, to } = v
    const roadY = toStreet(from.y)
    const roadX = toStreet(to.x)

    const legs: [Point, Point][] = [
      [from, { x: from.x, y: roadY }],
      [{ x: from.x, y: roadY }, { x: roadX, y: roadY }],
      [{ x: roadX, y: roadY }, { x: roadX, y: to.y }],
      [{ x: roadX, y: to.y }, to],
    ]
    // Split the journey by the ground each leg covers, not evenly: an even
    // split sprints down the long stretch and dawdles on the short hop out.
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

  /** Fans co-located agents around their tile so a crowd looks like a crowd. */
  private spreadOffset(a: AgentSnapshot, here: string[]): Point {
    if (here.length < 2) return { x: 0, y: 0 }
    // Two people mid-conversation stand facing each other, not in a ring.
    if (a.partner != null && here.includes(a.partner)) {
      const first = a.id < a.partner
      return { x: first ? -0.3 : 0.3, y: first ? 0.3 : -0.3 }
    }
    const i = here.indexOf(a.id)
    const angle = (i / here.length) * Math.PI * 2 + ((hash(a.id) % 100) / 100)
    const r = 0.34
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  }

  // ---- frame ---------------------------------------------------------------

  update(_time: number, delta: number): void {
    const cam = this.cameras.main
    const TICK_MS = 2000
    const posEase = 1 - Math.exp(-delta / 400)

    for (const v of this.views.values()) {
      if (v.travelling) {
        const step = (delta / TICK_MS) * (v.targetP - v.p + 0.01)
        v.p = Math.min(v.p + Math.abs(step), v.targetP)
      }

      const indoor = this.isIndoors(v)
      v.char.container.setVisible(!indoor)
      v.badge.setVisible(false)

      const goal = v.travelling ? this.routePoint(v, v.p) : { x: v.to.x, y: v.to.y }
      goal.x += v.spread.x
      goal.y += v.spread.y

      const dx = goal.x - v.x
      const dy = goal.y - v.y
      const moved = Math.hypot(dx, dy)
      v.x += dx * posEase
      v.y += dy * posEase
      if (moved > 0.004) v.dir = dirFor(dx, dy, v.dir)

      const { px, py, rx, ry } = this.project(v.x, v.y)
      v.char.container.setPosition(px, py)
      v.char.container.setDepth(depthAt(rx, ry, LAYER.agent))

      const walking = v.travelling && moved > 0.01
      const anim: AnimName = walking ? 'walk' : animForState(v.state)
      v.char.update(delta, anim, v.dir)
    }

    this.updateOccupantBadges()
    this.stepConversation(delta)
  }

  /**
   * Whether two agents are still close enough to be having a conversation.
   *
   * A transcript arrives 15-40s after the encounter that produced it and takes
   * another twenty to play, by which time the pair have often walked off in
   * different directions. Speech coming out of someone standing alone three
   * streets away is worse than no speech at all.
   */
  private stillTogether(a: string, b: string): boolean {
    const va = this.views.get(a)
    const vb = this.views.get(b)
    if (va == null || vb == null) return false
    return Math.hypot(va.x - vb.x, va.y - vb.y) < 1.6
  }

  private stepConversation(delta: number): void {
    if (this.talk != null && !this.stillTogether(this.talk.a, this.talk.b)) {
      for (const bub of this.bubbles.values()) bub.hide()
      this.talk = null
    }
    if (this.talk == null || this.talk.done) {
      for (const b of this.bubbles.values()) b.hide()
      this.talk = null
      while (this.queue.length > 0) {
        const next = this.queue.shift()!
        if (this.stillTogether(next.a, next.b)) { this.talk = next; break }
      }
      if (this.talk == null) return
    }

    const beat = this.talk.step(delta)
    if (beat == null) {
      if (this.talk.done) for (const b of this.bubbles.values()) b.hide()
      return
    }

    // Attribute by name, because that is what the transcript carries. An
    // unmatched name means the outcome line, which belongs to neither of them.
    const speakerId =
      [...this.views.values()].find((v) => v.name === beat.speaker)?.id ?? this.talk.a

    for (const [id, bubble] of this.bubbles) {
      if (id !== speakerId) { bubble.hide(); continue }
      const v = this.views.get(id)
      if (v == null) continue
      bubble.show(beat.speaker === '' ? '' : v.name, beat.line)
      const scale = 1 / this.cameras.main.zoom
      const { px, py, rx, ry } = this.project(v.x, v.y)
      bubble.container.setScale(scale)
      bubble.moveTo(px, py - 50 * scale, depthAt(rx, ry, LAYER.bubble) + 50_000)
    }
  }
}
