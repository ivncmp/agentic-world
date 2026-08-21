/**
 * The model boundary. Everything that costs money or quota goes through here,
 * so swapping dproxy for the direct API or a local model is configuration
 * rather than a refactor — see CLAUDE.md on when that switch becomes necessary.
 */
export type CompletionRequest = {
  prompt: string
  /** Caller's label for metering. */
  purpose: 'scene' | 'reflection'
}

export type CompletionResult = {
  text: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

export interface ModelProvider {
  readonly name: string
  complete(req: CompletionRequest): Promise<CompletionResult>
}

export type DproxyOptions = {
  url: string
  apiKey?: string
  timeoutMs?: number
}

/**
 * dproxy shells out to the Claude Code CLI, which means ~24.5k tokens of
 * harness overhead and ~14s per call regardless of prompt size. Fine at v0
 * volumes, and free against the subscription — see the measured baseline.
 */
export class DproxyProvider implements ModelProvider {
  readonly name = 'dproxy'

  constructor(private readonly opts: DproxyOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(`${this.opts.url}/v1/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.opts.apiKey == null ? {} : { Authorization: `Bearer ${this.opts.apiKey}` }),
      },
      body: JSON.stringify({
        prompt: req.prompt,
        // dcontext injection is for coding sessions; here it is pure overhead.
        memory: false,
        life: false,
        workspace: false,
        chatLog: false,
        saveHistory: false,
        saveChatLog: false,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    })
    if (!res.ok) throw new Error(`dproxy ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as {
      text: string
      costUsd?: number
      durationMs?: number
      usage?: { inputTokens?: number; outputTokens?: number }
    }
    return {
      text: body.text,
      costUsd: body.costUsd ?? 0,
      durationMs: body.durationMs ?? 0,
      inputTokens: body.usage?.inputTokens ?? 0,
      outputTokens: body.usage?.outputTokens ?? 0,
    }
  }
}
