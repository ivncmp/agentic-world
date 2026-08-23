/**
 * Live text view of the neighbourhood — DESIGN.md's "village log", the actual
 * v0 deliverable. If the drama does not grip here, in ASCII, no isometric
 * renderer will save it.
 *
 * Doubles as the first real test of the spatial model: agents visibly walk
 * between tiles instead of teleporting between ids.
 */
import { tick, type WorldState } from '../engine/tick.js'
import { TICKS_PER_DAY, hourOfDay, worldTime } from '../engine/clock.js'
import { generateCity } from '../world/generator.js'
import { DEFAULT_CITY } from '../world/config.js'
import { createAgent } from '../agents/create.js'
import { makeRng, pick } from '../world/rng.js'
import { ROSTER } from './roster.js'
import { occupationDef } from '../world/occupations.js'
import { DproxyProvider } from '../cognition/provider.js'
import { resolveScene, persistScene } from '../cognition/scene.js'
import { InMemoryStore } from '../memory/in-memory-store.js'
import { DbrainStore } from '../memory/dbrain-store.js'
import type { MemoryStore } from '../memory/store.js'
import { makePool, migrate } from '../persistence/db.js'
import { WorldRepository } from '../persistence/world-repo.js'
import { HistoryRepository } from '../persistence/history-repo.js'
import { applySceneOutcome, abandonScene } from '../engine/apply-scene.js'
import { applyReflection } from '../engine/apply-reflection.js'
import { reflect, persistReflection } from '../cognition/reflection.js'
import { resolveValues } from '../agents/values.js'
import { pairKey } from '../engine/tick.js'
import { Recorder } from '../replay/recorder.js'
import { renderViewer } from '../replay/viewer-template.js'
import type { RecordedEvent } from '../replay/format.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../agents/agent.js'
import type { Location, LocationKind } from '../world/locations.js'

const SEED = Number(process.env.SEED ?? 42)
const DAYS = Number(process.env.DAYS ?? 2)
const MS = Number(process.env.MS ?? 60) // wall-clock ms per tick
const TICKS = Number(process.env.TICKS ?? TICKS_PER_DAY * DAYS)
/**
 * Cognition is opt-in: the engine alone runs a day in seconds, while each
 * resolved scene costs 7-40s against dproxy. Default off so the grid stays
 * usable for debugging movement and states; LLM=1 when you want dialogue.
 */
const USE_LLM = process.env.LLM === '1'
const MAX_SCENES = Number(process.env.MAX_SCENES ?? 6)
const provider = new DproxyProvider({
  url: process.env.DPROXY_URL ?? 'http://100.115.51.71:7880',
  apiKey: process.env.DPROXY_API_KEY,
})
/**
 * PERSIST=1 runs against the real stores: Postgres for world state and history,
 * dbrain for narrative memory. Off by default so the loop stays runnable with
 * no infrastructure — a debug view that needs two containers to start is a
 * debug view nobody uses.
 */
const PERSIST = process.env.PERSIST === '1'
const pool = PERSIST ? makePool() : null
const world = pool == null ? null : new WorldRepository(pool)
const history = pool == null ? null : new HistoryRepository(pool)
const store: MemoryStore = PERSIST
  ? new DbrainStore({
      url: process.env.DBRAIN_URL ?? 'http://localhost:7978',
      token: process.env.DBRAIN_TOKEN ?? '',
    })
  : new InMemoryStore()
let resolvedScenes = 0
let reflections = 0
let spendUsd = 0
/** Reflection is bounded by agent count, not activity — one call each, nightly. */
const MAX_REFLECTIONS = Number(process.env.MAX_REFLECTIONS ?? 16)
/** RECORD=1 writes a replay plus a self-contained HTML viewer. */
const RECORD = process.env.RECORD === '1'
const OUT = join('src/dev/executions', process.env.RUN ?? `run-seed${SEED}`)

