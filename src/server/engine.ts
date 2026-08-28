/**
 * The world server. Long-running, self-driving: it ticks on a real-time
 * cadence, persists as it goes, resolves cognition beside the loop, and
 * broadcasts state so a viewer can watch it live.
 *
 * This is the process that makes agentic-world a world rather than a script.
 */
import { createServer, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { tick, pairKey, type WorldState, type WorldEvent } from '../engine/tick.js'
import { applySceneOutcome, abandonScene } from '../engine/apply-scene.js'
import { applyReflection } from '../engine/apply-reflection.js'
import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOfDay, worldTime } from '../engine/clock.js'
import { generateCity, cityFromTemplate } from '../world/generator.js'
import { DEFAULT_CITY, loadTemplate } from '../world/config.js'
import { createAgent, type CreateAgentInput } from '../agents/create.js'
import { makeRng, pick } from '../world/rng.js'
import { occupationDef, OCCUPATIONS } from '../world/occupations.js'
import { resolveValues, VALUE_AXES, type ValueAxis } from '../agents/values.js'
import { viceDef, VICE_CATALOG, type ViceKind } from '../agents/vices.js'
import { buildFoundingIdentity } from '../agents/identity.js'
import { DproxyProvider } from '../cognition/provider.js'
import { resolveScene, persistScene, type ThirdParty } from '../cognition/scene.js'
import { reflect, persistReflection } from '../cognition/reflection.js'
import { deliberate } from '../cognition/deliberation.js'
import { resolveCrisis } from '../cognition/crisis.js'
import { applyDeliberation } from '../engine/apply-deliberation.js'
import { DbrainStore } from '../memory/dbrain-store.js'
import { InMemoryStore } from '../memory/in-memory-store.js'
import type { MemoryStore } from '../memory/store.js'
import { makePool, migrate } from '../persistence/db.js'
import { WorldRepository } from '../persistence/world-repo.js'
import { HistoryRepository } from '../persistence/history-repo.js'
import { OwnerRepository } from '../persistence/owner-repo.js'
import { CognitionWorker, MAX_CONCURRENT, type Job, type CallResult } from './cognition-worker.js'
import { logLlmCall } from './llm-logger.js'
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
  models: {
    scene: process.env.SCENE_MODEL,
    reflection: process.env.REFLECTION_MODEL,
    deliberation: process.env.DELIBERATION_MODEL,
    crisis: process.env.CRISIS_MODEL,
  },
})

const pool = PERSIST ? makePool() : null
const worldRepo = pool == null ? null : new WorldRepository(pool)
const history = pool == null ? null : new HistoryRepository(pool)
const owners = pool == null ? null : new OwnerRepository(pool)
const store: MemoryStore = PERSIST
  ? new DbrainStore({
      url: process.env.DBRAIN_URL ?? 'http://dbrain:7878',
      token: process.env.DBRAIN_TOKEN ?? '',
    })
  : new InMemoryStore()

// ---- world -----------------------------------------------------------------

const rng = makeRng(SEED)
const template = process.env.CITY_TEMPLATE ? loadTemplate(process.env.CITY_TEMPLATE) : null
const city = template ? cityFromTemplate(template) : generateCity(DEFAULT_CITY, SEED)

let allLocs: readonly Location[] = [...city.locations]
const byId = new Map(allLocs.map((l) => [l.id, l]))

let state: WorldState = {
  tick: 0, agents: [], locations: allLocs, relationships: new Map(),
  scenesTodayByAgent: new Map(), scenesTodayByPair: new Map(),
  passingTodayByPair: new Map(), notableToday: new Set(), openings: city.openings,
}

