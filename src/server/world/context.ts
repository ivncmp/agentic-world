/**
 * The world context: every piece of long-lived state the server modules share,
 * assembled once at boot.
 *
 * `state` is deliberately a mutable property rather than a module-level binding.
 * The tick loop and the cognition handlers both replace it wholesale with the
 * result of a pure reducer, and passing a holder is what lets those live in
 * separate files without one of them writing to a stale copy.
 */
import type { Pool } from 'pg'
import type { WorldState } from '../../engine/tick.js'
import { generateCity, cityFromTemplate, type GeneratedCity } from '../../world/generator.js'
import { DEFAULT_CITY, loadTemplate } from '../../world/config.js'
import { worldTime } from '../../engine/clock.js'
import { DbrainStore } from '../../memory/dbrain-store.js'
import { InMemoryStore } from '../../memory/in-memory-store.js'
import type { MemoryStore } from '../../memory/store.js'
import { makePool, migrate } from '../../persistence/db.js'
import { WorldRepository } from '../../persistence/world-repo.js'
import { HistoryRepository } from '../../persistence/history-repo.js'
import { OwnerRepository } from '../../persistence/owner-repo.js'
import type { ModelProvider } from '../../cognition/provider.js'
import type { Location } from '../../world/locations.js'

/**
 * Everything long-lived the server modules share.
 *
 * `state` is a mutable property rather than a module-level binding: the tick
 * loop and every cognition handler replace it wholesale with the result of a
 * pure reducer, and passing a holder is what lets those live in separate files
 * without one of them writing to a stale copy.
 */
export type World = {
  /**
   * Replaced wholesale each tick and by each applied cognition result.
   */
  state: WorldState
  readonly city: GeneratedCity
  /**
   * The authoritative location list — the same objects `state.locations` holds.
   */
  locations: readonly Location[]
  readonly byId: Map<string, Location>
  readonly store: MemoryStore
  readonly provider: ModelProvider
  readonly worldRepo: WorldRepository | null
  readonly history: HistoryRepository | null
  readonly owners: OwnerRepository | null
  readonly pool: Pool | null
  readonly seed: number
  /**
   * Reference instant for guidance decay. Fixed, so decay is reproducible.
   */
  readonly now: number
  /**
   * Display name for an agent id, falling back to the id itself.
   */
  nameOf(id: string): string
  /**
   * Display name for a location id, falling back to the id itself.
   */
  placeOf(id: string): string
  /**
   * Persist the current state, if persistence is enabled.
   */
  save(): Promise<void>
  /**
   * Register a location created after boot (a new agent's home).
   */
  addLocation(loc: Location): void
}

/**
 * Everything boot needs from the environment, resolved by the entry point.
 */
export type BootOptions = {
  seed: number
  persist: boolean
  provider: ModelProvider
  /**
   * Reference instant for guidance decay.
   */
  now: number
  /**
   * Name of a baked city template, or null to generate one from the seed.
   */
  cityTemplate: string | null
  /**
   * Start from tick 0 even if a saved world exists.
   */
  fresh: boolean
}

/**
 * Builds the world: opens the stores, applies migrations, lays out the city and
 * resumes a saved run if there is one.
 */
export async function bootWorld(opts: BootOptions): Promise<World> {
  const pool = opts.persist ? makePool() : null
  const worldRepo = pool == null ? null : new WorldRepository(pool)
  const history = pool == null ? null : new HistoryRepository(pool)
  const owners = pool == null ? null : new OwnerRepository(pool)
  const store: MemoryStore = opts.persist
    ? new DbrainStore({
        url: process.env.DBRAIN_URL ?? 'http://dbrain:7878',
        token: process.env.DBRAIN_TOKEN ?? '',
      })
    : new InMemoryStore()

  const template = opts.cityTemplate ? loadTemplate(opts.cityTemplate) : null
  const city = template ? cityFromTemplate(template) : generateCity(DEFAULT_CITY, opts.seed)

  const world: World = {
    state: {
      tick: 0,
      agents: [],
      locations: [...city.locations],
      relationships: new Map(),
      scenesTodayByAgent: new Map(),
      scenesTodayByPair: new Map(),
      passingTodayByPair: new Map(),
      notableToday: new Set(),
      openings: city.openings,
    },
    city,
    locations: [...city.locations],
    byId: new Map(city.locations.map((l) => [l.id, l])),
    store,
    provider: opts.provider,
    worldRepo,
    history,
    owners,
    pool,
    seed: opts.seed,
    now: opts.now,
    nameOf: (id) => world.state.agents.find((a) => a.id === id)?.name ?? id,
    placeOf: (id) => world.byId.get(id)?.name ?? id,
    save: async () => {
      await worldRepo?.save(world.state, opts.seed, city.config)
    },
    addLocation: (loc) => {
      world.byId.set(loc.id, loc)
      world.locations = [...world.state.locations, loc]
      world.state = { ...world.state, locations: world.locations }
    },
  }

  if (pool != null) {
    const applied = await migrate(pool)
    if (applied.length > 0) console.log(`migrations: ${applied.join(', ')}`)
  }

  if (worldRepo != null && !opts.fresh) {
    const saved = await worldRepo.load()
    if (saved != null) {
      world.state = saved.state
      console.log(`resumed at tick ${world.state.tick} — ${worldTime(world.state.tick).toISOString()}`)
      relayCity(world)
    }
  }

  if (store instanceof DbrainStore) {
    for (const a of world.state.agents) await store.ensureAgent(a.id, a.name)
  }

  return world
}

/**
 * A saved world carries the tiles it was laid out on. When the city plan changes
 * underneath it, move each place onto its planned plot rather than starting
 * over: relationships, memories and diaries are what make a world worth keeping,
 * and none of them live in a coordinate.
 */
function relayCity(world: World): void {
  const planned = new Map(world.city.locations.map((l) => [l.id, l]))
  let moved = 0
  for (const loc of world.state.locations) {
    const to = planned.get(loc.id)
    if (to == null) continue
    if (loc.tile.x !== to.tile.x || loc.tile.y !== to.tile.y) moved++
    loc.tile = to.tile
    loc.district = to.district
  }
  if (moved > 0) console.log(`re-laid the city: ${moved} place(s) moved onto the new street plan`)

  // Tell the home allocator which tiles are taken so the next create_agent call
  // gets a fresh plot instead of a collision.
  world.city.markOccupied(
    new Set(world.state.locations.filter((l) => l.kind === 'home').map((l) => `${l.tile.x},${l.tile.y}`)),
  )

  // Repair homes that ended up sharing a tile — an earlier bug handed out the
  // same plot twice when the server restarted between two creations.
  const seen = new Set<string>()
  for (const loc of world.state.locations) {
    if (loc.kind !== 'home') continue
    const key = `${loc.tile.x},${loc.tile.y}`
    if (seen.has(key)) {
      const fresh = world.city.allocateHome()
      console.log(
        `collision: ${loc.id} was at (${loc.tile.x},${loc.tile.y}), moved to (${fresh.tile.x},${fresh.tile.y})`,
      )
      loc.tile = fresh.tile
      loc.district = fresh.district
    }
    seen.add(`${loc.tile.x},${loc.tile.y}`)
  }

  // The resumed locations are authoritative — the tick loop reads them. Point
  // every lookup at the same objects so the engine and the viewer can never
  // disagree about where a building is.
  world.locations = world.state.locations
  world.byId.clear()
  for (const l of world.locations) world.byId.set(l.id, l)
}
