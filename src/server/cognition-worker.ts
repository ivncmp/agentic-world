import type { AgentId } from '../agents/agent.js'
import type { ModelProvider } from '../cognition/provider.js'

export type Job =
  | { kind: 'scene'; a: AgentId; b: AgentId; tension: number; tick: number }
  | { kind: 'reflection'; agent: AgentId; tick: number }

/**
 * Runs cognition *beside* the tick loop, never inside it.
 *
 * A scene costs 15-40s against dproxy. Awaiting that in the loop would stop the
 * world clock for the duration — the pair is frozen by design, but everyone
 * else must keep living. The queue is bounded so a backlog degrades richness
 * (jobs are dropped) rather than memory.
 */
export class CognitionWorker {
  /** Jobs carry their durable row id so completion can clear it. */
  private readonly queue: { job: Job; id: number }[] = []
  private running = 0
  private stopped = false

  spent = 0
  completed = 0
  dropped = 0

  constructor(
    private readonly provider: ModelProvider,
    private readonly handler: (job: Job) => Promise<number>,
    private readonly opts: {
      concurrency?: number
      maxQueue?: number
      onDone?: (id: number) => Promise<void>
      onFailed?: (id: number) => Promise<void>
    } = {},
  ) {}

  get pending(): number {
    return this.queue.length + this.running
  }

  /** Silently drops work when saturated: a queue that grows without bound turns
   *  a slow provider into an out-of-memory crash hours later. */
  submit(job: Job, id = 0): void {
    if (this.stopped) return
    if (this.queue.length >= (this.opts.maxQueue ?? 64)) {
      this.dropped++
      return
    }
    this.queue.push({ job, id })
    void this.pump()
  }

  private async pump(): Promise<void> {
    while (!this.stopped && this.running < (this.opts.concurrency ?? 2) && this.queue.length > 0) {
      const entry = this.queue.shift()
      if (entry == null) return
      this.running++
      void this.handler(entry.job)
        .then(async (cost) => {
          this.spent += cost
          this.completed++
          if (entry.id > 0) await this.opts.onDone?.(entry.id)
        })
        .catch(async () => {
          if (entry.id > 0) await this.opts.onFailed?.(entry.id)
        })
        .finally(() => {
          this.running--
          void this.pump()
        })
    }
  }

  async drain(timeoutMs = 60_000): Promise<void> {
    const until = Date.now() + timeoutMs
    while (this.pending > 0 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  stop(): void {
    this.stopped = true
    this.queue.length = 0
  }
}
