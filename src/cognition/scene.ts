import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import type { Memory, MemoryStore } from '../memory/store.js'
import { resolveValues, VALUE_AXES, type ValueVector } from '../agents/values.js'
import { occupationDef } from '../world/occupations.js'
import type { ModelProvider } from './provider.js'
import { parseJsonResponse } from './json.js'

/**
 * Scene resolution: the one place the world spends real intelligence. Two
 * agents who have been gated as worth the cost get a single model call that
 * decides what passes between them and what each takes away from it.
 */

export type SceneOutcome = {
  dialogue: { speaker: string; line: string }[]
  outcome: string
  memoryA: string
  memoryB: string
  deltas: {
    aToB: { trust: number; affection: number }
    bToA: { trust: number; affection: number }
  }
  /** Credits moving from A to B; negative reverses. Bounded on apply. */
  transfer: number
  /**
   * Credits *lent* from A to B, creating a debt. Distinct from `transfer`,
   * which settles one. Loans are born in conversation because that is where
   * they are born in life — you ask someone, and they say yes or no.
   */
  loan: number
  /** What A thought but didn't say — inner life, saved as memory. */
  thoughtA: string
  /** What B thought but didn't say. */
  thoughtB: string
  /** Things A told B about third parties — second-hand memory transfer. */
  gossipA: { about: AgentId; text: string }[]
  /** Things B told A about third parties. */
  gossipB: { about: AgentId; text: string }[]
}

const traitLine = (v: ValueVector): string =>
  VALUE_AXES.filter((a) => Math.abs(v[a]) > 0.25)
    .map((a) => `${v[a] > 0 ? 'high' : 'low'} ${a}`)
    .join(', ') || 'unremarkable'

const memoryLines = (ms: readonly Memory[]): string =>
  ms.length === 0
    ? '  (they have no particular history)'
    : ms.map((m) => `  - ${m.text}${m.secondHand === true ? ' (heard second-hand)' : ''}`).join('\n')

const describe = (a: Agent, v: ValueVector): string => {
  const parts = [
    `${a.name}, ${occupationDef(a.occupation).label.toLowerCase()}.`,
    `Personality: ${traitLine(v)}.`,
  ]
  if (a.interests.length > 0) parts.push(`Enjoys ${a.interests.join(', ')}.`)
  parts.push(`Vices: ${a.vices.map((x) => x.kind).join(' and ')}.`)
  if (a.housing.arrears > 0) parts.push(`${a.housing.arrears} behind on rent.`)
  return parts.join(' ')
}

/**
 * Whether these two could plausibly lend to each other at all.
 *
 * This used to be a hint — "people rarely lend to someone they do not trust" —
 * and the model lent anyway, so a third of all pairs in town ended up carrying a
 * debt to someone they barely knew. Money between people is supposed to be a
 * consequence of a relationship, not the thing that starts one, so the engine
 * now decides and the prompt only reports the decision.
 */
export const LEND_MIN_TRUST = 0.15
export const LEND_MIN_ENCOUNTERS = 120

export const canLend = (rel: Relationship): boolean =>
  rel.encounters >= LEND_MIN_ENCOUNTERS && rel.trust >= LEND_MIN_TRUST

function lendingRule(a: Agent, b: Agent, rel: Relationship): string {
  const known = rel.encounters >= LEND_MIN_ENCOUNTERS
  const trusted = rel.trust >= LEND_MIN_TRUST
  if (!known || !trusted) {
    return `MUST be 0. ${!known ? 'These two barely know each other' : `${a.name} and ${b.name} do not trust each other`}, and people do not lend money across that. Money may still change hands as \`transfer\` if a debt is settled or something is paid for.`
  }
  return `credits *lent* from ${a.name} to ${b.name} (negative reverses), creating a debt to be repaid later. These two know and trust each other enough that a loan is possible — but only if one actually asks and the other agrees. Usually 0.`
}

export type ThirdParty = {
  id: AgentId
  name: string
  fromA: Relationship
  fromB: Relationship
}