if (pool != null) {
  const applied = await migrate(pool)
  if (applied.length > 0) console.log(`migrations: ${applied.join(', ')}`)
}
if (store instanceof DbrainStore) for (const a of state.agents) await store.ensureAgent(a.id, a.name)
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

    // Tell the home allocator which tiles are already taken so the next
    // create_agent call gets a fresh plot instead of a collision.
    const homeTiles = new Set(
      state.locations.filter((l) => l.kind === 'home').map((l) => `${l.tile.x},${l.tile.y}`),
    )
    city.markOccupied(homeTiles)

    // Fix any homes that ended up on the same tile (a previous bug assigned
    // the same plot twice when the server restarted between creations).
    const seen = new Map<string, Location>()
    for (const loc of state.locations) {
      if (loc.kind !== 'home') continue
      const key = `${loc.tile.x},${loc.tile.y}`
      if (seen.has(key)) {
        const fresh = city.allocateHome()
        console.log(`collision: ${loc.id} was at (${loc.tile.x},${loc.tile.y}), moved to (${fresh.tile.x},${fresh.tile.y})`)
        loc.tile = fresh.tile
        loc.district = fresh.district
      }
      seen.set(`${loc.tile.x},${loc.tile.y}`, loc)
    }

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
    cognition: { pending: worker.pending, done: worker.completed, dropped: worker.dropped,
      spentUsd: worker.spent, inputTokens: worker.inputTokens, outputTokens: worker.outputTokens,
      breakdown: worker.breakdown },
  }
}

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(text)
}

// ---- cognition, running beside the loop ------------------------------------

const ZERO_RESULT: CallResult = { costUsd: 0, inputTokens: 0, outputTokens: 0 }

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6479'

