/**
 * A JSONL line per model call: prompt, response, tokens, cost, duration.
 *
 * **Every LLM call is metered** — that is a hard rule, not an afterthought.
 * Postgres holds the numbers for the metering endpoint; this file holds the
 * prompt and the raw answer, which is what you actually need when a route
 * starts refusing or a model changes how it formats JSON.
 *
 * Written only for calls that succeeded, so a failure never appears here — look
 * at the feed's error entries for those.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const LOG_DIR = process.env.LOG_DIR ?? 'logs'

/**
 * One call, in full. `prompt` and `response` are the raw strings.
 */
export type LlmLogEntry = {
  agent: string
  purpose: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
  tick: number
  prompt: string
  response: string
  error?: string
}

let ready = false

/**
 * Appends one line to today's log. Fire-and-forget — never blocks a handler.
 */
export async function logLlmCall(entry: LlmLogEntry): Promise<void> {
  if (!ready) {
    await mkdir(LOG_DIR, { recursive: true })
    ready = true
  }
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const line = JSON.stringify({ ts: now.toISOString(), ...entry }) + '\n'
  await appendFile(join(LOG_DIR, `llm-${day}.jsonl`), line)
}
