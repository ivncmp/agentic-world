/**
 * The world server. Long-running, self-driving: it ticks on a real-time
 * cadence, persists as it goes, resolves cognition beside the loop, and
 * broadcasts state so a viewer can watch it live.
 *
 * This is the process that makes agentic-world a world rather than a script.
 */
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { tick, pairKey, type WorldState, type WorldEvent } from '../engine/tick.js'
import { applySceneOutcome, abandonScene } from '../engine/apply-scene.js'
import { applyReflection } from '../engine/apply-reflection.js'
import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOfDay, worldTime } from '../engine/clock.js'
import { generateCity } from '../world/generator.js'
import { DEFAULT_CITY } from '../world/config.js'
import { createAgent } from '../agents/create.js'
import { makeRng, pick } from '../world/rng.js'
import { ROSTER } from '../dev/roster.js'
import { occupationDef } from '../world/occupations.js'
import { resolveValues, VALUE_AXES } from '../agents/values.js'
import { viceDef } from '../agents/vices.js'
import { DproxyProvider } from '../cognition/provider.js'
import { resolveScene, persistScene } from '../cognition/scene.js'
import { reflect, persistReflection } from '../cognition/reflection.js'
import { DbrainStore } from '../memory/dbrain-store.js'
import { InMemoryStore } from '../memory/in-memory-store.js'
import type { MemoryStore } from '../memory/store.js'
import { makePool, migrate } from '../persistence/db.js'
import { WorldRepository } from '../persistence/world-repo.js'
import { HistoryRepository } from '../persistence/history-repo.js'
import { JobRepository } from '../persistence/job-repo.js'
import { CognitionWorker, type Job } from './cognition-worker.js'
import type { Agent } from '../agents/agent.js'
import type { Location } from '../world/locations.js'

const SEED = Number(process.env.SEED ?? 42)
/** Real milliseconds per tick. The dial between "watchable" and "real time". */
const TICK_MS = Number(process.env.TICK_MS ?? 2000)
const PORT = Number(process.env.PORT ?? 7070)
const USE_LLM = process.env.LLM !== '0'
const PERSIST = process.env.PERSIST !== '0'
const NOW = Date.parse('2026-08-19T00:00:00Z') // guidance-decay reference
const SAVE_EVERY_TICKS = Math.max(1, Math.round(TICKS_PER_HOUR))

/**
 * How long a pair may stand together waiting for cognition, in real time —
 * derived into ticks, because that is the unit the loop counts in. A scene via
 * dproxy takes 15-40s; anything shorter abandons every conversation before it
 * arrives and applies the outcome to two people who already walked away.
 */
const SCENE_TIMEOUT_MS = Number(process.env.SCENE_TIMEOUT_MS ?? 120_000)
const SCENE_PATIENCE = Math.max(2, Math.ceil(SCENE_TIMEOUT_MS / TICK_MS))

const provider = new DproxyProvider({
  url: process.env.DPROXY_URL ?? 'http://host.docker.internal:7880',
  apiKey: process.env.DPROXY_API_KEY,
})

const pool = PERSIST ? makePool() : null
const worldRepo = pool == null ? null : new WorldRepository(pool)
const history = pool == null ? null : new HistoryRepository(pool)
const jobs = pool == null ? null : new JobRepository(pool)
const store: MemoryStore = PERSIST
  ? new DbrainStore({
      url: process.env.DBRAIN_URL ?? 'http://dbrain:7878',
      token: process.env.DBRAIN_TOKEN ?? '',
    })
  : new InMemoryStore()

// ---- world -----------------------------------------------------------------

const rng = makeRng(SEED)
const city = generateCity(DEFAULT_CITY, SEED)
const agents: Agent[] = []
const homes: Location[] = []
for (const input of ROSTER) {
  const { agent, home } = createAgent(input, city)
  agents.push(agent)
  homes.push(home)
}
let allLocs: readonly Location[] = [...city.locations, ...homes]
const byId = new Map(allLocs.map((l) => [l.id, l]))

let state: WorldState = {
  tick: 0, agents, locations: allLocs, relationships: new Map(),
  scenesTodayByAgent: new Map(), scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(), notableToday: new Set(), openings: city.openings,
}

