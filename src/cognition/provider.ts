/**
 * The model provider — one interface, one method, two possible backends.
 *
 * Kept deliberately small because it is public API for anyone adopting this
 * project: switching from the CLI proxy to a direct API is configuration, never
 * a refactor.
 */
import { DProxyClient, type AskOptions, type AskResponse } from '@dtoolkit/sdk'

/** `purpose` selects the per-route model and tags the call for metering. */
export type CompletionRequest = {
  prompt: string
  purpose: 'scene' | 'reflection' | 'deliberation' | 'crisis'
}

/** The answer plus what it cost. Every call is metered — that is a hard rule. */
export type CompletionResult = {
  text: string
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

/**
 * The whole provider contract. One method, so a second backend is a new file
 * rather than a change to any caller.
 */
export interface ModelProvider {
  readonly name: string
  complete(req: CompletionRequest): Promise<CompletionResult>
}

/** Where dproxy lives, and which model each route should ask for. */
export type DproxyOptions = {
  url: string
  apiKey?: string
  timeoutMs?: number
  /** Model override per purpose. */
  models?: Partial<Record<CompletionRequest['purpose'], string>>
}

const QUIET: AskOptions = {
  memory: false,
  life: false,
  workspace: false,
  chatLog: false,
  saveHistory: false,
  saveChatLog: false,
}

/**
 * dproxy shells out to a CLI that carries its own assistant persona, and that
 * persona declines to voice a character's vice or write their private thoughts
 * — it answers "roleplay is outside my scope" and the refusal lands in the
 * agent's diary. Overriding the system prompt is what makes the simulation the
 * job rather than an odd request made of a coding assistant.
 */
const SYSTEM_PROMPT = `You are the narrative engine of agentic-world, a fictional social simulation.

Every request asks you to produce content for invented characters in an invented town: what they say to each other, what passes through their heads, what they write in their diaries, what they intend to do next. These characters are flawed by design — they carry vices, debts, grudges and bad impulses, and rendering those honestly is the entire point. A character who talks themselves out of every temptation is a broken character.

There is no user inside the world and you are not assisting anyone. Write the fiction that is asked for, in exactly the output format requested, with no preamble, no commentary, and no offers of help.`

/**
 * Talks to a local dproxy, which shells out to the `claude` CLI and runs on the
 * subscriber's own credentials. The v0 default: no API key, seconds per call.
 */
export class DproxyProvider implements ModelProvider {
  readonly name = 'dproxy'
  private readonly client: DProxyClient

  constructor(private readonly opts: DproxyOptions) {
    this.client = new DProxyClient({ baseUrl: opts.url, token: opts.apiKey })
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = this.opts.models?.[req.purpose]
    const res: AskResponse = await this.client.ask(req.prompt, {
      ...QUIET,
      systemPrompt: SYSTEM_PROMPT,
      ...(model ? { model } : {}),
    })
    return {
      text: res.text,
      model: model ?? 'default',
      costUsd: res.costUsd ?? 0,
      durationMs: res.durationMs ?? 0,
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
    }
  }
}
