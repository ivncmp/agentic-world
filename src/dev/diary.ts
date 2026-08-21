/**
 * Renders per-agent diaries from a headless run. Where soak.ts asks "is the
 * world alive?", this asks "is any single life worth following?" — which is the
 * actual product question, since the owner reads one agent, not a histogram.
 */
import { tick, type WorldState } from '../engine/tick.js'
import { TICKS_PER_DAY } from '../engine/clock.js'
import { generateCity } from '../world/generator.js'
import { DEFAULT_CITY } from '../world/config.js'
import { createAgent } from '../agents/create.js'
import { makeRng, pick } from '../world/rng.js'
import { occupationDef } from '../world/occupations.js'
import { ROSTER } from './roster.js'
import type { Agent } from '../agents/agent.js'
import type { Location } from '../world/locations.js'

const SEED = Number(process.env.SEED ?? 42)
const DAYS = Number(process.env.DAYS ?? 14)
const WATCH = (process.env.WATCH ?? 'tomas,ana,diego').split(',')

const rng = makeRng(SEED)
const city = generateCity(DEFAULT_CITY, SEED)

const agents: Agent[] = []
const homes: Location[] = []
for (const input of ROSTER) {
  const { agent, home } = createAgent(input, city)
  agents.push(agent)
  homes.push(home)
}

const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
const allLocs = [...city.locations, ...homes]
const placeOf = (id: string) => allLocs.find((l) => l.id === id)?.name ?? id
const hhmm = (t: number) => {
  const h = Math.floor(((t % TICKS_PER_DAY) / TICKS_PER_DAY) * 24)
  const m = Math.floor((((t % TICKS_PER_DAY) / TICKS_PER_DAY) * 24 - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type DayLog = {
  moneyStart: number
  moneyEnd: number
  arrears: number
  worked: number
  vices: number
  visited: Set<string>
  metPeople: Set<string>
  beats: string[]
}
const diaries = new Map<string, Map<number, DayLog>>(WATCH.map((id) => [id, new Map()]))

const dayLog = (id: string, day: number, money: number): DayLog | undefined => {
  const d = diaries.get(id)
  if (d == null) return undefined
  let entry = d.get(day)
  if (entry == null) {
    entry = { moneyStart: money, moneyEnd: money, arrears: 0, worked: 0, vices: 0,
      visited: new Set(), metPeople: new Set(), beats: [] }
    d.set(day, entry)
  }
  return entry
}

let state: WorldState = {
  tick: 0,
  agents,
  locations: allLocs,
  relationships: new Map(),
  scenesTodayByAgent: new Map(),
  scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(),
  notableToday: new Set(),
  openings: city.openings,
}

for (let i = 0; i < TICKS_PER_DAY * DAYS; i++) {
  const day = Math.floor(state.tick / TICKS_PER_DAY) + 1
  const r = tick(state, { now: Date.parse('2026-08-19T00:00:00Z'), random: rng })
  state = r.state

  for (const id of WATCH) {
    const a = state.agents.find((x) => x.id === id)
    if (a == null) continue
    const d = dayLog(id, day, a.money)
    if (d == null) continue
    d.moneyEnd = a.money
    d.arrears = a.housing.arrears
    d.visited.add(a.location)
    for (const other of state.agents)
      if (other.id !== id && other.location === a.location) d.metPeople.add(other.name)
  }

  for (const e of r.events) {
    const who =
      e.type === 'action' ? e.agent
      : e.type === 'theft' ? e.thief
      : e.type === 'scene_started' || e.type === 'scene_abandoned' || e.type === 'passing' ? e.a
      : e.agent
    const d = dayLog(who, day, 0)
    if (d != null) {
      if (e.type === 'action' && e.action.kind === 'work') d.worked++
      if (e.type === 'action' && e.action.kind === 'indulge_vice') d.vices++
      if (e.type === 'theft')
        d.beats.push(`${hhmm(e.tick)} — took ${e.amount} credits from ${nameOf(e.victim)} at ${placeOf(state.agents.find((x) => x.id === e.thief)?.location ?? '')}`)
      if (e.type === 'rent_missed') d.beats.push(`${hhmm(e.tick)} — could not make rent. Arrears now ${e.arrears}.`)
      if (e.type === 'hired') d.beats.push(`${hhmm(e.tick)} — started work.`)
      if (e.type === 'bought_home') d.beats.push(`${hhmm(e.tick)} — bought the flat. No more landlord.`)
    }
    if (e.type === 'theft') {
      const v = dayLog(e.victim, day, 0)
      if (v != null) v.beats.push(`${hhmm(e.tick)} — ${e.amount} credits missing. ${nameOf(e.thief)} was there.`)
    }
  }

  for (const s of r.sceneJobs) {
    for (const [me, them] of [[s.a, s.b], [s.b, s.a]] as const) {
      const d = dayLog(me, day, 0)
      if (d != null)
        d.beats.push(`${hhmm(r.state.tick)} — ran into ${nameOf(them)} at ${placeOf(state.agents.find((x) => x.id === me)?.location ?? '')}. [scene, tension ${s.score.toFixed(2)}]`)
    }
  }
}

for (const id of WATCH) {
  const a = state.agents.find((x) => x.id === id)
  const d = diaries.get(id)
  if (a == null || d == null) continue
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  ${a.name} · ${occupationDef(a.occupation).label} · vices: ${a.vices.map((v) => v.kind).join(', ')}`)
  console.log(`${'═'.repeat(70)}`)
  for (const [day, log] of [...d.entries()].sort((x, y) => x[0] - y[0])) {
    const delta = Math.round(log.moneyEnd - log.moneyStart)
    console.log(
      `\nDay ${day}  ·  ${Math.round(log.moneyEnd)} credits (${delta >= 0 ? '+' : ''}${delta})` +
        `${log.arrears > 0 ? `  ·  owes ${log.arrears}` : ''}` +
        `  ·  ${Math.round(log.worked / 12)}h worked  ·  ${log.visited.size} places  ·  saw ${log.metPeople.size}`,
    )
    for (const b of log.beats) console.log(`    ${b}`)
  }
}
