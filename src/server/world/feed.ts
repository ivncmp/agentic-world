/**
 * The live feed and the state snapshot: everything the spectator view receives.
 *
 * Both are one-way. The viewer has no authority, so nothing here reads from a
 * client — `broadcast` pushes, and that is the whole contract.
 */
import type { WebSocket } from 'ws'
import { TICKS_PER_DAY, hourOfDay, worldTime } from '../../engine/clock.js'
import { occupationDef } from '../../world/occupations.js'
import type { WorldEvent } from '../../engine/tick.js'
import type { World } from './context.js'

/** One line in the village log. */
export type FeedItem = {
  tick: number
  time: string
  kind: string
  text: string
  detail?: unknown
}

/** Cognition counters shown in the viewer's status bar. */
export type CognitionStats = {
  pending: number
  done: number
  dropped: number
  spentUsd: number
  inputTokens: number
  outputTokens: number
  breakdown: Record<string, { queued: number; running: number }>
}

/** How much backlog a client joining mid-run receives. */
const BACKLOG = 60
const MAX_FEED = 300

export class LiveFeed {
  private readonly items: FeedItem[] = []
  private readonly clients = new Set<WebSocket>()

  constructor(
    private readonly world: World,
    private readonly stats: () => CognitionStats,
  ) {}

  /** Append a feed line and push it to every connected client. */
  publish(kind: string, text: string, detail?: unknown): void {
    const item: FeedItem = {
      tick: this.world.state.tick,
      time: worldTime(this.world.state.tick).toISOString(),
      kind,
      text,
      ...(detail == null ? {} : { detail }),
    }
    this.items.push(item)
    if (this.items.length > MAX_FEED) this.items.shift()
    this.broadcast({ type: 'feed', item })
  }

  broadcast(msg: unknown): void {
    const text = JSON.stringify(msg)
    for (const c of this.clients) if (c.readyState === 1) c.send(text)
  }

  recent(): FeedItem[] {
    return this.items.slice(-BACKLOG)
  }

  /** Attach a client and send it the world as it stands, so it is never blank. */
  attach(ws: WebSocket): void {
    this.clients.add(ws)
    ws.send(JSON.stringify({ type: 'hello', feed: this.recent() }))
    ws.send(JSON.stringify(this.snapshot()))
    ws.on('close', () => this.clients.delete(ws))
  }

  /** The whole world as the viewer needs it, rebuilt each tick. */
  snapshot(): unknown {
    const { state, byId } = this.world
    return {
      type: 'state',
      tick: state.tick,
      time: worldTime(state.tick).toISOString(),
      day: Math.floor(state.tick / TICKS_PER_DAY) + 1,
      hour: hourOfDay(state.tick),
      minute: Math.floor((((state.tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24 - hourOfDay(state.tick)) * 60),
      agents: state.agents.map((a) => {
        const here = byId.get(a.location)?.tile ?? { x: 0, y: 0 }
        const act = a.activity
        let x = here.x, y = here.y
        let from = here
        let to = here
        let progress = 1
        if (act?.kind === 'travel' && act.from != null) {
          const dest = byId.get(act.at)?.tile
          if (dest != null) {
            progress = Math.min(1, Math.max(0,
              (state.tick - act.startedTick) / Math.max(1, act.endsTick - act.startedTick)))
            from = here
            to = dest
            x = Math.round((here.x + (dest.x - here.x) * progress) * 100) / 100
            y = Math.round((here.y + (dest.y - here.y) * progress) * 100) / 100
          }
        }
        return {
          id: a.id, name: a.name, occupation: occupationDef(a.occupation).label,
          // x/y is the straight-line position the simulation reasons about. The
          // viewer walks its own street route between `from` and `to` over the
          // same `progress`, so the picture follows roads without the engine
          // having to model a road network it does not need.
          x, y, from, to, progress,
          state: act?.kind ?? 'idle',
          at: act?.kind === 'travel' ? act.at : a.location,
          partner: act?.with ?? null,
          money: Math.round(a.money),
          arrears: a.housing.arrears,
        }
      }),
      cognition: this.stats(),
    }
  }

  /** Turn the tick's events into feed lines. Silent events are simply skipped. */
  describe(e: WorldEvent): void {
    const { nameOf, placeOf } = this.world
    switch (e.type) {
      case 'theft':
        this.publish('theft', `${nameOf(e.thief)} stole ${e.amount}c from ${nameOf(e.victim)}`); break
      case 'rent_missed':
        this.publish('rent', `${nameOf(e.agent)} missed rent — ${e.arrears} behind`); break
      case 'hired':
        this.publish('hired', `${nameOf(e.agent)} found work`); break
      case 'bought_home':
        this.publish('home', `${nameOf(e.agent)} bought their flat`); break
      case 'passing':
        this.publish('passing', `${nameOf(e.a)} and ${nameOf(e.b)} crossed paths at ${placeOf(e.where)}`); break
      default: break
    }
  }
}
