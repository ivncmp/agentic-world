/**
 * The city, drawn.
 *
 * Three things change on three different clocks: the map never changes, agents
 * move every tick and are interpolated every frame, and conversations play back
 * at reading pace. The map being static is what pays for the whole thing — the
 * ground is flattened into one texture at boot instead of being 441 sprites the
 * renderer has to sort and swap textures for on every frame.
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
import type { EngineConnection, WorldInfo, AgentSnapshot, StateMsg, FeedItem } from './connection.js'

type Point = { x: number; y: number }

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

  private labels: Phaser.GameObjects.Container[] = []
  private nightVeil!: Phaser.GameObjects.Rectangle
  private lastTextScale = -1
  private veilW = -1
  private veilH = -1

  private views = new Map<string, AgentView>()
  private bubbles = new Map<string, SpeechBubble>()
  private talk: Conversation | null = null
  private queue: Conversation[] = []

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
    this.map = buildCityMap(this.world)
    this.drawGround()
    this.drawStructures()
    this.drawLabels()
    this.createAgents()
    this.setupCamera()
    this.setupNight()
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
   * Every ground slab, baked into one texture.
   *
   * As individual sprites the ground was 441 of the 759 things on screen and,
   * interleaved by depth with buildings and trees, it forced a texture swap on
   * almost every draw — 642 of them a frame. Nothing ever walks *behind* the
   * ground, so it loses nothing by being flat.
   */
  private drawGround(): void {
    const n = this.map.size
    const pad = TILE_W
    const left = -(n - 1) * (TILE_W / 2) - TILE_W / 2 - pad
    const top = -GROUND_ANCHOR_Y - pad
    const width = (n - 1) * TILE_W + TILE_W + pad * 2
    const height = (n - 1) * TILE_H + TILE_H + GROUND_ANCHOR_Y + pad * 2

    const rt = this.add
      .renderTexture(left, top, width, height)
      .setOrigin(0, 0)
      .setDepth(-1_000_000)

    // Stamped with the same origin the slabs used as sprites — top-centre, so
    // the diamond's top face lands on the tile's own point.
    const origin = { originX: 0.5, originY: 0 }
    for (const cell of this.map.cells) {
      const { px, py } = this.project(cell.x, cell.y)
      const key =
        cell.ground === 'street'
          ? ROAD_BY_MASK[rotateMask(cell.mask, this.rot)] ?? 'road'
          : cell.ground
      rt.stamp(key, undefined, px - left, py - GROUND_ANCHOR_Y - top, origin)
    }
  }

  /**
   * Buildings, trees and street furniture stay as sprites, because an agent has
   * to be able to walk behind them. They go straight onto the scene's display
   * list: inside a Container they would be depth-sorted only against each
   * other, and every agent would float over the whole city.
   */
  private drawStructures(): void {
    for (const cell of this.map.cells) {
      const { px, py, rx, ry } = this.project(cell.x, cell.y)

      if (cell.building != null) {
        cell.building.forEach((n, i) => {
          this.add
            .image(px, py + BASE_ANCHOR_Y - i * STOREY, buildingKey(n))
            .setOrigin(0.5, 1)
            .setDepth(depthAt(rx, ry, LAYER.building) + i * 0.01)
        })
      }

      // Props touch the ground at the bottom of their own sprite, so they sit
      // at the tile's centre. Offsetting them by BASE_ANCHOR_Y like a building
      // planted every tree half a tile toward the viewer.
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

  /**
   * Labels sit above the roof, not on the building. Painted text over a facade
   * is unreadable at any font size — the plate is what makes it legible.
   */
  private drawLabels(): void {
    for (const cell of this.map.venues) {
      const v = cell.venue
      if (v == null || v.kind === 'home') continue
      const { px, py, rx, ry } = this.project(cell.x, cell.y)
      const roof = (cell.building?.length ?? 1) * STOREY
      const label = this.makeLabel(v.name, KIND_COLOR[v.kind] ?? 0x94a3b8)
      label.setPosition(px, py + BASE_ANCHOR_Y - roof - 14)
      label.setDepth(depthAt(rx, ry, LAYER.label) + 4000)
      this.labels.push(label)
    }
  }

  private makeLabel(text: string, dot: number): Phaser.GameObjects.Container {
    const t = this.add.text(0, 0, text, {
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      color: '#e8edf5',
    })
    t.setResolution(3) // canvas text is rasterised once; 1x goes to mush on zoom
    const w = t.width + 26
    const h = 20
    t.setPosition(-w / 2 + 18, -t.height / 2)

    const g = this.add.graphics()
    g.fillStyle(0x0b1220, 0.86)
    g.lineStyle(1, 0x2b3a52, 1)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10)
    g.fillStyle(dot, 1)
    g.fillCircle(-w / 2 + 11, 0, 3.5)

    return this.add.container(0, 0, [g, t])
  }

  // ---- people --------------------------------------------------------------

  private createAgents(): void {
    for (const a of this.world.agents) {
      const home = this.world.locations.find((l) => l.id === `home-${a.id}`)
      const start = { x: home?.x ?? this.map.size / 2, y: home?.y ?? this.map.size / 2 }
      const char = new Character(this, a.id)
      const badge = this.makeBadge(a.name)
      this.views.set(a.id, {
        id: a.id, name: a.name, char, badge,
        x: start.x, y: start.y,
        from: start, to: start,
        targetP: 1, p: 1, travelling: false,
        spread: { x: 0, y: 0 },
        dir: 1, state: 'idle', partner: null,
      })

      char.container.setInteractive(
        new Phaser.Geom.Rectangle(-14, -34, 28, 38),
        Phaser.Geom.Rectangle.Contains,
      )
      char.container.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() > 6) return // this click was a camera drag
        window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: a.id } }))
      })
      this.bubbles.set(a.id, new SpeechBubble(this))
    }
  }

  private makeBadge(name: string): Phaser.GameObjects.Container {
    const t = this.add.text(0, 0, name, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: '#ffffff',
    })
    t.setResolution(3)
    const w = t.width + 12
    t.setPosition(-t.width / 2, -t.height / 2)
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.55)
    g.fillRoundedRect(-w / 2, -9, w, 18, 9)
    return this.add.container(0, 0, [g, t])
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

  // ---- time of day ---------------------------------------------------------

  private setupNight(): void {
    // Sized from the camera's world view rather than pinned with
    // scrollFactor(0): a pinned object still scales with zoom, so it shrank to
    // a dark rectangle in the middle of the map.
    this.nightVeil = this.add
      .rectangle(0, 0, 10, 10, 0xffffff, 1)
      .setOrigin(0, 0)
      .setDepth(1_000_000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
  }

  /**
   * `setSize` rebuilds the rectangle's geometry, so only do it when the view
   * actually changed — panning moves the veil, but a still camera should not
   * be paying to rebuild a full-screen quad sixty times a second.
   */
  private coverViewWithVeil(): void {
    const v = this.cameras.main.worldView
    this.nightVeil.setPosition(v.x - 4, v.y - 4)
    if (v.width !== this.veilW || v.height !== this.veilH) {
      this.veilW = v.width
      this.veilH = v.height
      this.nightVeil.setSize(v.width + 8, v.height + 8)
    }
  }

  /**
   * A single tinted sheet over the whole view. Cheap, and it reads instantly —
   * a glance at the map should tell you what time it is.
   */
  private applyDaylight(hour: number): void {
    // Night is a cool cast, not a blackout. Multiplying down to a third of
    // brightness made the map unreadable for a third of every day, and this
    // view exists to be read — the clock in the sidebar already says the hour.
    const night = { r: 0xa6, g: 0xb2, b: 0xe2 }
    const dusk = { r: 0xe8, g: 0xc4, b: 0xac }
    const day = { r: 0xff, g: 0xff, b: 0xff }
    let c = day
    if (hour >= 22 || hour < 5) c = night
    else if (hour < 7) c = mix(night, dusk, (hour - 5) / 2)
    else if (hour < 9) c = mix(dusk, day, (hour - 7) / 2)
    else if (hour >= 20) c = mix(dusk, night, (hour - 20) / 2)
    else if (hour >= 18) c = mix(day, dusk, (hour - 18) / 2)
    this.nightVeil.fillColor = (c.r << 16) | (c.g << 8) | c.b
  }

  // ---- engine --------------------------------------------------------------

  private listenToEngine(): void {
    this.conn.onState((s: StateMsg) => {
      this.applyDaylight(s.hour)
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
      v.travelling = a.state === 'travel' && a.progress < 1
      v.from = a.from
      v.to = a.to
      v.targetP = a.progress
      // A fresh journey restarts the eased value, or the agent would appear to
      // be most of the way along a walk it has not started.
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
    // Ease the *progress*, not the position, so an agent is always exactly on
    // the route. Chasing a moving route point at a fixed speed let them fall
    // behind and cut the corner straight across the blocks.
    const ease = 1 - Math.exp(-delta / 170)
    const textScale = 1 / cam.zoom
    const showBadge = cam.zoom > 0.42

    for (const v of this.views.values()) {
      if (v.travelling) v.p += (v.targetP - v.p) * ease

      const goal = v.travelling ? this.routePoint(v, v.p) : { x: v.to.x, y: v.to.y }
      goal.x += v.spread.x
      goal.y += v.spread.y

      const dx = goal.x - v.x
      const dy = goal.y - v.y
      const moved = Math.hypot(dx, dy)
      v.x += dx * ease
      v.y += dy * ease
      if (moved > 0.004) v.dir = dirFor(dx, dy, v.dir)

      const { px, py, rx, ry } = this.project(v.x, v.y)
      v.char.container.setPosition(px, py)
      v.char.container.setDepth(depthAt(rx, ry, LAYER.agent))

      // Someone who has arrived should stop marching on the spot, so a walk
      // only plays while there is ground left to cover.
      const walking = v.travelling && moved > 0.01
      const anim: AnimName = walking ? 'walk' : animForState(v.state)
      v.char.update(delta, anim, v.dir)

      v.badge.setVisible(showBadge)
      if (showBadge) {
        v.badge.setPosition(px, py - 40 * textScale - 4)
        v.badge.setScale(textScale)
        v.badge.setDepth(depthAt(rx, ry, LAYER.label) + 2000)
      }
    }

    this.rescaleText()
    this.coverViewWithVeil()
    this.stepConversation(delta)
  }

  /** Text is world-space so it sorts against buildings, but has to read at a
   *  constant size — and re-scaling twenty containers every frame for a zoom
   *  that rarely changes is pure waste. */
  private rescaleText(): void {
    const scale = 1 / this.cameras.main.zoom
    if (scale === this.lastTextScale) return
    this.lastTextScale = scale
    const visible = this.cameras.main.zoom > 0.34
    for (const l of this.labels) l.setScale(scale).setVisible(visible)
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

const mix = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
})
