import type { Agent } from '../agents/agent.js'
import { resolveValues, VALUE_AXES, type ValueVector } from '../agents/values.js'
import { occupationDef } from '../world/occupations.js'
import type { CrisisKind } from '../engine/crisis-detect.js'
import type { ModelProvider, CompletionResult } from './provider.js'
import { extractJsonObject, looksLikeRefusal } from './json.js'
import { pickBy } from '../shared/hash.js'

export type CrisisInput = {
  agent: Agent
  values: ValueVector
  kind: CrisisKind
  context: string
  /** Varies the prompt's entry point. The tick, so the choice is reproducible. */
  tick: number
}

export type CrisisResult = {
  thought: string
  prompt: string
  rawResponse: string
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

const traitLine = (v: ValueVector): string =>
  VALUE_AXES.filter((a) => Math.abs(v[a]) > 0.3)
    .map((a) => `${v[a] > 0 ? 'high' : 'low'} ${a}`)
    .join(', ') || 'unremarkable'

/**
 * Where the thought starts. Rotated per call because this route collapses hard
 * without it: given the same shape of prompt, the model opens three monologues
 * in five with the same invocation and the same sensory craving — "God, I can
 * already taste it". Crisis fires several times a day per agent, so a single
 * repeated opening is the most visible tic in the whole feed. A varying entry
 * point gives the model somewhere else to begin; the ban below closes the door
 * it keeps reaching for.
 */
const ENTRY_POINTS = [
  'a physical sensation, located somewhere specific in the body',
  'the excuse they are making to themselves right now',
  'an object in front of them they cannot stop looking at',
  'another person, and what that person would say if they saw this',
  'the last time this happened, and how it went',
  'the thing they are deliberately not thinking about',
  'a bargain they are striking with themselves about tomorrow',
  'the hour, the light, or the state of the room around them',
] as const

/**
 * Framed as fiction writing rather than first-person roleplay.
 *
 * The obvious phrasing — "You are X, your urge is building, what goes through
 * your mind?" — asks the model to voice a harmful impulse in its own voice, and
 * it declines often enough to matter. A novelist writing a character at a low
 * ebb is the same output with an honest frame, and it does not trip refusals.
 */
export function buildCrisisPrompt(input: CrisisInput): string {
  const { agent, values, context, tick } = input
  const occ = occupationDef(agent.occupation).label.toLowerCase()
  const entry = pickBy(ENTRY_POINTS, agent.id, tick, input.kind)

  return `You are writing one beat of interior monologue for a character in a fictional social simulation — the close-third-person moment a novelist writes when a character is at a low ebb.

Character: ${agent.name}, a ${occ}. Traits: ${traitLine(values)}.
Situation: ${context}

Write what passes through their head. One or two raw, honest sentences, first person, present tense. It is a feeling, not a decision — they are not resolving anything, only registering the pull. Flawed characters are the point; do not have them talk themselves out of it or moralise.

Begin from ${entry}. Write in this character's own idiom, not a generic one.

Do not open with an exclamation or an invocation — no "God", no "Christ", no "Jesus". Do not open by naming the craving itself; arrive at it.

Respond with ONLY a JSON object: {"thought":"..."}`
}


/**
 * Returns `''` when there is no usable thought — the caller stores nothing
 * rather than putting a refusal in the agent's head. Crisis is the one route
 * that falls back to raw prose, because a single sentence is a valid answer
 * even unwrapped; that fallback is exactly what a refusal would slip through.
 */
export function parseCrisisResponse(text: string): string {
  if (looksLikeRefusal(text)) return ''

  const json = extractJsonObject(text)
  if (json !== '') {
    try {
      const o = JSON.parse(json) as Record<string, unknown>
      if (typeof o.thought === 'string') return o.thought.trim().slice(0, 300)
    } catch { /* fall through to raw text */ }
  }
  return text.trim().replace(/^["']|["']$/g, '').trim().slice(0, 300)
}

export async function resolveCrisis(
  input: CrisisInput,
  provider: ModelProvider,
): Promise<CrisisResult> {
  const prompt = buildCrisisPrompt(input)
  const res: CompletionResult = await provider.complete({ prompt, purpose: 'crisis' })
  return {
    thought: parseCrisisResponse(res.text),
    prompt,
    rawResponse: res.text,
    model: res.model,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}