export function buildScenePrompt(input: {
  a: Agent
  b: Agent
  rel: Relationship
  aboutB: readonly Memory[]
  aboutA: readonly Memory[]
  place: string
  hour: number
  now: number
  knownInCommon?: readonly ThirdParty[]
}): string {
  const { a, b, rel } = input
  const va = resolveValues(a.values, input.now)
  const vb = resolveValues(b.values, input.now)
  const owed =
    rel.debt === 0
      ? ''
      : `\n${rel.debt > 0 ? b.name : a.name} owes ${Math.abs(Math.round(rel.debt))} credits to ${rel.debt > 0 ? a.name : b.name}.`
  // Bad blood is stated as bad blood, never as money. Announcing a robbery as
  // a debt turned every one of these encounters into a collection call.
  const bad =
    rel.grievance < 0.1
      ? ''
      : rel.grievance > 0.5
        ? '\nThere is real bad blood between them — one has wronged the other, and it has not been forgotten.'
        : '\nSomething sour sits between them from before.'

  const shared = a.interests.filter((i) => b.interests.includes(i))
  const sharedLine =
    shared.length > 0 ? `\nThey both enjoy ${shared.join(' and ')} — a natural topic of conversation.` : ''

  const seedA = a.deliberation?.conversationSeed
  const seedB = b.deliberation?.conversationSeed
  const seedLine = seedA || seedB ? `\nOn ${seedA ? a.name : b.name}'s mind lately: "${seedA || seedB}"` : ''

  const thirds = input.knownInCommon ?? []
  const thirdLines =
    thirds.length === 0
      ? ''
      : `\n\nPeople they both know:\n` +
        thirds
          .map(
            (t) =>
              `  - ${t.name} (id ${t.id}): A feels aff ${t.fromA.affection.toFixed(1)} trust ${t.fromA.trust.toFixed(1)} / B feels aff ${t.fromB.affection.toFixed(1)} trust ${t.fromB.trust.toFixed(1)}`,
          )
          .join('\n')

  const gossipIds =
    thirds.length > 0
      ? `\ngossipA: things ${a.name} shares with ${b.name} about someone in "People they both know". Usually []. Only when the conversation naturally mentions a third person — a rumour, a complaint, praise. Max 2 items. Use their id from the list above.
gossipB: same, from ${b.name}'s side.`
      : ''

  return `Two people meet in a simulated town. Resolve the encounter.

PLACE: ${input.place}, ${String(input.hour).padStart(2, '0')}:00

A — ${describe(a, va)}
B — ${describe(b, vb)}

How A feels about B: affection ${rel.affection.toFixed(2)}, trust ${rel.trust.toFixed(2)}.${owed}${bad}${sharedLine}${seedLine}${thirdLines}

What A remembers about B:
${memoryLines(input.aboutB)}

What B remembers about A:
${memoryLines(input.aboutA)}

Write a vivid, naturalistic encounter shaped by their personalities, history and
current circumstances. Let the conversation breathe — small talk, teasing,
warmth, tension, vulnerability are all fair game. Not every encounter is about
money; people talk about their day, their worries, things they enjoy, people
they know. A grievance may surface if it is strong, but ordinary life is the
default. Write 12–18 dialogue lines.

Write in English. The world stores one canonical language; anything shown to a
Spanish-speaking owner is translated at display time, and mixed-language
memories stop matching each other on recall.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"dialogue":[{"speaker":"${a.name}","line":"..."},{"speaker":"${b.name}","line":"..."}],
 "outcome":"one sentence, third person",
 "memoryA":"what ${a.name} will remember, first person, one sentence",
 "memoryB":"what ${b.name} will remember, first person, one sentence",
 "thoughtA":"what ${a.name} thought but didn't say, first person, one sentence",
 "thoughtB":"what ${b.name} thought but didn't say, first person, one sentence",
 "deltas":{"aToB":{"trust":0.0,"affection":0.0},"bToA":{"trust":0.0,"affection":0.0}},
 "transfer":0,
 "loan":0${thirds.length > 0 ? ',\n "gossipA":[],"gossipB":[]' : ''}}

Deltas are between -0.5 and 0.5.
transfer: credits changing hands from ${a.name} to ${b.name} (negative reverses) — a payment, a purchase, settling up. 0 unless money genuinely moves.
loan: ${lendingRule(a, b, rel)}${gossipIds}`
}

const clampDelta = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(-0.5, Math.min(0.5, n)) : 0

/**
 * Defensive parse. There is no schema guarantee behind dproxy, only a
 * well-behaved model, so anything malformed must fail loudly rather than
 * corrupt the world.
 */
const MAX_GOSSIP = 2

function normalizeGossip(
  g: Record<string, unknown>,
  validIds: ReadonlySet<string>,
): { about: AgentId; text: string } | null {
  const id = g.about ?? g.id ?? g.subject ?? g.person
  const text = g.text ?? g.content ?? g.description ?? g.claim
  if (typeof id !== 'string' || typeof text !== 'string') return null
  if (!validIds.has(id)) return null
  return { about: id, text }
}

