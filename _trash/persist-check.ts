/**
 * Round-trip proof: run a while, save, reload, and confirm the reloaded world
 * is byte-identical *and* keeps ticking the same way. A persisted simulation
 * that drifts on restart is worse than one that forgets, because the drift is
 * invisible until the story stops making sense.
 */
import { makePool, migrate } from '../persistence/db.js'
import { WorldRepository } from '../persistence/world-repo.js'
import { tick, type WorldState } from '../engine/tick.js'
import { generateCity } from '../world/generator.js'
import { DEFAULT_CITY } from '../world/config.js'
import { createAgent } from '../agents/create.js'
import { makeRng, pick } from '../world/rng.js'
import { ROSTER } from './roster.js'
import type { Agent } from '../agents/agent.js'
import type { Location } from '../world/locations.js'

const SEED = Number(process.env.SEED ?? 42)
const pool = makePool()
const applied = await migrate(pool)
console.log(applied.length > 0 ? `migrations applied: ${applied.join(', ')}` : 'schema up to date')

const repo = new WorldRepository(pool)
await repo.reset()

const rng = makeRng(SEED)
const city = generateCity(DEFAULT_CITY, SEED)
const agents: Agent[] = []
const homes: Location[] = []
for (const i of ROSTER) {
  const { agent, home } = createAgent(i, city)
  agents.push(agent)
  homes.push(home)
}
let state: WorldState = {
  tick: 0, agents, locations: [...city.locations, ...homes], relationships: new Map(),
  scenesTodayByAgent: new Map(), scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(), notableToday: new Set(), openings: city.openings,
}

const NOW = Date.parse('2026-08-19T00:00:00Z')
for (let i = 0; i < 400; i++) state = tick(state, { now: NOW, random: rng }).state
console.log(`ran ${state.tick} ticks`)

await repo.save(state, SEED, DEFAULT_CITY)
const loaded = await repo.load()
if (loaded == null) throw new Error('nothing loaded back')

/**
 * Key-order-insensitive. JSONB returns object keys in its own order, so a naive
 * JSON.stringify comparison reports a difference where the data is identical —
 * which looks exactly like a persistence bug and is not one.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    )
  return v
}

// 1. The saved world matches what was running.
const norm = (s: WorldState) =>
  JSON.stringify(canonical({
    tick: s.tick,
    agents: [...s.agents].sort((a, b) => a.id.localeCompare(b.id)),
    rels: [...s.relationships.entries()].sort(),
    counters: [
      [...s.scenesTodayByAgent].sort(),
      [...s.scenesTodayByPair].sort(),
      [...s.passingTodayByPair].sort(),
      [...s.notableToday].sort(),
    ],
    openings: [...s.openings.entries()].sort(),
  }))
const same = norm(state) === norm(loaded.state)
console.log(`state identical after reload : ${same ? 'yes' : 'NO'}`)
if (!same) {
  const a = JSON.parse(norm(state)), b = JSON.parse(norm(loaded.state))
  for (const k of Object.keys(a))
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`  differs: ${k}`)
}

// 2. And it keeps running the same way. Same RNG, so any divergence is state.
const contA = makeRng(999)
const contB = makeRng(999)
let sa = state, sb = loaded.state
for (let i = 0; i < 50; i++) {
  sa = tick(sa, { now: NOW, random: contA }).state
  sb = tick(sb, { now: NOW, random: contB }).state
}
console.log(`50 further ticks agree       : ${norm(sa) === norm(sb) ? 'yes' : 'NO'}`)

await pool.end()
