import type { Agent } from '../agents/agent.js'
import { resolveValues, VALUE_AXES, type ValueVector } from '../agents/values.js'
import { occupationDef } from '../world/occupations.js'
import type { CrisisKind } from '../engine/crisis-detect.js'
import type { ModelProvider, CompletionResult } from './provider.js'

export type CrisisInput = {
  agent: Agent
  values: ValueVector
  kind: CrisisKind
  context: string
}

export type CrisisResult = {
  thought: string
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

export function buildCrisisPrompt(input: CrisisInput): string {
  const { agent, values, context } = input
  const occ = occupationDef(agent.occupation).label.toLowerCase()

  return `You are ${agent.name}, a ${occ}. Personality: ${traitLine(values)}.

${context}

What goes through your mind right now? One or two raw, honest sentences in first person. Not a decision — just the feeling.

Respond with ONLY a JSON object: {"thought":"..."}`
}

export function parseCrisisResponse(text: string): string {
  const raw = text.trim()
  const json = raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? '')
  if (json !== '') {
    try {
      const o = JSON.parse(json) as Record<string, unknown>
      if (typeof o.thought === 'string') {
        return o.thought.trim().slice(0, 300)
      }
    } catch { /* fall through to raw text */ }
  }
  // Graceful fallback: if the model just wrote a sentence, use it.
  const clean = raw.replace(/^["']|["']$/g, '').trim()
  return clean.slice(0, 300)
}

export async function resolveCrisis(
  input: CrisisInput,
  provider: ModelProvider,
): Promise<CrisisResult> {
  const prompt = buildCrisisPrompt(input)
  const res: CompletionResult = await provider.complete({ prompt, purpose: 'crisis' })
  return {
    thought: parseCrisisResponse(res.text),
    model: res.model,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}
