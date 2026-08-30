/**
 * An agent rethinks — and this is the pattern to copy when adding cognition.
 *
 * It decides nothing. It returns **dispositions**: biases that `scoreActions`
 * adds to its own scoring, people the agent would like to run into, and a line
 * they might open with. The free layer still makes every decision.
 *
 * That is what keeps it affordable. A route returning an *action* would have to
 * run every tick to be useful, which breaks the cost model the whole project is
 * built around.
 *
 * Runs periodically, and reactively after a scene intense enough to change
 * someone's mind.
 */
import type { Agent, AgentId, ActionBias, SeekScene, Relationship } from '../agents/agent.js'
import type { ActionKind } from '../engine/actions.js'
import { VALUE_AXES, type ValueVector } from '../agents/values.js'
import type { Memory } from '../memory/store.js'
import type { ModelProvider, CompletionResult } from './provider.js'
import { parseJsonResponse, asString } from './json.js'

/**
 * Dispositions, never actions: what to lean toward, who to seek, what to open with.
 */
export type DeliberationOutcome = {
  biases: ActionBias[]
  seekScene: SeekScene[]
  conversationSeed: string | null
  thought: string
}

/**
 * Recent memories, current relationships, and who exists to be sought out.
 */
export type DeliberationInput = {
  agent: Agent
  values: ValueVector
  hour: number
  recentMemories: readonly Memory[]
  relationships: { name: string; id: AgentId; rel: Relationship }[]
  allAgentNames: { id: AgentId; name: string }[]
}

/**
 * The outcome plus its metering.
 */
