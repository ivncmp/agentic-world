import { DProxyClient, type AskOptions, type AskResponse } from '@dtoolkit/sdk'

export type CompletionRequest = {
  prompt: string
  purpose: 'scene' | 'reflection' | 'deliberation' | 'crisis'
}

export type CompletionResult = {
  text: string
  model: string
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
