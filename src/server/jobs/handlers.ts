/**
 * What happens when a queued cognition job comes back.
 *
 * Each handler follows the same shape: rebuild the prompt context from current
 * world state, call the route, fold the result into `world.state` with a pure
 * reducer, record it, and publish a feed line. A failure never propagates — a
 * dropped scene degrades richness, and the world keeps ticking on layer 1.
 */
import { pairKey } from '../../engine/tick.js'
import { applySceneOutcome, abandonScene } from '../../engine/apply/scene.js'
import { applyReflection } from '../../engine/apply/reflection.js'
import { applyDeliberation } from '../../engine/apply/deliberation.js'
import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOfDay } from '../../engine/clock.js'
import { resolveValues } from '../../agents/values.js'
import { resolveScene, persistScene, type ThirdParty } from '../../cognition/scene.js'
import { reflect, persistReflection } from '../../cognition/reflection.js'
import { deliberate } from '../../cognition/deliberation.js'
import { resolveCrisis } from '../../cognition/crisis.js'
import { logLlmCall } from './llm-logger.js'
import type { Job, CallResult } from './worker.js'
import type { World } from '../world/context.js'
import type { LiveFeed } from '../world/feed.js'
import type { Agent, Relationship } from '../../agents/agent.js'

/** A job that costs nothing: the agent is gone, or the call failed. */
const ZERO: CallResult = { costUsd: 0, inputTokens: 0, outputTokens: 0 }

/**
 * Two agents only gossip about someone they both actually know. Below this many
 * encounters a "relationship" is one chance meeting, and second-hand claims
 * built on it read as invented rather than overheard.
 */
const GOSSIP_MIN_ENCOUNTERS = 5

/**
 * How intense a scene must be to make its participants rethink. Sums tension,
 * money moved and both trust swings — see `deliberate` for what it produces.
 */
const REACTIVE_DELIBERATION_THRESHOLD = 4

/** Minimum gap between two deliberations for the same agent. */
const DELIBERATION_COOLDOWN_TICKS = TICKS_PER_HOUR * 2

export type JobDeps = {
  world: World
  feed: LiveFeed
  /** Queue another job — used for reactive deliberation. */
  submit: (job: Job) => Promise<void>
}

/** Routes a job to its handler. This is the callback the worker runs. */
export async function handleJob(job: Job, deps: JobDeps): Promise<CallResult> {
  switch (job.kind) {
    case 'scene': return handleScene(job, deps)
    case 'deliberation': return handleDeliberation(job, deps)
    case 'crisis': return handleCrisis(job, deps)
    case 'reflection': return handleReflection(job, deps)
  }
}

/** Every relationship this agent has, paired with the other party's name. */
function knownTo(world: World, id: string): { id: string; name: string; rel: Relationship }[] {
  return [...world.state.relationships.entries()]
    .filter(([k]) => k.split(':').includes(id))
    .map(([k, rel]) => {
      const other = k.split(':').find((x) => x !== id) ?? ''
      return { id: other, name: world.nameOf(other), rel }
    })
    .filter((x) => x.id !== '')
}

/** People both participants know well enough to have opinions worth trading. */
function gossipSubjects(world: World, a: Agent, b: Agent): ThirdParty[] {
  return world.state.agents
    .filter((c) => c.id !== a.id && c.id !== b.id)
    .flatMap((c) => {
      const relAC = world.state.relationships.get(pairKey(a.id, c.id))
      const relBC = world.state.relationships.get(pairKey(b.id, c.id))
      if (relAC == null || relBC == null) return []
      if (relAC.encounters < GOSSIP_MIN_ENCOUNTERS || relBC.encounters < GOSSIP_MIN_ENCOUNTERS) return []
      return [{ id: c.id, name: c.name, fromA: relAC, fromB: relBC }]
    })
}

