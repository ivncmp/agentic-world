import type { WorldState } from '../engine/tick.js'
import { TICKS_PER_DAY, hourOfDay } from '../engine/clock.js'
import type { GeneratedCity } from '../world/generator.js'
import type { Location } from '../world/locations.js'
import { occupationDef } from '../world/occupations.js'
import type { AgentFrame, Frame, Recording, RecordedEvent } from './format.js'

/**
 * Captures a run into the replay format. Positions are resolved here — the
 * recorder knows about walking and interpolation so that no viewer has to.
 */
export class Recorder {
  private readonly frames: Frame[] = []
  private readonly locations: Map<string, Location>

  constructor(
    private readonly city: GeneratedCity,
    allLocations: readonly Location[],
    private readonly initial: WorldState,
  ) {
    this.locations = new Map(allLocations.map((l) => [l.id, l]))
  }

  private drawPosition(a: WorldState['agents'][number], tick: number): { x: number; y: number } {
    const here = this.locations.get(a.location)?.tile ?? { x: 0, y: 0 }
    const act = a.activity
    if (act?.kind !== 'travel' || act.from == null) return here
    const to = this.locations.get(act.at)?.tile
    if (to == null) return here
    const span = Math.max(1, act.endsTick - act.startedTick)
    const p = Math.min(1, Math.max(0, (tick - act.startedTick) / span))
    return {
      x: Math.round((here.x + (to.x - here.x) * p) * 100) / 100,
      y: Math.round((here.y + (to.y - here.y) * p) * 100) / 100,
    }
  }

  capture(state: WorldState, events: RecordedEvent[]): void {
    const tick = state.tick
    const hour = hourOfDay(tick)
    const agents: AgentFrame[] = state.agents.map((a) => {
      const pos = this.drawPosition(a, tick)
      return {
        id: a.id,
        x: pos.x,
        y: pos.y,
        state: a.activity?.kind ?? 'idle',
        at: a.activity?.kind === 'travel' ? a.activity.at : a.location,
        money: Math.round(a.money),
        arrears: a.housing.arrears,
      }
    })
    this.frames.push({
      tick,
      day: Math.floor(tick / TICKS_PER_DAY) + 1,
      hour,
      minute: Math.floor((((tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24 - hour) * 60),
      agents,
      events,
    })
  }

  finish(stats: { scenesResolved: number; spendUsd: number }): Recording {
    return {
      version: 1,
      city: {
        name: this.city.config.name,
        width: this.city.layout.grid.width,
        height: this.city.layout.grid.height,
      },
      locations: [...this.locations.values()].map((l) => ({
        id: l.id,
        kind: l.kind,
        name: l.name,
        x: l.tile.x,
        y: l.tile.y,
        ...(l.residentId == null ? {} : { residentId: l.residentId }),
      })),
      agents: this.initial.agents.map((a) => ({
        id: a.id,
        name: a.name,
        occupation: occupationDef(a.occupation).label,
        vices: a.vices.map((v) => v.kind),
      })),
      frames: this.frames,
      stats,
    }
  }
}