const worker = new CognitionWorker(REDIS_URL, async (job: Job): Promise<CallResult> => {
  if (job.kind === 'scene') {
    const a = state.agents.find((x) => x.id === job.a)
    const b = state.agents.find((x) => x.id === job.b)
    if (a == null || b == null) return ZERO_RESULT
    const rel = state.relationships.get(pairKey(a.id, b.id)) ?? {
      affection: 0, trust: 0, debt: 0, grievance: 0, encounters: 0, lastInteractionTick: null,
    }
    try {
      const GOSSIP_MIN_ENCOUNTERS = 5
      const knownInCommon: ThirdParty[] = state.agents
        .filter((c) => c.id !== a.id && c.id !== b.id)
        .flatMap((c) => {
          const relAC = state.relationships.get(pairKey(a.id, c.id))
          const relBC = state.relationships.get(pairKey(b.id, c.id))
          if (relAC == null || relBC == null) return []
          if (relAC.encounters < GOSSIP_MIN_ENCOUNTERS || relBC.encounters < GOSSIP_MIN_ENCOUNTERS) return []
          return [{ id: c.id, name: c.name, fromA: relAC, fromB: relBC }]
        })
      const res = await resolveScene(
        { a, b, rel, aboutB: await store.recall(a.id, b.id), aboutA: await store.recall(b.id, a.id),
          place: placeOf(a.location), hour: hourOfDay(job.tick), now: NOW, knownInCommon },
        provider,
      )
      await persistScene(store, a, b, res.outcome, job.tick)
      state = applySceneOutcome(state, a.id, b.id, res.outcome)
      await history?.recordScene({ tick: job.tick, a: a.id, b: b.id, location: a.location,
        tension: job.tension, outcome: res.outcome, costUsd: res.costUsd })
      const callBase = { tick: job.tick, purpose: 'scene', provider: provider.name,
        model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        costUsd: res.costUsd / 2, durationMs: res.durationMs }
      await history?.recordCall({ ...callBase, agentId: a.id })
      await history?.recordCall({ ...callBase, agentId: b.id })
      void logLlmCall({ agent: `${a.name} × ${b.name}`, purpose: 'scene', model: res.model,
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
        prompt: res.prompt, response: res.rawResponse })
      // Reactive deliberation: an intense scene makes the participants rethink.
      const intensity = job.tension + Math.abs(res.outcome.transfer) / 50
        + Math.abs(res.outcome.deltas.aToB.trust) + Math.abs(res.outcome.deltas.bToA.trust)
      if (intensity > 4) {
        for (const who of [a, b]) {
          const since = state.tick - who.lastDeliberationTick
          if (since > TICKS_PER_HOUR * 2) {
            void submit({ kind: 'deliberation', agent: who.id, tick: state.tick })
          }
        }
      }
      const gossipCount = res.outcome.gossipA.length + res.outcome.gossipB.length
      publish('scene', `${a.name} × ${b.name} · ${placeOf(a.location)}`, {
        a: a.id, b: b.id,
        dialogue: res.outcome.dialogue, outcome: res.outcome.outcome,
        transfer: res.outcome.transfer === 0 ? null : {
          amount: Math.abs(res.outcome.transfer),
          from: res.outcome.transfer > 0 ? a.name : b.name,
          to: res.outcome.transfer > 0 ? b.name : a.name,
        },
        ...(gossipCount > 0 ? {
          gossip: [
            ...res.outcome.gossipA.map((g) => ({ from: a.name, about: nameOf(g.about), text: g.text })),
            ...res.outcome.gossipB.map((g) => ({ from: b.name, about: nameOf(g.about), text: g.text })),
          ],
        } : {}),
      })
      return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
    } catch (err) {
      state = abandonScene(state, a.id, b.id)
      publish('error', `scene ${a.name} × ${b.name} failed: ${String(err).slice(0, 60)}`)
      return ZERO_RESULT
    }
  }

  if (job.kind === 'deliberation') {
    const a = state.agents.find((x) => x.id === job.agent)
    if (a == null) return ZERO_RESULT
    const known = [...state.relationships.entries()]
      .filter(([k]) => k.split(':').includes(a.id))
      .map(([k, rel]) => {
        const other = k.split(':').find((x) => x !== a.id) ?? ''
        return { id: other, name: nameOf(other), rel }
      })
      .filter((x) => x.id !== '')
    try {
      const validIds = new Set(state.agents.map((x) => x.id))
      const res = await deliberate(
        { agent: a, values: resolveValues(a.values, NOW), hour: hourOfDay(job.tick),
          recentMemories: await store.since(a.id, job.tick - Math.floor(TICKS_PER_DAY / 2)),
          relationships: known,
          allAgentNames: state.agents.map((x) => ({ id: x.id, name: x.name })) },
        provider,
        validIds,
      )
      if (res.outcome.thought !== '') {
        await store.remember({ agentId: a.id, kind: 'episodic',
          text: `[deliberation] ${res.outcome.thought}`, tick: job.tick })
      }
      state = applyDeliberation(state, a.id, res.outcome, job.tick)
      await history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'deliberation',
        provider: provider.name, model: res.model, inputTokens: res.inputTokens,
        outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
      void logLlmCall({ agent: a.name, purpose: 'deliberation', model: res.model,
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
        prompt: res.prompt, response: res.rawResponse })
      publish('deliberation', `${a.name} — thinking`, {
        biases: res.outcome.biases,
        seekScene: res.outcome.seekScene.map((s) => ({ target: nameOf(s.target), reason: s.reason })),
        seed: res.outcome.conversationSeed,
      })
      return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
    } catch (err) {
      publish('error', `deliberation ${a.name} failed: ${String(err).slice(0, 60)}`)
      return ZERO_RESULT
    }
  }

  if (job.kind === 'crisis') {
    const a = state.agents.find((x) => x.id === job.agent)
    if (a == null) return ZERO_RESULT
    try {
      const res = await resolveCrisis(
        { agent: a, values: resolveValues(a.values, NOW), kind: job.crisisKind as 'vice_temptation', context: job.context },
        provider,
      )
      if (res.thought !== '') {
        await store.remember({ agentId: a.id, kind: 'episodic',
          text: `[crisis] ${res.thought}`, tick: job.tick })
      }
      await history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'crisis',
        provider: provider.name, model: res.model, inputTokens: res.inputTokens,
        outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
      void logLlmCall({ agent: a.name, purpose: 'crisis', model: res.model,
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
        prompt: res.prompt, response: res.rawResponse })
      publish('crisis', `${a.name} — inner voice (${job.crisisKind.replace('_', ' ')})`, {
        thought: res.thought, crisisKind: job.crisisKind,
      })
      return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
    } catch (err) {
      publish('error', `crisis ${a.name} failed: ${String(err).slice(0, 60)}`)
      return ZERO_RESULT
    }
  }

  const a = state.agents.find((x) => x.id === job.agent)
  if (a == null) return ZERO_RESULT
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
    await history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'reflection',
      provider: provider.name, model: res.model, inputTokens: res.inputTokens,
      outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
    void logLlmCall({ agent: a.name, purpose: 'reflection', model: res.model,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
      prompt: res.prompt, response: res.rawResponse })
    publish('diary', `${a.name} — diary`, { text: res.outcome.diary, drift: res.outcome.drift })
    return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (err) {
    publish('error', `reflection ${a.name} failed: ${String(err).slice(0, 60)}`)
    return ZERO_RESULT
  }
}, {
  concurrency: Number(process.env.COGNITION_CONCURRENCY ?? MAX_CONCURRENT),
})

