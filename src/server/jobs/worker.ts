/**
 * The cognition queue — BullMQ on Redis, capped at six concurrent calls.
 *
 * Every call spawns a CLI process through dproxy and takes seconds, not
 * milliseconds, so **never fan out unbounded**: cap concurrency and let the
 * backlog drain across ticks. Falling behind degrades richness, never
 * correctness — the world keeps ticking on the reflex layer either way.
 *
 * Redis outliving this process is deliberate. Pending jobs survive a restart
 * and the engine reports them at boot, so a scene queued before a deploy still
 * resolves after it.
 */
import { Queue, Worker, type Job as BullJob } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import type { AgentId } from '../../agents/agent.js'

/**
 * Everything the queue can be asked to resolve. One variant per route.
 */
export type Job =
  | { kind: 'scene'; a: AgentId; b: AgentId; tension: number; tick: number }
  | { kind: 'reflection'; agent: AgentId; tick: number }
  | { kind: 'deliberation'; agent: AgentId; tick: number }
  | { kind: 'crisis'; agent: AgentId; crisisKind: string; context: string; tick: number }

/**
 * What a handler reports back, so the worker can total spend across the run.
 */
export type CallResult = {
  costUsd: number
  inputTokens: number
  outputTokens: number
}

/**
 * The route names, for the per-route breakdown the viewer shows.
 */
export type JobKind = Job['kind']

/**
 * Concurrent model calls. Sized against how fast dproxy answers: too high and
 * calls queue at the provider instead of here, where they can be counted.
 */
export const MAX_CONCURRENT = 6

const KIND_PRIORITY: Record<JobKind, number> = {
  reflection: 1,
  deliberation: 2,
  crisis: 3,
  scene: 4,
}

const QUEUE_NAME = 'cognition'

/**
 * BullMQ-backed cognition queue. Redis persists jobs across restarts;
 * priority ensures reflections drain before scenes.
 */
export class CognitionWorker {
  private readonly queue: Queue
  private readonly worker: Worker
  private _pending = 0
  private runningByKind: Record<string, number> = {}
  private queuedByKind: Record<string, number> = {}

  spent = 0
  inputTokens = 0
  outputTokens = 0
  completed = 0
  dropped = 0

  constructor(
    redisUrl: string,
    handler: (job: Job) => Promise<CallResult>,
    opts: { concurrency?: number } = {},
  ) {
    const queueConn = new IORedis(redisUrl, { maxRetriesPerRequest: null })
    const workerConn = new IORedis(redisUrl, { maxRetriesPerRequest: null })

    this.queue = new Queue(QUEUE_NAME, {
      connection: queueConn,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
    })

    this.worker = new Worker(
      QUEUE_NAME,
      async (bullJob: BullJob<Job>) => {
        const job = bullJob.data
        const kind = job.kind
        this.queuedByKind[kind] = Math.max(0, (this.queuedByKind[kind] ?? 1) - 1)
        this.runningByKind[kind] = (this.runningByKind[kind] ?? 0) + 1
        try {
          const result = await handler(job)
          this.spent += result.costUsd
          this.inputTokens += result.inputTokens
          this.outputTokens += result.outputTokens
          this.completed++
          return result
        } finally {
          this.runningByKind[kind] = Math.max(0, (this.runningByKind[kind] ?? 1) - 1)
          this._pending = Math.max(0, this._pending - 1)
        }
      },
      {
        connection: workerConn,
        concurrency: opts.concurrency ?? MAX_CONCURRENT,
      },
    )

    this.worker.on('failed', (_job, err) => {
      console.error('cognition job failed:', err.message)
    })
  }

  /**
   * Sync in-memory counters with Redis state (call once on startup).
   */
  async init(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'active')
    const total = (counts.waiting ?? 0) + (counts.active ?? 0)
    this._pending = total
    if (total > 0) {
      const waiting = await this.queue.getJobs(['waiting'], 0, 200)
      for (const j of waiting) {
        if (j.data?.kind) this.queuedByKind[j.data.kind] = (this.queuedByKind[j.data.kind] ?? 0) + 1
      }
    }
    return total
  }

  get pending(): number {
    return this._pending
  }

  get breakdown(): Record<string, { queued: number; running: number }> {
    const out: Record<string, { queued: number; running: number }> = {}
    for (const [kind, n] of Object.entries(this.queuedByKind)) {
      if (n > 0) out[kind] = { queued: n, running: 0 }
    }
    for (const [kind, n] of Object.entries(this.runningByKind)) {
      if (n > 0) {
        const e = (out[kind] ??= { queued: 0, running: 0 })
        e.running = n
      }
    }
    return out
  }

  async submit(job: Job): Promise<void> {
    this._pending++
    this.queuedByKind[job.kind] = (this.queuedByKind[job.kind] ?? 0) + 1
    await this.queue.add(job.kind, job, {
      priority: KIND_PRIORITY[job.kind],
    })
  }

  async drain(timeoutMs = 60_000): Promise<void> {
    const until = Date.now() + timeoutMs
    while (this._pending > 0 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  async stop(): Promise<void> {
    await this.worker.close()
    await this.queue.close()
  }
}
