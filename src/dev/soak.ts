/**
 * Runs a full game day headless and summarises what happened. Cheapest possible
 * answer to the "bland soup" risk: if nothing interesting shows up here, no
 * amount of prompt work will save the scenes.
 *
 * Uses the real flow — generate a city, then create agents the way the MCP
 * join endpoint will — so what it measures is what the world will actually do.
 */
import { tick, type WorldState } from '../engine/tick.js'
import { TICKS_PER_DAY } from '../engine/clock.js'
import { generateCity } from '../world/generator.js'
import { DEFAULT_CITY } from '../world/config.js'
import { createAgent } from '../agents/create.js'
import { ROSTER } from './roster.js'
import { makeRng, pick } from '../world/rng.js'
import { occupationDef } from '../world/occupations.js'
import type { Agent } from '../agents/agent.js'
import type { Location } from '../world/locations.js'

const SEED = Number(process.env.SEED ?? 42)
const rng = makeRng(SEED)
const city = generateCity(DEFAULT_CITY, SEED)


const agents: Agent[] = []
const homes: Location[] = []
for (const input of ROSTER) {
  const { agent, home } = createAgent(input, city)
  agents.push(agent)
  homes.push(home)
}

type LogLine = { tick: number; text: string }
const log: LogLine[] = []
const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
const placeOf = (id: string) => city.locations.find((l) => l.id === id)?.name ?? id
const stamp = (t: number) => {
  const d = Math.floor(t / TICKS_PER_DAY) + 1
  const h = Math.floor(((t % TICKS_PER_DAY) / TICKS_PER_DAY) * 24)
  const m = Math.floor((((t % TICKS_PER_DAY) / TICKS_PER_DAY) * 24 - h) * 60)
  return `d${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

let state: WorldState = {
  tick: 0,
  agents,
  locations: [...city.locations, ...homes],
  relationships: new Map(),
  scenesTodayByAgent: new Map(),
  scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(),
  notableToday: new Set(),
  openings: city.openings,
}

const actionCounts = new Map<string, number>()
const eventCounts = new Map<string, number>()
let scenesQueued = 0
let reflectionsQueued = 0
let coLocatedPairTicks = 0

const DAYS = Number(process.env.DAYS ?? 3)
for (let i = 0; i < TICKS_PER_DAY * DAYS; i++) {
  const r = tick(state, { now: Date.parse('2026-08-19T00:00:00Z'), random: rng })
  state = r.state
  for (const e of r.events) {
    eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1)
    if (e.type === 'action') {
      actionCounts.set(e.action.kind, (actionCounts.get(e.action.kind) ?? 0) + 1)
      continue
    }
    if (e.type === 'theft')
      log.push({ tick: e.tick, text: `${nameOf(e.thief)} stole ${e.amount} from ${nameOf(e.victim)}.` })
    if (e.type === 'hired')
      log.push({ tick: e.tick, text: `${nameOf(e.agent)} found work.` })
    if (e.type === 'rent_missed')
      log.push({ tick: e.tick, text: `${nameOf(e.agent)} missed rent — arrears ${e.arrears}.` })
    if (e.type === 'bought_home')
      log.push({ tick: e.tick, text: `${nameOf(e.agent)} bought their home and stopped renting.` })
  }
  for (const s of r.sceneJobs)
    log.push({ tick: r.state.tick, text: `scene: ${nameOf(s.a)} × ${nameOf(s.b)} (tension ${s.score.toFixed(2)})` })

  // How often anyone is even in the same room — the ceiling on social life.
  const byLoc = new Map<string, number>()
  for (const a of state.agents) byLoc.set(a.location, (byLoc.get(a.location) ?? 0) + 1)
  for (const n of byLoc.values()) if (n > 1) coLocatedPairTicks += (n * (n - 1)) / 2

  scenesQueued += r.sceneJobs.length
  reflectionsQueued += r.reflectionJobs.length
}

const show = (title: string, m: Map<string, number>) => {
  console.log(`\n${title}`)
  ;[...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`))
}

console.log(`=== ${DEFAULT_CITY.name} — village log (seed ${SEED}) ===`)
for (const l of log.sort((a, b) => a.tick - b.tick)) console.log(`  ${stamp(l.tick)}  ${l.text}`)

console.log(
  `\n=== ${DAYS} game days · ${agents.length} agents · ${state.locations.length} locations ===`,
)
show('actions', actionCounts)
show('events', eventCounts)
console.log(`\nco-located pair-ticks         : ${coLocatedPairTicks}`)
console.log(`scene jobs queued (LLM calls) : ${scenesQueued}`)
console.log(`reflection jobs queued        : ${reflectionsQueued}`)
console.log(`\nper day: ${(scenesQueued / DAYS).toFixed(1)} scenes, ${(reflectionsQueued / DAYS).toFixed(1)} reflections`)
console.log('\nagents at the end:')
for (const a of state.agents) {
  console.log(
    `  ${a.name.padEnd(7)} ${occupationDef(a.occupation).label.padEnd(11)} money=${String(Math.round(a.money)).padStart(5)}  arrears=${String(a.housing.arrears).padStart(4)}  job=${a.job ? placeOf(a.job.employerId) : '—'}`,
  )
}