async function submit(job: Job): Promise<void> {
  await worker.submit(job)
}

// Recovery: BullMQ persists jobs in Redis — stranded jobs from a previous run
// are picked up automatically. Diary backfill still needs Postgres.
{
  const recovered = await worker.init()
  if (recovered > 0) console.log(`${recovered} job(s) pending in Redis from a previous run`)

  if (history != null) {
    const today = Math.floor(state.tick / TICKS_PER_DAY) + 1
    const missing = await history.daysMissingDiary(state.agents.map((a) => a.id), today)
    for (const m of missing) {
      await submit({ kind: 'reflection', agent: m.agent, tick: m.day * TICKS_PER_DAY })
    }
    if (missing.length > 0) console.log(`backfilling ${missing.length} missing diary/diaries`)
  }
}

// ---- the loop --------------------------------------------------------------

/** Stagger reflections across the first game hour instead of submitting all at
 *  midnight tick 0. Each tick drains one agent from this queue. */
const staggeredReflections: { agent: string; tick: number }[] = []

let ticking = false
async function step(): Promise<void> {
  if (ticking) return // a slow save must not overlap the next tick
  ticking = true
  try {
    const r = tick(state, { now: NOW, random: rng, scenePatienceTicks: SCENE_PATIENCE })
    state = r.state

    for (const e of r.events) describe(e)
    await history?.recordEvents(r.events)

    // Reactive deliberation: theft victims rethink their life.
    if (USE_LLM) {
      for (const e of r.events) {
        if (e.type === 'theft') {
          const victim = state.agents.find((x) => x.id === e.victim)
          if (victim != null && state.tick - victim.lastDeliberationTick > TICKS_PER_HOUR * 2) {
            void submit({ kind: 'deliberation', agent: e.victim, tick: state.tick })
          }
        }
      }
    }

    if (USE_LLM) {
      for (const s of r.sceneJobs) await submit({ kind: 'scene', a: s.a, b: s.b, tension: s.score, tick: state.tick })
      for (const id of r.reflectionJobs) staggeredReflections.push({ agent: id, tick: state.tick })
      if (staggeredReflections.length > 0) {
        const batch = staggeredReflections.splice(0, Math.ceil(staggeredReflections.length / TICKS_PER_HOUR))
        for (const r of batch) await submit({ kind: 'reflection', agent: r.agent, tick: r.tick })
      }
      for (const id of r.deliberationJobs) await submit({ kind: 'deliberation', agent: id, tick: state.tick })
      for (const c of r.crisisJobs) await submit({ kind: 'crisis', agent: c.agent, crisisKind: c.kind, context: c.context, tick: state.tick })
    }

    // Save every world hour, not only at the day rollover. A daily save leaves
    // the database a whole game day behind what is running — a crash loses that
    // day, and anything reading the database (pgweb, a future MCP briefing)
    // shows a world that no longer exists.
    if (worldRepo != null && state.tick % SAVE_EVERY_TICKS === 0) {
      await worldRepo.save(state, SEED, city.config)
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

// ---- agent creation (called from POST /agents) ------------------------------

async function addAgent(body: string, res: ServerResponse): Promise<void> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>

    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '') throw new Error('name is required')

    const ownerId = typeof raw.ownerId === 'string' ? raw.ownerId.trim() : ''
    if (ownerId === '') throw new Error('ownerId is required')

    if (typeof raw.occupation !== 'string' || !(raw.occupation in OCCUPATIONS))
      throw new Error(`occupation must be one of: ${Object.keys(OCCUPATIONS).join(', ')}`)

    if (!Array.isArray(raw.vices) || raw.vices.length !== 2 ||
        !raw.vices.every((v: unknown) => typeof v === 'string' && v in VICE_CATALOG))
      throw new Error(`vices must be exactly 2 from: ${Object.keys(VICE_CATALOG).join(', ')}`)

    const id = typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id.trim()
      : name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (state.agents.some((a) => a.id === id))
      throw new Error(`agent "${id}" already exists`)

    const base: Partial<Record<ValueAxis, number>> = {}
    if (raw.base != null && typeof raw.base === 'object') {
      for (const [k, v] of Object.entries(raw.base as Record<string, unknown>)) {
        if (!(VALUE_AXES as readonly string[]).includes(k))
          throw new Error(`unknown value axis: ${k}`)
        if (typeof v !== 'number' || v < -1 || v > 1)
          throw new Error(`${k} must be between -1 and 1`)
        base[k as ValueAxis] = v
      }
    }

    const input: CreateAgentInput = {
      id, name, ownerId,
      occupation: raw.occupation as CreateAgentInput['occupation'],
      base,
      vices: raw.vices as [ViceKind, ViceKind],
      interests: Array.isArray(raw.interests)
        ? raw.interests.filter((x): x is string => typeof x === 'string') : [],
      constraints: Array.isArray(raw.constraints)
        ? raw.constraints.filter((x): x is string => typeof x === 'string') : [],
      startingMoney: typeof raw.startingMoney === 'number' ? raw.startingMoney : undefined,
    }

    const created = createAgent(input, city)

    const newLocs = [...state.locations, created.home]
    byId.set(created.home.id, created.home)
    allLocs = newLocs
    state = { ...state, agents: [...state.agents, created.agent], locations: newLocs }

    let ownerToken: string | null = null
    if (owners != null && !(await owners.exists(ownerId))) {
      ownerToken = await owners.register(ownerId, name)
    }

    if (store instanceof DbrainStore) await store.ensureAgent(id, name)

    const a = created.agent
    for (const fact of buildFoundingIdentity(a)) {
      await store.remember({ agentId: a.id, kind: 'identity', text: fact, tick: state.tick })
    }

    if (worldRepo != null) await worldRepo.save(state, SEED, city.config)

    publish('arrival', `${created.agent.name} moved to town`)
    broadcast(snapshot())

    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: created.agent.id,
      name: created.agent.name,
      home: created.home.name,
      district: created.home.district,
      job: created.agent.job == null ? null : {
        employer: placeOf(created.agent.job.employerId),
        wage: created.agent.job.wage,
      },
      money: created.agent.money,
      ...(ownerToken != null ? { ownerToken } : {}),
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
  }
}

