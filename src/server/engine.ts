/**
 * The world server. Long-running and self-driving: it ticks on a real-time
 * cadence, persists as it goes, resolves cognition beside the loop, and
 * broadcasts state so a viewer can watch it live.
 *
 * This is the process that makes agentic-world a world rather than a script.
 * It owns the clock and the wiring only — the world itself lives in
 * `world/context.ts`, the routes in `http/`, and the cognition in `jobs/`.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { tick } from '../engine/tick.js'
import { TICKS_PER_DAY, TICKS_PER_HOUR, worldTime } from '../engine/clock.js'
import { makeRng } from '../world/rng.js'
import { DproxyProvider } from '../cognition/provider.js'
import { bootWorld } from './world/context.js'
import { LiveFeed } from './world/feed.js'
import { CognitionWorker, MAX_CONCURRENT, type Job } from './jobs/worker.js'
import { handleJob } from './jobs/handlers.js'
import { createRequestHandler } from './http/routes.js'

const SEED = Number(process.env.SEED ?? 42)
/** Real milliseconds per tick. The dial between "watchable" and "real time". */
const TICK_MS = Number(process.env.TICK_MS ?? 2000)
const PORT = Number(process.env.PORT ?? 7070)
const USE_LLM = process.env.LLM !== '0'
const PERSIST = process.env.PERSIST !== '0'
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ''
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6479'

/** Reference instant for guidance decay. Fixed, so decay stays reproducible. */
const NOW = Date.parse('2026-08-19T00:00:00Z')

/**
 * Save every world hour, not only at the day rollover. A daily save leaves the
 * database a whole game day behind what is running — a crash loses that day,
 * and anything reading the database shows a world that no longer exists.
 */
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

const rng = makeRng(SEED)

const world = await bootWorld({
  seed: SEED,
  persist: PERSIST,
  provider,
  now: NOW,
  cityTemplate: process.env.CITY_TEMPLATE ?? null,
  fresh: process.env.FRESH === '1',
})

const feed: LiveFeed = new LiveFeed(world, () => ({
  pending: worker.pending,
  done: worker.completed,
  dropped: worker.dropped,
  spentUsd: worker.spent,
  inputTokens: worker.inputTokens,
  outputTokens: worker.outputTokens,
  breakdown: worker.breakdown,
}))

const worker: CognitionWorker = new CognitionWorker(
  REDIS_URL,
  (job) => handleJob(job, { world, feed, submit }),
  { concurrency: Number(process.env.COGNITION_CONCURRENCY ?? MAX_CONCURRENT) },
)

async function submit(job: Job): Promise<void> {
  await worker.submit(job)
}

// Recovery: BullMQ persists jobs in Redis, so stranded jobs from a previous run
// are picked up automatically. Diary backfill still needs Postgres.
{
  const recovered = await worker.init()
  if (recovered > 0) console.log(`${recovered} job(s) pending in Redis from a previous run`)

  if (world.history != null) {
    const today = Math.floor(world.state.tick / TICKS_PER_DAY) + 1
    const missing = await world.history.daysMissingDiary(
      world.state.agents.map((a) => a.id),
      today,
    )
    for (const m of missing) {
      await submit({ kind: 'reflection', agent: m.agent, tick: m.day * TICKS_PER_DAY })
    }
    if (missing.length > 0) console.log(`backfilling ${missing.length} missing diary/diaries`)
  }
}

// ---- the loop --------------------------------------------------------------

/**
 * Reflections are staggered across the first game hour rather than all being
 * submitted at the midnight tick, which would spike the queue once a day.
 */
const staggeredReflections: { agent: string; tick: number }[] = []

let ticking = false

async function step(): Promise<void> {
  if (ticking) return // a slow save must not overlap the next tick
  ticking = true
  try {
    const r = tick(world.state, { now: NOW, random: rng, scenePatienceTicks: SCENE_PATIENCE })
    world.state = r.state

    for (const e of r.events) feed.describe(e)
    await world.history?.recordEvents(r.events)

    if (USE_LLM) {
      queueCognition(r)
      // Reactive deliberation: being robbed makes you rethink your life
      for (const e of r.events) {
        if (e.type !== 'theft') continue
        const victim = world.state.agents.find((x) => x.id === e.victim)
        if (victim != null && world.state.tick - victim.lastDeliberationTick > TICKS_PER_HOUR * 2) {
          void submit({ kind: 'deliberation', agent: e.victim, tick: world.state.tick })
        }
      }
    }

    if (world.state.tick % SAVE_EVERY_TICKS === 0) await world.save()
    feed.broadcast(feed.snapshot())
  } catch (err) {
    console.error('tick failed:', err)
  } finally {
    ticking = false
  }
}

/** Hand the tick's cognition jobs to the queue. Never awaited by the clock. */
function queueCognition(r: ReturnType<typeof tick>): void {
  for (const s of r.sceneJobs) {
    void submit({ kind: 'scene', a: s.a, b: s.b, tension: s.score, tick: world.state.tick })
  }

  for (const id of r.reflectionJobs) staggeredReflections.push({ agent: id, tick: world.state.tick })
  if (staggeredReflections.length > 0) {
    const batch = staggeredReflections.splice(0, Math.ceil(staggeredReflections.length / TICKS_PER_HOUR))
    for (const job of batch) void submit({ kind: 'reflection', agent: job.agent, tick: job.tick })
  }

  for (const id of r.deliberationJobs) {
    void submit({ kind: 'deliberation', agent: id, tick: world.state.tick })
  }
  for (const c of r.crisisJobs) {
    void submit({
      kind: 'crisis',
      agent: c.agent,
      crisisKind: c.kind,
      context: c.context,
      tick: world.state.tick,
    })
  }
}

// ---- http + ws -------------------------------------------------------------

const http = createServer(createRequestHandler({ world, feed, adminSecret: ADMIN_SECRET }))
new WebSocketServer({ server: http, path: '/live' }).on('connection', (ws) => feed.attach(ws))

http.listen(PORT, () => {
  console.log(
    `aw-engine on :${PORT} — tick every ${TICK_MS}ms, ${USE_LLM ? 'cognition on' : 'cognition off'}`,
  )
  console.log(`scene patience ${SCENE_PATIENCE} ticks (${SCENE_TIMEOUT_MS / 1000}s real)`)
  console.log(`world time ${worldTime(world.state.tick).toISOString()}`)
})

const timer = setInterval(() => void step(), TICK_MS)

async function shutdown(): Promise<void> {
  clearInterval(timer)
  await worker.stop()
  await world.save()
  await world.pool?.end()
  console.log(`\nstopped at tick ${world.state.tick}`)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

/**
 * A world that runs for weeks will eventually drop a promise somewhere — a
 * dbrain call, a queue write. Node's default is to print and exit, which would
 * take down a healthy simulation over one lost memory write.
 *
 * So log and keep ticking: cognition degrades, the world does not stop. That is
 * the same trade the queue makes. An uncaught *exception* is different — the
 * process is in an unknown state after one, so it is left to exit and let
 * Docker's restart policy bring back a clean one, resuming from the last save.
 */
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection (continuing):', reason)
})