if (pool != null) {
  const applied = await migrate(pool)
  if (applied.length > 0) console.log(`migrations: ${applied.join(', ')}`)
}
if (store instanceof DbrainStore) for (const a of agents) await store.ensureAgent(a.id, a.name)
if (worldRepo != null && process.env.FRESH !== '1') {
  const saved = await worldRepo.load()
  if (saved != null) {
    state = saved.state
    console.log(`resumed at tick ${state.tick} — ${worldTime(state.tick).toISOString()}`)

    // A saved world carries the tiles it was laid out on. When the city plan
    // changes underneath it, move each place onto its planned plot rather than
    // starting over: relationships, memories and diaries are what make a world
    // worth keeping, and none of them live in a coordinate.
    const planned = new Map(allLocs.map((l) => [l.id, l]))
    let moved = 0
    for (const loc of state.locations) {
      const to = planned.get(loc.id)
      if (to == null) continue
      if (loc.tile.x !== to.tile.x || loc.tile.y !== to.tile.y) moved++
      loc.tile = to.tile
      loc.district = to.district
    }
    if (moved > 0) console.log(`re-laid the city: ${moved} place(s) moved onto the new street plan`)

    // The resumed locations are now authoritative — the tick loop reads them.
    // Point every lookup at the same objects so the engine and the viewer can
    // never disagree about where a building is.
    allLocs = state.locations
    byId.clear()
    for (const l of allLocs) byId.set(l.id, l)
  }
}

// ---- live feed -------------------------------------------------------------

type Feed = { tick: number; time: string; kind: string; text: string; detail?: unknown }
const feed: Feed[] = []
const clients = new Set<WebSocket>()

const nameOf = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id
const placeOf = (id: string) => byId.get(id)?.name ?? id

function publish(kind: string, text: string, detail?: unknown): void {
  const item: Feed = { tick: state.tick, time: worldTime(state.tick).toISOString(), kind, text, ...(detail == null ? {} : { detail }) }
  feed.push(item)
  if (feed.length > 300) feed.shift()
  broadcast({ type: 'feed', item })
}

function snapshot(): unknown {
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
          progress = Math.min(1, Math.max(0, (state.tick - act.startedTick) / Math.max(1, act.endsTick - act.startedTick)))
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
        /** Who this agent is mid-conversation with, so the viewer can pair them. */
        partner: act?.with ?? null,
        money: Math.round(a.money), arrears: a.housing.arrears,
      }
    }),
    cognition: { pending: worker.pending, done: worker.completed, dropped: worker.dropped, spentUsd: worker.spent },
  }
}

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(text)
}

// ---- cognition, running beside the loop ------------------------------------

const worker = new CognitionWorker(provider, async (job: Job): Promise<number> => {
  if (job.kind === 'scene') {
    const a = state.agents.find((x) => x.id === job.a)
    const b = state.agents.find((x) => x.id === job.b)
    if (a == null || b == null) return 0
    const rel = state.relationships.get(pairKey(a.id, b.id)) ?? {
      affection: 0, trust: 0, debt: 0, grievance: 0, encounters: 0, lastInteractionTick: null,
    }
    try {
      const res = await resolveScene(
        { a, b, rel, aboutB: await store.recall(a.id, b.id), aboutA: await store.recall(b.id, a.id),
          place: placeOf(a.location), hour: hourOfDay(job.tick), now: NOW },
        provider,
      )
      await persistScene(store, a, b, res.outcome, job.tick)
      state = applySceneOutcome(state, a.id, b.id, res.outcome)
      await history?.recordScene({ tick: job.tick, a: a.id, b: b.id, location: a.location,
        tension: job.tension, outcome: res.outcome, costUsd: res.costUsd })
      publish('scene', `${a.name} × ${b.name} · ${placeOf(a.location)}`, {
        // Ids as well as names: the viewer hangs the speech bubbles off the two
        // sprites, and names are not addresses.
        a: a.id, b: b.id,
        dialogue: res.outcome.dialogue, outcome: res.outcome.outcome,
        transfer: res.outcome.transfer === 0 ? null : {
          amount: Math.abs(res.outcome.transfer),
          from: res.outcome.transfer > 0 ? a.name : b.name,
          to: res.outcome.transfer > 0 ? b.name : a.name,
        },
      })
      return res.costUsd
    } catch (err) {
      state = abandonScene(state, a.id, b.id)
      publish('error', `scene ${a.name} × ${b.name} failed: ${String(err).slice(0, 60)}`)
      return 0
    }
  }

  const a = state.agents.find((x) => x.id === job.agent)
  if (a == null) return 0
  const dayStart = job.tick - TICKS_PER_DAY
  const known = [...state.relationships.entries()]
    .filter(([k]) => k.split(':').includes(a.id))
    .map(([k, rel]) => {
      const other = k.split(':').find((x) => x !== a.id) ?? ''
      return { id: other, name: nameOf(other), rel }
    })
    .filter((x) => x.id !== '')
  try {
    const res = await reflect(
      { agent: a, values: resolveValues(a.values, NOW), today: await store.since(a.id, dayStart),
        identity: await store.identity(a.id), relationships: known,
        day: Math.floor(job.tick / TICKS_PER_DAY) },
      provider,
    )
    await persistReflection(store, a, res.outcome, job.tick, dayStart)
    state = applyReflection(state, a.id, res.outcome)
    await history?.recordDiary(a.id, job.tick, res.outcome)
    publish('diary', `${a.name} — diary`, { text: res.outcome.diary, drift: res.outcome.drift })
    return res.costUsd
  } catch (err) {
    publish('error', `reflection ${a.name} failed: ${String(err).slice(0, 60)}`)
    return 0
  }
}, {
  concurrency: Number(process.env.COGNITION_CONCURRENCY ?? 2),
  onDone: async (id) => { await jobs?.done(id) },
  onFailed: async (id) => { await jobs?.failed(id) },
})