// ---- owner auth -------------------------------------------------------------

const GUIDANCE_HALF_LIFE_DAYS = 14

type AuthOk = { ok: true; agent: Agent }
type AuthFail = { ok: false; error: string; status: number }
type AuthResult = AuthOk | AuthFail

async function authenticateOwner(agentId: string, token: string): Promise<AuthResult> {
  if (owners == null) return { ok: false, error: 'persistence is disabled', status: 500 }
  const agent = state.agents.find((a) => a.id === agentId)
  if (agent == null) return { ok: false, error: `agent "${agentId}" not found`, status: 404 }
  const valid = await owners.validate(agent.ownerId, token)
  if (!valid) return { ok: false, error: 'invalid owner token', status: 403 }
  return { ok: true, agent }
}

// ---- owner loop endpoints ---------------------------------------------------

async function handleBriefing(agentId: string, token: string, res: ServerResponse): Promise<void> {
  const auth = await authenticateOwner(agentId, token)
  if (!auth.ok) { res.writeHead(auth.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: auth.error })); return }
  const a = auth.agent

  const effective = resolveValues(a.values, NOW)
  const known = state.agents
    .filter((o) => o.id !== a.id)
    .map((o) => {
      const rel = state.relationships.get(pairKey(a.id, o.id))
      if (rel == null || rel.encounters === 0) return null
      return { id: o.id, name: o.name, affection: round2(rel.affection), trust: round2(rel.trust),
        debt: round2(a.id < o.id ? rel.debt : -rel.debt), grievance: round2(rel.grievance) }
    })
    .filter((x) => x != null)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    id: a.id, name: a.name,
    occupation: occupationDef(a.occupation).label,
    day: Math.floor(state.tick / TICKS_PER_DAY) + 1,
    time: worldTime(state.tick).toISOString(),
    money: Math.round(a.money),
    housing: a.housing,
    needs: a.needs,
    job: a.job == null ? null : {
      employer: placeOf(a.job.employerId), wage: a.job.wage,
      shift: `${a.job.shiftStart}:00–${a.job.shiftEnd}:00`,
    },
    goals: a.goals,
    constraints: a.constraints,
    values: VALUE_AXES.map((axis) => ({
      axis, base: round2(a.values.base[axis]), drift: round2(a.values.drift[axis]),
      effective: round2(effective[axis]),
    })),
    vices: a.vices.map((v) => ({ kind: v.kind, label: viceDef(v.kind).label, urge: round2(v.urge) })),
    relationships: known,
    diaries: (await history?.recentDiaries(a.id, 3)) ?? [],
  }))
}

