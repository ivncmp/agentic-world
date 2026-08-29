import type { Agent, AgentId, Relationship } from '../agents/agent.js'
import type { Memory, MemoryStore } from '../memory/store.js'
import { VALUE_AXES, type ValueAxis, type ValueVector } from '../agents/values.js'
import { occupationDef } from '../world/occupations.js'
import type { ModelProvider } from './provider.js'
import { parseJsonResponse, asString } from './json.js'

/**
 * Layer 3. Once per agent per night, the day is consolidated: the noise becomes
 * one memory, conclusions become lasting changes to who the agent is, and the
 * owner gets something to read.
 *
 * This is the only writer of `values.drift` — the stratum that records what
 * life did to someone, as opposed to how their owner wrote them or what their
 * owner last advised. Without it the third stratum stays zero forever and
 * agents cannot be changed by living.
 *
 * Cost scales with agent count, not activity: one call each, every night.
 */

export type ReflectionOutcome = {
  /** First person, past tense. What the owner reads in the morning. */
  diary: string
  /** One memory that replaces the day's episodic noise. */
  consolidated: string
  /** Lasting shifts in character. Small: a single day should not remake anyone. */
  drift: Partial<Record<ValueAxis, number>>
  /** Considered revisions of how the agent feels about people. */
  relationships: { agent: AgentId; trust: number; affection: number }[]
}

/** A day can nudge you; it cannot remake you. */
export const MAX_DRIFT_PER_NIGHT = 0.1

const traits = (v: ValueVector): string => VALUE_AXES.map((a) => `${a} ${v[a].toFixed(2)}`).join(', ')

export function buildReflectionPrompt(input: {
  agent: Agent
  values: ValueVector
  today: readonly Memory[]
  identity: readonly Memory[]
  relationships: { name: string; id: AgentId; rel: Relationship }[]
  day: number
}): string {
  const { agent, today } = input
  const events =
    today.length === 0 ? '  (nothing of note happened today)' : today.map((m) => `  - ${m.text}`).join('\n')
  const who =
    input.relationships.length === 0
      ? '  (nobody yet)'
      : input.relationships
          .map(
            (r) =>
              `  - ${r.name} (id ${r.id}): affection ${r.rel.affection.toFixed(2)}, trust ${r.rel.trust.toFixed(2)}` +
              (r.rel.debt === 0 ? '' : `, debt ${Math.round(r.rel.debt)}`),
          )
          .join('\n')
  const life =
    input.identity.length === 0
      ? ''
      : `\nWhat they carry:\n${input.identity.map((m) => `  - ${m.text}`).join('\n')}\n`

  return `End of day ${input.day}. ${agent.name}, ${occupationDef(agent.occupation).label.toLowerCase()}, is turning in.

Character (−1..1): ${traits(input.values)}
Vices: ${agent.vices.map((v) => v.kind).join(', ')}
Money: ${Math.round(agent.money)}${agent.housing.arrears > 0 ? `, ${agent.housing.arrears} behind on rent` : ''}
${life}
Today:
${events}

People they know:
${who}

Look back on the day as ${agent.name} would. Draw conclusions that would actually
change them — and only if the day earned it. A quiet day changes nobody.

Write in English, always. Diaries are stored, recalled and compared against each
other, so they must all be in one language; translation happens at display time.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"diary":"first person, past tense, 2-4 sentences — what ${agent.name} would write tonight",
 "consolidated":"one sentence, first person: the single thing worth keeping from today",
 "drift":{"honesty":0.0,"loyalty":0.0},
 "relationships":[{"agent":"<id>","trust":0.0,"affection":0.0}]}

drift: only axes the day genuinely moved, between -${MAX_DRIFT_PER_NIGHT} and ${MAX_DRIFT_PER_NIGHT}. Omit the field or use {} on an ordinary day.
relationships: considered revisions on reflection, between -0.2 and 0.2. Use the ids given above. Omit if nothing changed.`
}

const clamp = (n: unknown, lim: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : 0

export function parseReflection(text: string, fallbackName: string): ReflectionOutcome {
  const o = parseJsonResponse<Record<string, unknown>>('reflection', text)

  const drift: Partial<Record<ValueAxis, number>> = {}
  const rawDrift = (o.drift ?? {}) as Record<string, unknown>
  for (const axis of VALUE_AXES) {
    const d = clamp(rawDrift[axis], MAX_DRIFT_PER_NIGHT)
    if (d !== 0) drift[axis] = d
  }

  const relationships = Array.isArray(o.relationships)
    ? o.relationships
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r != null)
        .map((r) => ({
          agent: asString(r.agent),
          trust: clamp(r.trust, 0.2),
          affection: clamp(r.affection, 0.2),
        }))
        .filter((r) => r.agent !== '')
    : []

  return {
    diary: typeof o.diary === 'string' ? o.diary : `${fallbackName} had an unremarkable day.`,
    consolidated: typeof o.consolidated === 'string' ? o.consolidated : '',
    drift,
    relationships,
  }
}

export type ReflectionResult = {
  outcome: ReflectionOutcome
  prompt: string
  rawResponse: string
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

export async function reflect(
  input: Parameters<typeof buildReflectionPrompt>[0],
  provider: ModelProvider,
): Promise<ReflectionResult> {
  const prompt = buildReflectionPrompt(input)
  const res = await provider.complete({ prompt, purpose: 'reflection' })
  return {
    outcome: parseReflection(res.text, input.agent.name),
    prompt,
    rawResponse: res.text,
    model: res.model,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}

/**
 * Replaces the day's episodic noise with one consolidated memory and forgets
 * what came before. Compression *and* decay in one step — the agent keeps the
 * meaning of the day rather than its transcript.
 */
export async function persistReflection(
  store: MemoryStore,
  agent: Agent,
  outcome: ReflectionOutcome,
  tick: number,
  forgetBefore: number,
): Promise<void> {
  if (outcome.consolidated !== '') {
    await store.remember({
      agentId: agent.id,
      kind: 'episodic',
      text: outcome.consolidated,
      tick,
    })
  }
  await store.forget(agent.id, forgetBefore)
}