/** Enqueue durably first, so a crash between here and completion is recoverable. */
async function submit(job: Job): Promise<void> {
  const id = (await jobs?.enqueue(job)) ?? 0
  worker.submit(job, id)
}

// Two recovery paths, because they cover different failures. The queue covers
// work that was written down and never finished; the diary backfill covers a
// day that closed without the job ever being enqueued at all.
if (jobs != null) {
  const stranded = await jobs.pending()
  for (const { id, job } of stranded) worker.submit(job, id)
  if (stranded.length > 0) console.log(`requeued ${stranded.length} job(s) from the previous run`)

  const today = Math.floor(state.tick / TICKS_PER_DAY) + 1
  const missing = await jobs.daysMissingDiary(state.agents.map((a) => a.id), today)
  for (const m of missing) {
    await submit({ kind: 'reflection', agent: m.agent, tick: m.day * TICKS_PER_DAY })
  }
  if (missing.length > 0) console.log(`backfilling ${missing.length} missing diary/diaries`)
}

// ---- the loop --------------------------------------------------------------

let ticking = false
async function step(): Promise<void> {
  if (ticking) return // a slow save must not overlap the next tick
  ticking = true
  try {
    const r = tick(state, { now: NOW, random: rng, scenePatienceTicks: SCENE_PATIENCE })
    state = r.state

    for (const e of r.events) describe(e)
    await history?.recordEvents(r.events)

    if (USE_LLM) {
      for (const s of r.sceneJobs) await submit({ kind: 'scene', a: s.a, b: s.b, tension: s.score, tick: state.tick })
      for (const id of r.reflectionJobs) await submit({ kind: 'reflection', agent: id, tick: state.tick })
    }

    // Save every world hour, not only at the day rollover. A daily save leaves
    // the database a whole game day behind what is running — a crash loses that
    // day, and anything reading the database (pgweb, a future MCP briefing)
    // shows a world that no longer exists.
    if (worldRepo != null && state.tick % SAVE_EVERY_TICKS === 0) {
      await worldRepo.save(state, SEED, DEFAULT_CITY)
    }
    broadcast(snapshot())
  } catch (err) {
    console.error('tick failed:', err)
  } finally {
    ticking = false
  }
}

function describe(e: WorldEvent): void {
  switch (e.type) {
    case 'theft': publish('theft', `${nameOf(e.thief)} stole ${e.amount}c from ${nameOf(e.victim)}`); break
    case 'rent_missed': publish('rent', `${nameOf(e.agent)} missed rent — ${e.arrears} behind`); break
    case 'hired': publish('hired', `${nameOf(e.agent)} found work`); break
    case 'bought_home': publish('home', `${nameOf(e.agent)} bought their flat`); break
    case 'passing': publish('passing', `${nameOf(e.a)} and ${nameOf(e.b)} crossed paths at ${placeOf(e.where)}`); break
    default: break
  }
}

// ---- http + ws -------------------------------------------------------------

/**
 * Everything the spectator view needs about one agent: the three personality
 * strata side by side, the vices with their current pressure, live needs, who
 * they know, and the diaries. Assembled per request — this is a human clicking,
 * not the tick loop, so a few joins are affordable here.
 */