async function handleDilemmas(agentId: string, token: string, res: ServerResponse): Promise<void> {
  const auth = await authenticateOwner(agentId, token)
  if (!auth.ok) { res.writeHead(auth.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: auth.error })); return }
  const a = auth.agent

  type Dilemma = { kind: string; severity: number; summary: string; detail?: unknown }
  const dilemmas: Dilemma[] = []
  const effective = resolveValues(a.values, NOW)

  if (a.housing.arrears > 0) {
    dilemmas.push({ kind: 'arrears', severity: Math.min(1, a.housing.arrears / 200),
      summary: `${a.name} owes ${a.housing.arrears} in unpaid rent`, detail: { arrears: a.housing.arrears } })
  }
  if (a.money < a.housing.due * 2) {
    dilemmas.push({ kind: 'broke', severity: Math.min(1, 1 - a.money / (a.housing.due * 3)),
      summary: `${a.name} has only ${Math.round(a.money)} credits — less than 2 days of rent` })
  }
  if (a.job == null) {
    dilemmas.push({ kind: 'unemployed', severity: 0.8, summary: `${a.name} is unemployed` })
  }

  for (const v of a.vices) {
    if (v.urge > 0.6) {
      dilemmas.push({ kind: 'vice_pressure', severity: v.urge,
        summary: `${viceDef(v.kind).label} urge is building (${round2(v.urge)})`,
        detail: { vice: v.kind, urge: round2(v.urge) } })
    }
  }

  for (const o of state.agents) {
    if (o.id === a.id) continue
    const rel = state.relationships.get(pairKey(a.id, o.id))
    if (rel == null) continue
    if (rel.grievance > 0.4) {
      dilemmas.push({ kind: 'grievance', severity: rel.grievance,
        summary: `Bad blood with ${o.name} (grievance ${round2(rel.grievance)})`,
        detail: { other: o.id, otherName: o.name, grievance: round2(rel.grievance) } })
    }
    const debt = a.id < o.id ? rel.debt : -rel.debt
    if (debt > 50) {
      dilemmas.push({ kind: 'debt_owed', severity: Math.min(1, debt / 200),
        summary: `${a.name} owes ${round2(debt)} credits to ${o.name}`,
        detail: { creditor: o.id, creditorName: o.name, amount: round2(debt) } })
    }
  }

  // Value tension: effective vs base diverged significantly
  for (const axis of VALUE_AXES) {
    const gap = effective[axis] - a.values.base[axis]
    if (Math.abs(gap) > 0.4) {
      dilemmas.push({ kind: 'value_drift', severity: Math.abs(gap),
        summary: `${axis} has drifted ${gap > 0 ? '+' : ''}${round2(gap)} from the base personality`,
        detail: { axis, base: round2(a.values.base[axis]), effective: round2(effective[axis]) } })
    }
  }

  dilemmas.sort((x, y) => y.severity - x.severity)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ agentId: a.id, agentName: a.name, dilemmas }))
}