function parseGossip(raw: unknown, validIds: ReadonlySet<string>): { about: AgentId; text: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => g != null && typeof g === 'object')
    .map((g) => normalizeGossip(g, validIds))
    .filter((g): g is { about: AgentId; text: string } => g != null)
    .slice(0, MAX_GOSSIP)
}

export function parseSceneOutcome(
  text: string,
  aName: string,
  bName: string,
  /** When false, any loan the model invents is discarded — see `lendingRule`. */
  lendingAllowed = true,
  /** Valid third-party ids — gossip mentioning anyone else is discarded. */
  thirdPartyIds: ReadonlySet<string> = new Set(),
): SceneOutcome {
  const o = parseJsonResponse<Record<string, unknown>>('scene', text)

  const dialogue = Array.isArray(o.dialogue)
    ? o.dialogue
        .filter(
          (d): d is { speaker: string; line: string } =>
            typeof (d as { speaker?: unknown }).speaker === 'string' &&
            typeof (d as { line?: unknown }).line === 'string',
        )
        .slice(0, 16)
    : []
  const deltas = (o.deltas ?? {}) as Record<string, Record<string, unknown>>

  return {
    dialogue,
    outcome: typeof o.outcome === 'string' ? o.outcome : `${aName} and ${bName} spoke briefly.`,
    memoryA: typeof o.memoryA === 'string' ? o.memoryA : '',
    memoryB: typeof o.memoryB === 'string' ? o.memoryB : '',
    thoughtA: typeof o.thoughtA === 'string' ? o.thoughtA : '',
    thoughtB: typeof o.thoughtB === 'string' ? o.thoughtB : '',
    deltas: {
      aToB: {
        trust: clampDelta(deltas.aToB?.trust),
        affection: clampDelta(deltas.aToB?.affection),
      },
      bToA: {
        trust: clampDelta(deltas.bToA?.trust),
        affection: clampDelta(deltas.bToA?.affection),
      },
    },
    transfer: typeof o.transfer === 'number' && Number.isFinite(o.transfer) ? Math.round(o.transfer) : 0,
    loan: lendingAllowed && typeof o.loan === 'number' && Number.isFinite(o.loan) ? Math.round(o.loan) : 0,
    gossipA: parseGossip(o.gossipA, thirdPartyIds),
    gossipB: parseGossip(o.gossipB, thirdPartyIds),
  }
}

export type SceneResult = {
  outcome: SceneOutcome
  prompt: string
  rawResponse: string
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

export async function resolveScene(
  input: Parameters<typeof buildScenePrompt>[0],
  provider: ModelProvider,
): Promise<SceneResult> {
  const prompt = buildScenePrompt(input)
  const res = await provider.complete({ prompt, purpose: 'scene' })
  const thirdPartyIds = new Set((input.knownInCommon ?? []).map((t) => t.id))
  return {
    outcome: parseSceneOutcome(res.text, input.a.name, input.b.name, canLend(input.rel), thirdPartyIds),
    prompt,
    rawResponse: res.text,
    model: res.model,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}

/** Writes what each party took away. Memory is what makes relationships emerge. */
export async function persistScene(
  store: MemoryStore,
  a: Agent,
  b: Agent,
  outcome: SceneOutcome,
  tick: number,
): Promise<void> {
  if (outcome.memoryA !== '')
    await store.remember({ agentId: a.id, kind: 'episodic', text: outcome.memoryA, tick, about: b.id })
  if (outcome.memoryB !== '')
    await store.remember({ agentId: b.id, kind: 'episodic', text: outcome.memoryB, tick, about: a.id })
  if (outcome.thoughtA !== '')
    await store.remember({
      agentId: a.id,
      kind: 'episodic',
      text: `[thought] ${outcome.thoughtA}`,
      tick,
      about: b.id,
    })
  if (outcome.thoughtB !== '')
    await store.remember({
      agentId: b.id,
      kind: 'episodic',
      text: `[thought] ${outcome.thoughtB}`,
      tick,
      about: a.id,
    })
  // Gossip: A told B about C → B gets a second-hand memory about C
  for (const g of outcome.gossipA)
    await store.remember({
      agentId: b.id,
      kind: 'episodic',
      text: g.text,
      tick,
      about: g.about,
      secondHand: true,
    })
  // Gossip: B told A about C → A gets a second-hand memory about C
  for (const g of outcome.gossipB)
    await store.remember({
      agentId: a.id,
      kind: 'episodic',
      text: g.text,
      tick,
      about: g.about,
      secondHand: true,
    })
}