export type DeliberationResult = {
  outcome: DeliberationOutcome
  prompt: string
  rawResponse: string
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

const VALID_ACTIONS = new Set<string>([
  'eat',
  'sleep',
  'work',
  'socialize',
  'seek_job',
  'indulge_vice',
  'steal',
  'relax',
  'exercise',
  'browse',
  'wash',
  'idle',
])

const traitLine = (v: ValueVector): string =>
  VALUE_AXES.filter((a) => Math.abs(v[a]) > 0.2)
    .map((a) => `${v[a] > 0 ? 'high' : 'low'} ${a}`)
    .join(', ') || 'unremarkable'

/**
 * Asks what the agent wants next — explicitly not what they should do next.
 */
export function buildDeliberationPrompt(input: DeliberationInput): string {
  const { agent, values, hour } = input
  const needs = agent.needs
  const canAffordFood = agent.money >= 8

  const situationLines: string[] = []
  if (needs.hunger >= 0.35 && !canAffordFood) situationLines.push('Hungry but cannot afford food.')
  else if (needs.hunger >= 0.35) situationLines.push(`Hungry (${(needs.hunger * 100).toFixed(0)}%).`)
  if (agent.housing.arrears > 0) situationLines.push(`Behind on rent by ${agent.housing.arrears} credits.`)
  if (agent.job == null) situationLines.push('Currently unemployed.')
  if (agent.money < 20) situationLines.push(`Very low on money (${Math.round(agent.money)} credits).`)
  if (needs.social >= 0.5)
    situationLines.push(`Feeling lonely (social need ${(needs.social * 100).toFixed(0)}%).`)

  const relLines =
    input.relationships.length === 0
      ? '  (knows nobody yet)'
      : input.relationships
          .slice(0, 6)
          .map(
            (r) =>
              `  - ${r.name}: affection ${r.rel.affection.toFixed(2)}, trust ${r.rel.trust.toFixed(2)}, encounters ${r.rel.encounters}`,
          )
          .join('\n')

  const memLines =
    input.recentMemories.length === 0
      ? '  (nothing recent)'
      : input.recentMemories
          .slice(0, 5)
          .map((m) => `  - ${m.text}`)
          .join('\n')

  const others = input.allAgentNames
    .filter((o) => o.id !== agent.id)
    .map((o) => `${o.name} (${o.id})`)
    .join(', ')

  const vicesLine = agent.vices.map((v) => `${v.kind} (urge ${(v.urge * 100).toFixed(0)}%)`).join(', ')
  const jobLine =
    agent.job != null ? `works ${agent.job.shiftStart}:00-${agent.job.shiftEnd}:00` : 'unemployed'

  return `You are ${agent.name}'s inner voice. It is ${String(hour).padStart(2, '0')}:00. Think about what matters right now and make a plan for the next few hours.

Character: ${traitLine(values)}
Money: ${Math.round(agent.money)} credits
Job: ${jobLine}
Vices: ${vicesLine}
Needs: hunger ${(needs.hunger * 100).toFixed(0)}%, energy ${(needs.energy * 100).toFixed(0)}%, social ${(needs.social * 100).toFixed(0)}%
${situationLines.length > 0 ? '\nSituation:\n' + situationLines.map((s) => `  ! ${s}`).join('\n') : ''}

Recent memories:
${memLines}

People I know:
${relLines}

Everyone in town: ${others}

Available actions to bias: eat, sleep, work, socialize, seek_job, relax, exercise, browse, wash, idle
Respond with ONLY a JSON object:
{"biases":[{"action":"eat","bias":0.8}],"seekScene":[{"target":"agent-id","reason":"why"}],"conversationSeed":"a fresh topic or null","thought":"one sentence, first person"}

Rules:
- biases: up to 4. Range -1.0 to +1.0. Positive = do more, negative = do less. If hungry and have money, bias eat high. If in debt, bias work high.
- seekScene: up to 2. Use ONLY ids from the list above. Pick someone you haven't spoken to in a while, or someone new in town.
- conversationSeed: null if nothing specific. Otherwise a fresh topic — NOT the same thing you always talk about.
- thought: what crosses your mind right now. One sentence, first person.`
}

/**
 * Validates the answer against reality: an unknown action kind or an agent who
 * does not exist is dropped rather than trusted into the reflex layer.
 */
export function parseDeliberation(
  text: string,
  validAgentIds: ReadonlySet<string>,
  agentId: string,
): DeliberationOutcome {
  const o = parseJsonResponse<Record<string, unknown>>('deliberation', text)

  const biases: ActionBias[] = Array.isArray(o.biases)
    ? (o.biases as Record<string, unknown>[])
        .filter((b) => typeof b === 'object' && b != null)
        .filter((b) => VALID_ACTIONS.has(asString(b.action)))
        .slice(0, 4)
        .map((b) => ({
          action: asString(b.action) as ActionKind,
          bias: Math.max(-1, Math.min(1, Number(b.bias) || 0)),
        }))
    : []

  const seekScene: SeekScene[] = Array.isArray(o.seekScene)
    ? (o.seekScene as Record<string, unknown>[])
        .filter((s) => typeof s === 'object' && s != null)
        .filter((s) => {
          const target = asString(s.target)
          return target !== '' && target !== agentId && validAgentIds.has(target)
        })
        .slice(0, 2)
        .map((s) => ({
          target: String(s.target),
          reason: typeof s.reason === 'string' ? s.reason.slice(0, 200) : '',
        }))
    : []

  const conversationSeed =
    typeof o.conversationSeed === 'string' &&
    o.conversationSeed.trim() !== '' &&
    o.conversationSeed !== 'null'
      ? o.conversationSeed.trim().slice(0, 200)
      : null

  const thought = typeof o.thought === 'string' ? o.thought.slice(0, 300) : ''

  return { biases, seekScene, conversationSeed, thought }
}

/**
 * One call. `validIds` is what keeps `seekScene` pointing at real people.
 */
export async function deliberate(
  input: DeliberationInput,
  provider: ModelProvider,
  validAgentIds: ReadonlySet<string>,
): Promise<DeliberationResult> {
  const prompt = buildDeliberationPrompt(input)
  const res: CompletionResult = await provider.complete({ prompt, purpose: 'deliberation' })
  const outcome = parseDeliberation(res.text, validAgentIds, input.agent.id)
  return {
    outcome,
    prompt,
    rawResponse: res.text,
    model: res.model,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}