async function handleGuidance(body: string, res: ServerResponse): Promise<void> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>
    const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : ''
    const token = typeof raw.ownerToken === 'string' ? raw.ownerToken.trim() : ''
    if (agentId === '' || token === '') throw new Error('agentId and ownerToken are required')

    const auth = await authenticateOwner(agentId, token)
    if (!auth.ok) { res.writeHead(auth.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: auth.error })); return }
    const a = auth.agent

    const applied: string[] = []

    if (raw.valueDeltas != null && typeof raw.valueDeltas === 'object') {
      for (const [k, v] of Object.entries(raw.valueDeltas as Record<string, unknown>)) {
        if (!(VALUE_AXES as readonly string[]).includes(k)) throw new Error(`unknown value axis: ${k}`)
        if (typeof v !== 'number' || v < -1 || v > 1) throw new Error(`${k} delta must be between -1 and 1`)
        a.values.guidance[k as ValueAxis] = { delta: v, setAt: NOW, halfLifeDays: GUIDANCE_HALF_LIFE_DAYS }
        applied.push(`guidance.${k} = ${v > 0 ? '+' : ''}${v}`)
      }
    }

    if (Array.isArray(raw.constraints)) {
      const incoming = raw.constraints.filter((x): x is string => typeof x === 'string')
      for (const c of incoming) {
        if (!a.constraints.includes(c)) {
          a.constraints.push(c)
          applied.push(`+constraint "${c}"`)
        }
      }
    }

    if (Array.isArray(raw.removeConstraints)) {
      for (const c of raw.removeConstraints.filter((x): x is string => typeof x === 'string')) {
        const idx = a.constraints.indexOf(c)
        if (idx >= 0) { a.constraints.splice(idx, 1); applied.push(`-constraint "${c}"`) }
      }
    }

    if (typeof raw.note === 'string' && raw.note.trim() !== '') {
      applied.push('identity note saved')
    }

    if (applied.length > 0) {
      const parts: string[] = []
      const deltas = Object.entries(a.values.guidance)
        .filter(([, g]) => g.setAt === NOW)
        .map(([axis, g]) => `${axis} ${g.delta > 0 ? '+' : ''}${g.delta}`)
      if (deltas.length > 0) parts.push(`My owner nudged my personality: ${deltas.join(', ')}.`)
      const added = applied.filter((s) => s.startsWith('+constraint'))
      const removed = applied.filter((s) => s.startsWith('-constraint'))
      if (added.length > 0) parts.push(`New rules from my owner: ${added.map((s) => s.slice(13, -1)).join(', ')}.`)
      if (removed.length > 0) parts.push(`My owner lifted restrictions: ${removed.map((s) => s.slice(13, -1)).join(', ')}.`)
      if (typeof raw.note === 'string' && raw.note.trim() !== '') parts.push(`My owner told me: "${raw.note.trim()}"`)
      if (parts.length > 0) {
        await store.remember({ agentId: a.id, kind: 'identity', text: parts.join(' '), tick: state.tick })
      }
    }

    if (worldRepo != null) await worldRepo.save(state, SEED, city.config)

    publish('guidance', `${a.name} received owner guidance: ${applied.join(', ') || 'no changes'}`)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, applied }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
  }
}

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ''