// Single-width glyphs only: emoji are two columns wide and ruin the grid.
const GLYPH: Record<LocationKind, string> = {
  home: '⌂', bar: '♦', office: '■', shop: '▪', supermarket: '▦',
  clinic: '✚', school: '▲', gym: '●', park: '♣', garage: '✱',
  cinema: '▸', bowling: '◎', cafe: '♠',
}
const C = {
  dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', mag: '\x1b[35m', blue: '\x1b[34m',
}
const STATE_COLOUR: Record<string, string> = {
  sleep: C.blue, work: C.green, travel: C.yellow, scene: C.mag,
  steal: C.red, indulge_vice: C.red, idle: C.dim,
}

const rng = makeRng(SEED)
const city = generateCity(DEFAULT_CITY, SEED)
const agents: Agent[] = []
const homes: Location[] = []
for (const i of ROSTER) {
  const { agent, home } = createAgent(i, city)
  agents.push(agent)
  homes.push(home)
}
const allLocs = [...city.locations, ...homes]
const byId = new Map(allLocs.map((l) => [l.id, l]))
const initial = (a: Agent) => a.name[0] ?? '?'

// Crop the grid to what is actually built, so the map fits a terminal.
const xs = allLocs.map((l) => l.tile.x)
const ys = allLocs.map((l) => l.tile.y)
const x0 = Math.min(...xs), x1 = Math.max(...xs)
const y0 = Math.min(...ys), y1 = Math.max(...ys)

let state: WorldState = {
  tick: 0, agents, locations: allLocs, relationships: new Map(),
  scenesTodayByAgent: new Map(), scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(),
  notableToday: new Set(), openings: city.openings,
}

const FEED_LINES = 14
let recorder: Recorder | null = null
let tickEvents: RecordedEvent[] = []
const feed: string[] = []
const push = (s: string) => { feed.push(s); if (feed.length > FEED_LINES) feed.shift() }

const clock = (t: number) => {
  const d = Math.floor(t / TICKS_PER_DAY) + 1
  const h = hourOfDay(t)
  const m = Math.floor((((t % TICKS_PER_DAY) / TICKS_PER_DAY) * 24 - h) * 60)
  return `d${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Where to draw an agent: walking ones sit between origin and destination. */
function drawTile(a: Agent): { x: number; y: number } {
  const act = a.activity
  const here = byId.get(a.location)?.tile ?? { x: x0, y: y0 }
  if (act?.kind !== 'travel' || act.from == null) return here
  const to = byId.get(act.at)?.tile
  if (to == null) return here
  const span = Math.max(1, act.endsTick - act.startedTick)
  const p = Math.min(1, (state.tick - act.startedTick) / span)
  return { x: Math.round(here.x + (to.x - here.x) * p), y: Math.round(here.y + (to.y - here.y) * p) }
}

/** Visible width: ANSI escapes take no columns. */
const width = (s: string): number => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length

const padTo = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - width(s)))

function render(): void {
  const CELL = 5
  const locAt = new Map<string, Location>()
  for (const l of allLocs) locAt.set(`${l.tile.x},${l.tile.y}`, l)

  // Agents sit *on* their venue glyph rather than replacing it, so you can see
  // both where someone is and what kind of place it is.
  const at = new Map<string, string>()
  for (const a of state.agents) {
    const t = drawTile(a)
    const key = `${t.x},${t.y}`
    const col = STATE_COLOUR[a.activity?.kind ?? 'idle'] ?? ''
    at.set(key, (at.get(key) ?? '') + col + initial(a) + C.reset)
  }

  const lines: string[] = []
  lines.push(`${C.bold}${DEFAULT_CITY.name}${C.reset}  ${clock(state.tick)}`)
  lines.push('')
  for (let y = y0; y <= y1; y++) {
    let line = ''
    for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`
      const loc = locAt.get(key)
      const glyph = loc == null ? `${C.dim}·${C.reset}` : `${C.cyan}${GLYPH[loc.kind]}${C.reset}`
      line += padTo(glyph + (at.get(key) ?? ''), CELL)
    }
    lines.push('  ' + line.trimEnd())
  }
  lines.push('')
  for (const a of state.agents) {
    const st = a.activity?.kind ?? 'idle'
    const col = STATE_COLOUR[st] ?? ''
    const where = a.activity?.kind === 'travel'
      ? `→ ${byId.get(a.activity.at)?.name ?? '?'}`
      : (byId.get(a.location)?.name ?? '?')
    lines.push(
      `  ${initial(a)} ${a.name.padEnd(7)}${C.dim}${occupationDef(a.occupation).label.padEnd(11)}${C.reset}` +
        `${col}${st.padEnd(13)}${C.reset}${C.dim}${where.padEnd(20)}${C.reset}` +
        `${String(Math.round(a.money)).padStart(5)}c` +
        (a.housing.arrears > 0 ? ` ${C.red}-${a.housing.arrears}${C.reset}` : ''),
    )
  }
  lines.push('')
  const meter = USE_LLM
    ? `${C.dim}cognition: ${resolvedScenes}/${MAX_SCENES} scenes · ${reflections} reflections · $${spendUsd.toFixed(3)}${C.reset}`
    : `${C.dim}cognition: off (LLM=1 to enable)${C.reset}`
  lines.push(`  ${C.dim}${'─'.repeat(30)}${C.reset} ${meter}`)
  for (const f of feed) lines.push('  ' + f)

  process.stdout.write('\x1b[H\x1b[2J' + lines.join('\n') + '\n')
}