async function handleScene(
  job: Extract<Job, { kind: 'scene' }>,
  { world, feed, submit }: JobDeps,
): Promise<CallResult> {
  const a = world.state.agents.find((x) => x.id === job.a)
  const b = world.state.agents.find((x) => x.id === job.b)
  if (a == null || b == null) return ZERO

  const rel = world.state.relationships.get(pairKey(a.id, b.id)) ?? {
    affection: 0, trust: 0, debt: 0, grievance: 0, encounters: 0, lastInteractionTick: null,
  }

  try {
    const res = await resolveScene({
      a, b, rel,
      aboutB: await world.store.recall(a.id, b.id),
      aboutA: await world.store.recall(b.id, a.id),
      place: world.placeOf(a.location),
      hour: hourOfDay(job.tick),
      now: world.now,
      knownInCommon: gossipSubjects(world, a, b),
    }, world.provider)

    await persistScene(world.store, a, b, res.outcome, job.tick)
    world.state = applySceneOutcome(world.state, a.id, b.id, res.outcome)

    await world.history?.recordScene({ tick: job.tick, a: a.id, b: b.id, location: a.location,
      tension: job.tension, outcome: res.outcome, costUsd: res.costUsd })

    // A scene is attributed to both participants, so each carries half the cost
    const callBase = { tick: job.tick, purpose: 'scene', provider: world.provider.name,
      model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd / 2, durationMs: res.durationMs }
    await world.history?.recordCall({ ...callBase, agentId: a.id })
    await world.history?.recordCall({ ...callBase, agentId: b.id })
    void logLlmCall({ agent: `${a.name} × ${b.name}`, purpose: 'scene', model: res.model,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
      prompt: res.prompt, response: res.rawResponse })

    const intensity = job.tension + Math.abs(res.outcome.transfer) / 50
      + Math.abs(res.outcome.deltas.aToB.trust) + Math.abs(res.outcome.deltas.bToA.trust)
    if (intensity > REACTIVE_DELIBERATION_THRESHOLD) {
      for (const who of [a, b]) {
        if (world.state.tick - who.lastDeliberationTick > DELIBERATION_COOLDOWN_TICKS) {
          void submit({ kind: 'deliberation', agent: who.id, tick: world.state.tick })
        }
      }
    }

    const gossip = [
      ...res.outcome.gossipA.map((g) => ({ from: a.name, about: world.nameOf(g.about), text: g.text })),
      ...res.outcome.gossipB.map((g) => ({ from: b.name, about: world.nameOf(g.about), text: g.text })),
    ]
    feed.publish('scene', `${a.name} × ${b.name} · ${world.placeOf(a.location)}`, {
      a: a.id, b: b.id,
      dialogue: res.outcome.dialogue,
      outcome: res.outcome.outcome,
      transfer: res.outcome.transfer === 0 ? null : {
        amount: Math.abs(res.outcome.transfer),
        from: res.outcome.transfer > 0 ? a.name : b.name,
        to: res.outcome.transfer > 0 ? b.name : a.name,
      },
      ...(gossip.length > 0 ? { gossip } : {}),
    })

    return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (err) {
    // Release the pair: two agents must never be left standing in a scene that
    // will now never resolve.
    world.state = abandonScene(world.state, a.id, b.id)
    feed.publish('error', `scene ${a.name} × ${b.name} failed: ${String(err).slice(0, 60)}`)
    return ZERO
  }
}

async function handleDeliberation(
  job: Extract<Job, { kind: 'deliberation' }>,
  { world, feed }: JobDeps,
): Promise<CallResult> {
  const a = world.state.agents.find((x) => x.id === job.agent)
  if (a == null) return ZERO

  try {
    const res = await deliberate({
      agent: a,
      values: resolveValues(a.values, world.now),
      hour: hourOfDay(job.tick),
      recentMemories: await world.store.since(a.id, job.tick - Math.floor(TICKS_PER_DAY / 2)),
      relationships: knownTo(world, a.id),
      allAgentNames: world.state.agents.map((x) => ({ id: x.id, name: x.name })),
    }, world.provider, new Set(world.state.agents.map((x) => x.id)))

    if (res.outcome.thought !== '') {
      await world.store.remember({ agentId: a.id, kind: 'episodic',
        text: `[deliberation] ${res.outcome.thought}`, tick: job.tick })
    }
    world.state = applyDeliberation(world.state, a.id, res.outcome, job.tick)

    await world.history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'deliberation',
      provider: world.provider.name, model: res.model, inputTokens: res.inputTokens,
      outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
    void logLlmCall({ agent: a.name, purpose: 'deliberation', model: res.model,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
      prompt: res.prompt, response: res.rawResponse })

    feed.publish('deliberation', `${a.name} — thinking`, {
      biases: res.outcome.biases,
      seekScene: res.outcome.seekScene.map((s) => ({ target: world.nameOf(s.target), reason: s.reason })),
      seed: res.outcome.conversationSeed,
    })
    return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (err) {
    feed.publish('error', `deliberation ${a.name} failed: ${String(err).slice(0, 60)}`)
    return ZERO
  }
}

async function handleCrisis(
  job: Extract<Job, { kind: 'crisis' }>,
  { world, feed }: JobDeps,
): Promise<CallResult> {
  const a = world.state.agents.find((x) => x.id === job.agent)
  if (a == null) return ZERO

  try {
    const res = await resolveCrisis({
      agent: a,
      values: resolveValues(a.values, world.now),
      kind: job.crisisKind as 'vice_temptation',
      tick: job.tick,
      context: job.context,
    }, world.provider)

    // An empty thought means the model declined. The call still happened and
    // still cost money, so it is metered — but nothing reaches the agent.
    if (res.thought !== '') {
      await world.store.remember({ agentId: a.id, kind: 'episodic',
        text: `[crisis] ${res.thought}`, tick: job.tick })
    }
    await world.history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'crisis',
      provider: world.provider.name, model: res.model, inputTokens: res.inputTokens,
      outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
    void logLlmCall({ agent: a.name, purpose: 'crisis', model: res.model,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
      prompt: res.prompt, response: res.rawResponse })

    if (res.thought !== '') {
      feed.publish('crisis', `${a.name} — inner voice (${job.crisisKind.replace('_', ' ')})`, {
        thought: res.thought, crisisKind: job.crisisKind,
      })
    }
    return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (err) {
    feed.publish('error', `crisis ${a.name} failed: ${String(err).slice(0, 60)}`)
    return ZERO
  }
}

async function handleReflection(
  job: Extract<Job, { kind: 'reflection' }>,
  { world, feed }: JobDeps,
): Promise<CallResult> {
  const a = world.state.agents.find((x) => x.id === job.agent)
  if (a == null) return ZERO

  const dayStart = job.tick - TICKS_PER_DAY
  try {
    const res = await reflect({
      agent: a,
      values: resolveValues(a.values, world.now),
      today: await world.store.since(a.id, dayStart),
      identity: await world.store.identity(a.id),
      relationships: knownTo(world, a.id),
      day: Math.floor(job.tick / TICKS_PER_DAY),
    }, world.provider)

    // Consolidation is also decay: this forgets the day's episodic noise.
    await persistReflection(world.store, a, res.outcome, job.tick, dayStart)
    world.state = applyReflection(world.state, a.id, res.outcome)

    await world.history?.recordDiary(a.id, job.tick, res.outcome)
    await world.history?.recordCall({ tick: job.tick, agentId: a.id, purpose: 'reflection',
      provider: world.provider.name, model: res.model, inputTokens: res.inputTokens,
      outputTokens: res.outputTokens, costUsd: res.costUsd, durationMs: res.durationMs })
    void logLlmCall({ agent: a.name, purpose: 'reflection', model: res.model,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      costUsd: res.costUsd, durationMs: res.durationMs, tick: job.tick,
      prompt: res.prompt, response: res.rawResponse })

    feed.publish('diary', `${a.name} — diary`, { text: res.outcome.diary, drift: res.outcome.drift })
    return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (err) {
    feed.publish('error', `reflection ${a.name} failed: ${String(err).slice(0, 60)}`)
    return ZERO
  }
}