async function handleRegisterOwner(body: string, res: ServerResponse): Promise<void> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>

    if (ADMIN_SECRET === '') throw new Error('ADMIN_SECRET not configured on the server')
    const secret = typeof raw.adminSecret === 'string' ? raw.adminSecret : ''
    if (secret !== ADMIN_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid admin secret' }))
      return
    }

    const id = typeof raw.ownerId === 'string' ? raw.ownerId.trim() : ''
    if (id === '') throw new Error('ownerId is required')
    if (owners == null) throw new Error('persistence is disabled')

    const token = await owners.register(id, typeof raw.name === 'string' ? raw.name : undefined)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ownerId: id, ownerToken: token }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
  }
}

const http = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/register_owner') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c })
    req.on('end', () => void handleRegisterOwner(body, res))
    return
  }

  if (req.method === 'POST' && url.pathname === '/agents') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c })
    req.on('end', () => void addAgent(body, res))
    return
  }

  if (req.method === 'POST' && url.pathname === '/guidance') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c })
    req.on('end', () => void handleGuidance(body, res))
    return
  }

  if (url.pathname === '/briefing') {
    const id = url.searchParams.get('id') ?? ''
    const token = url.searchParams.get('token') ?? ''
    void handleBriefing(id, token, res)
    return
  }

  if (url.pathname === '/dilemmas') {
    const id = url.searchParams.get('id') ?? ''
    const token = url.searchParams.get('token') ?? ''
    void handleDilemmas(id, token, res)
    return
  }

  if (url.pathname === '/agent') {
    const id = url.searchParams.get('id') ?? ''
    void agentDetail(id).then((detail) => {
      if (detail == null) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(detail))
    })
    return
  }

  if (req.url === '/metering') {
    if (history == null) { res.writeHead(503); res.end(); return }
    void history.meteringSummary().then((data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
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
        name: city.config.name,
        grid: city.layout.grid,
        streetPeriod: city.layout.streetPeriod,
        districts: city.config.districts,
        // Roles travel rather than being re-derived: which block is the plaza
        // is a layout decision, and duplicating that decision in the viewer is
        // how the two quietly stop agreeing.
        blocks: city.layout.blocks.map((b) => ({ bx: b.bx, by: b.by, role: b.role })),
        water: city.water,
      },
      locations: allLocs.map((l) => ({
        id: l.id, kind: l.kind, name: l.name, district: l.district,
        x: l.tile.x, y: l.tile.y,
      })),
      agents: state.agents.map((a) => ({ id: a.id, name: a.name, occupation: occupationDef(a.occupation).label })),
    }))
    return
  }
  if (req.url === '/rel-graph') {
    const nodes = state.agents.map((a) => ({ id: a.id, name: a.name }))
    const edges: { source: string; target: string; affection: number; trust: number; grievance: number; encounters: number }[] = []
    for (const [key, rel] of state.relationships) {
      if (rel.encounters === 0) continue
      const parts = key.split(':')
      edges.push({
        source: parts[0]!, target: parts[1]!,
        affection: round2(rel.affection), trust: round2(rel.trust),
        grievance: round2(rel.grievance), encounters: rel.encounters,
      })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ nodes, edges }))
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
  await worker.stop()
  if (worldRepo != null) await worldRepo.save(state, SEED, city.config)
  await pool?.end()
  console.log(`\nstopped at tick ${state.tick}`)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