process.stdout.write('\x1b[?25l') // hide cursor
process.on('exit', () => process.stdout.write('\x1b[?25h'))

if (pool != null) {
  const applied = await migrate(pool)
  if (applied.length > 0) console.log(`migrations applied: ${applied.join(', ')}`)
}
if (store instanceof DbrainStore) {
  for (const a of agents) await store.ensureAgent(a.id, a.name)
}
// Resume where the world left off, unless explicitly starting over.
if (world != null && process.env.FRESH !== '1') {
  const saved = await world.load()
  if (saved != null) {
    state = saved.state
    console.log(`resumed at tick ${state.tick} (${worldTime(state.tick).toISOString()})`)
  }
}

recorder = RECORD ? new Recorder(city, allLocs, state) : null

for (let i = 0; i < TICKS; i++) {
  const r = tick(state, { now: Date.parse('2026-08-19T00:00:00Z'), random: rng })
  state = r.state
  tickEvents = []
  const nameFor = (id: string) => state.agents.find((x) => x.id === id)?.name ?? id
  for (const e of r.events) {
    if (e.type === 'theft')
      tickEvents.push({ kind: 'theft', text: `${nameFor(e.thief)} stole ${e.amount}c from ${nameFor(e.victim)}` })
    if (e.type === 'rent_missed')
      tickEvents.push({ kind: 'rent', text: `${nameFor(e.agent)} missed rent (-${e.arrears})` })
    if (e.type === 'hired') tickEvents.push({ kind: 'hired', text: `${nameFor(e.agent)} found work` })
    if (e.type === 'bought_home') tickEvents.push({ kind: 'home', text: `${nameFor(e.agent)} bought their flat` })
    if (e.type === 'passing')
      tickEvents.push({ kind: 'passing', text: `${nameFor(e.a)} y ${nameFor(e.b)} crossed paths at ${byId.get(e.where)?.name ?? e.where}` })
    if (e.type === 'scene_started' && !USE_LLM)
      tickEvents.push({ kind: 'scene_started', text: `${nameFor(e.a)} y ${nameFor(e.b)} start talking` })
  }
  for (const e of r.events) {
    if (e.type === 'theft')
      push(`${C.red}${clock(e.tick)}  ${e.thief} stole ${e.amount}c from ${e.victim}${C.reset}`)
    if (e.type === 'rent_missed')
      push(`${C.yellow}${clock(e.tick)}  ${e.agent} missed rent (-${e.arrears})${C.reset}`)
    if (e.type === 'hired') push(`${C.green}${clock(e.tick)}  ${e.agent} found work${C.reset}`)
    if (e.type === 'bought_home') push(`${C.green}${clock(e.tick)}  ${e.agent} bought their flat${C.reset}`)
    if (e.type === 'scene_started' && !USE_LLM)
      push(`${C.mag}${clock(e.tick)}  ${nameFor(e.a)} y ${nameFor(e.b)} start talking${C.reset}`)
    if (e.type === 'passing')
      push(`${C.dim}${clock(e.tick)}  ${nameFor(e.a)} y ${nameFor(e.b)} crossed paths at ${byId.get(e.where)?.name ?? ''}${C.reset}`)
  }

  if (USE_LLM) {
    for (const job of r.sceneJobs) {
      const a = state.agents.find((x) => x.id === job.a)
      const b = state.agents.find((x) => x.id === job.b)
      if (a == null || b == null) continue
      if (resolvedScenes >= MAX_SCENES) {
        state = abandonScene(state, a.id, b.id)
        continue
      }
      // The pair is frozen while this runs, so pausing the view is honest:
      // in-world nothing moves either.
      push(`${C.mag}${clock(state.tick)}  ${a.name} × ${b.name} — talking…${C.reset}`)
      render()
      const rel = state.relationships.get(pairKey(a.id, b.id)) ?? {
        affection: 0, trust: 0, debt: 0, grievance: 0, encounters: 0, lastInteractionTick: null,
      }
      try {
        const res = await resolveScene(
          {
            a, b, rel,
            aboutB: await store.recall(a.id, b.id),
            aboutA: await store.recall(b.id, a.id),
            place: byId.get(a.location)?.name ?? a.location,
            hour: hourOfDay(state.tick),
            now: Date.parse('2026-08-19T00:00:00Z'),
          },
          provider,
        )
        await persistScene(store, a, b, res.outcome, state.tick)
        state = applySceneOutcome(state, a.id, b.id, res.outcome)
        await history?.recordScene({
          tick: state.tick, a: a.id, b: b.id, location: a.location,
          tension: job.score, outcome: res.outcome, costUsd: res.costUsd,
        })
        resolvedScenes++
        spendUsd += res.costUsd
        feed.pop() // drop the "hablando…" placeholder
        push(`${C.mag}${C.bold}${clock(state.tick)}  ${a.name} × ${b.name} · ${byId.get(a.location)?.name ?? ''}${C.reset}`)
        for (const d of res.outcome.dialogue.slice(0, 6))
          push(`  ${C.bold}${d.speaker}:${C.reset} ${d.line}`)
        push(`  ${C.dim}→ ${res.outcome.outcome}${C.reset}`)
        // Show the direction, not just the amount: a debug view exists to make
        // a wrong sign visible rather than plausible.
        const t = res.outcome.transfer
        if (t !== 0) {
          const from = t > 0 ? a.name : b.name
          const to = t > 0 ? b.name : a.name
          push(`  ${C.yellow}→ ${Math.abs(t)}c: ${from} → ${to}${C.reset}`)
        }
        tickEvents.push({
          kind: 'scene',
          text: `${a.name} × ${b.name} · ${byId.get(a.location)?.name ?? ''}`,
          dialogue: res.outcome.dialogue,
          outcome: res.outcome.outcome,
          ...(t === 0
            ? {}
            : {
                transfer: {
                  amount: Math.abs(t),
                  from: t > 0 ? a.name : b.name,
                  to: t > 0 ? b.name : a.name,
                },
              }),
        })
      } catch (err) {
        state = abandonScene(state, a.id, b.id)
        feed.pop()
        push(`${C.red}${clock(state.tick)}  scene failed: ${String(err).slice(0, 50)}${C.reset}`)
      }
    }
  }

  await history?.recordEvents(r.events)

  // Layer 3: the day is consolidated, and the owner gets something to read.
  if (USE_LLM && r.reflectionJobs.length > 0) {
    const dayStart = state.tick - TICKS_PER_DAY
    for (const id of r.reflectionJobs) {
      if (reflections >= MAX_REFLECTIONS) break
      const a = state.agents.find((x) => x.id === id)
      if (a == null) continue
      const known = [...state.relationships.entries()]
        .filter(([k]) => k.split(':').includes(a.id))
        .map(([k, rel]) => {
          const other = k.split(':').find((x) => x !== a.id) ?? ''
          return { id: other, name: state.agents.find((x) => x.id === other)?.name ?? other, rel }
        })
        .filter((x) => x.id !== '')
      try {
        const res = await reflect(
          {
            agent: a,
            values: resolveValues(a.values, Date.parse('2026-08-19T00:00:00Z')),
            today: await store.since(a.id, dayStart),
            identity: await store.identity(a.id),
            relationships: known,
            day: Math.floor(state.tick / TICKS_PER_DAY),
          },
          provider,
        )
        await persistReflection(store, a, res.outcome, state.tick, dayStart)
        state = applyReflection(state, a.id, res.outcome)
        await history?.recordDiary(a.id, state.tick, res.outcome)
        reflections++
        spendUsd += res.costUsd
        const moved = Object.entries(res.outcome.drift)
          .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
          .join(', ')
        push(`${C.cyan}${C.bold}${clock(state.tick)}  ${a.name} — diary${C.reset}`)
        push(`  ${res.outcome.diary}`)
        if (moved !== '') push(`  ${C.yellow}changed: ${moved}${C.reset}`)
        tickEvents.push({
          kind: 'diary',
          text: `${a.name} — diary`,
          outcome: res.outcome.diary,
          ...(moved === '' ? {} : { drift: moved }),
        })
      } catch (err) {
        push(`${C.red}${clock(state.tick)}  reflection failed: ${String(err).slice(0, 40)}${C.reset}`)
      }
    }
  }

  if (world != null && r.reflectionJobs.length > 0) {
    await world.save(state, SEED, DEFAULT_CITY)
  }

  recorder?.capture(state, tickEvents)
  render()
  await new Promise((res) => setTimeout(res, MS))
}

if (world != null) {
  await world.save(state, SEED, DEFAULT_CITY)
  console.log(`world saved at tick ${state.tick}`)
}
await pool?.end()

if (recorder != null) {
  mkdirSync(OUT, { recursive: true })
  const recording = recorder.finish({ scenesResolved: resolvedScenes, spendUsd })
  writeFileSync(join(OUT, 'recording.json'), JSON.stringify(recording))
  writeFileSync(join(OUT, 'viewer.html'), renderViewer(JSON.stringify(recording)))
  process.stdout.write(`\nwrote ${join(OUT, 'viewer.html')}\n`)
}
