import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const LOG_DIR = process.env.LOG_DIR ?? 'logs'

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