async function agentDetail(id: string): Promise<unknown | null> {
  const a = state.agents.find((x) => x.id === id)
  if (a == null) return null

  const effective = resolveValues(a.values, NOW)
  const known = state.agents
    .filter((o) => o.id !== a.id)
    .map((o) => {
      const rel = state.relationships.get(pairKey(a.id, o.id))
      if (rel == null || rel.encounters === 0) return null
      return {
        id: o.id,
        name: o.name,
        affection: round2(rel.affection),
        trust: round2(rel.trust),
        // Debt is signed relative to the pair key, whose first member is the
        // lexicographically smaller id. Flip it when this agent is the second
        // one, or the card shows the creditor as the debtor. Compare the ids
        // the same way pairKey does — matching on the key string would break
        // the day one id is a prefix of another.
        debt: round2(a.id < o.id ? rel.debt : -rel.debt),
        grievance: round2(rel.grievance),
        encounters: rel.encounters,
      }
    })
    .filter((x) => x != null)
    .sort((x, y) => weight(y) - weight(x))

  return {
    id: a.id,
    name: a.name,
    occupation: occupationDef(a.occupation).label,
    money: Math.round(a.money),
    location: placeOf(a.location),
    activity: a.activity?.kind ?? 'idle',
    job: a.job == null ? null : {
      employer: placeOf(a.job.employerId),
      wage: a.job.wage,
      shift: `${a.job.shiftStart}:00–${a.job.shiftEnd}:00`,
    },
    housing: a.housing,
    needs: a.needs,
    goals: a.goals,
    constraints: a.constraints,
    values: VALUE_AXES.map((axis) => ({
      axis,
      base: round2(a.values.base[axis]),
      drift: round2(a.values.drift[axis]),
      effective: round2(effective[axis]),
    })),
    vices: a.vices.map((v) => ({
      kind: v.kind,
      label: viceDef(v.kind).label,
      urge: round2(v.urge),
    })),
    relationships: known,
    diaries: (await history?.recentDiaries(a.id, 7)) ?? [],
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const weight = (r: { affection: number; grievance: number; debt: number }): number =>
  Math.abs(r.affection) + r.grievance + Math.abs(r.debt) / 100

const http = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/agent') {
    const id = url.searchParams.get('id') ?? ''
    void agentDetail(id).then((detail) => {
      if (detail == null) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(detail))
    })
    return
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'alive', tick: state.tick, time: worldTime(state.tick).toISOString() }))
    return
  }
  if (req.url === '/world') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      // The grid and street period travel together because the viewer rebuilds
      // the street map from the same rule the generator used, rather than the
      // server shipping a tilemap the two could then disagree about.
      city: {
        name: DEFAULT_CITY.name,
        grid: city.layout.grid,
        streetPeriod: city.layout.streetPeriod,
        districts: DEFAULT_CITY.districts,
        // Roles travel rather than being re-derived: which block is the plaza
        // is a layout decision, and duplicating that decision in the viewer is
        // how the two quietly stop agreeing.
        blocks: city.layout.blocks.map((b) => ({ bx: b.bx, by: b.by, role: b.role })),
      },
      locations: allLocs.map((l) => ({
        id: l.id, kind: l.kind, name: l.name, district: l.district,
        x: l.tile.x, y: l.tile.y,
      })),
      agents: state.agents.map((a) => ({ id: a.id, name: a.name, occupation: occupationDef(a.occupation).label })),
    }))
    return
  }
  if (req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ state: snapshot(), feed: feed.slice(-60) }))
    return
  }
  res.writeHead(404); res.end()
})

const wss = new WebSocketServer({ server: http, path: '/live' })
wss.on('connection', (ws) => {
  clients.add(ws)
  // Send the world and the backlog so a client that joins mid-run is not blank.
  ws.send(JSON.stringify({ type: 'hello', feed: feed.slice(-60) }))
  ws.send(JSON.stringify(snapshot()))
  ws.on('close', () => clients.delete(ws))
})

http.listen(PORT, () => {
  console.log(`aw-engine on :${PORT} — tick every ${TICK_MS}ms, ${USE_LLM ? 'cognition on' : 'cognition off'}`)
  console.log(`scene patience ${SCENE_PATIENCE} ticks (${SCENE_TIMEOUT_MS / 1000}s real)`)
  console.log(`world time ${worldTime(state.tick).toISOString()}`)
})

const timer = setInterval(() => void step(), TICK_MS)

async function shutdown(): Promise<void> {
  clearInterval(timer)
  worker.stop()
  if (worldRepo != null) await worldRepo.save(state, SEED, DEFAULT_CITY)
  await pool?.end()
  console.log(`\nstopped at tick ${state.tick}`)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
