# src/server/

The process that makes this a world rather than a script: it ticks on a
real-time cadence, persists as it goes, resolves cognition beside the loop, and
broadcasts state so a viewer can watch.

| Path | Holds |
|---|---|
| `engine.ts` | The entry point: boot, the interval, shutdown, signal handlers |
| `world/context.ts` | `World` — every long-lived thing the modules share |
| `world/feed.ts` | The live feed, the state snapshot, the WebSocket clients |
| `http/routes.ts` | The request handler, one table of endpoints |
| `http/agents.ts` | The agent card, and creating an agent |
| `http/owner.ts` | Briefing, dilemmas, guidance, owner registration |
| `http/respond.ts` | JSON helpers |
| `jobs/worker.ts` | The BullMQ queue on Redis |
| `jobs/handlers.ts` | What happens when each kind of job comes back |
| `jobs/llm-logger.ts` | Per-call JSONL log of prompt, response and usage |

## `engine.ts` owns the clock and nothing else

It wires things together and runs the interval. The world lives in
`world/context.ts`, the endpoints in `http/`, the cognition in `jobs/`.

The tick body is deliberately small: call the pure `tick()`, describe its events
onto the feed, hand its job descriptions to the queue, save on the hour,
broadcast. **It never awaits the queue** — if cognition lags, the world keeps
ticking on layer 1 and the scene resolves late.

## `World` is a holder, not a value

`state` is a mutable property rather than a module-level binding. The tick loop
and every cognition handler replace it wholesale with the result of a pure
reducer, and passing a holder is what lets those live in separate files without
one of them writing to a stale copy.

## Jobs

`worker.ts` is BullMQ capped at six concurrent calls. Each one spawns a CLI
process through dproxy and takes seconds, so **never fan out unbounded** — cap
concurrency and let the backlog drain across ticks.

Redis outliving the process is deliberate: pending jobs survive a restart and the
engine reports them at boot.

`handlers.ts` has one handler per route, all the same shape: rebuild the prompt
context from current state, call the route, fold the result in with a pure
reducer from `engine/apply/`, record it, publish a feed line. **A failure never
propagates** — a dropped scene degrades richness, and the world keeps running.

The scene handler is the one that must also `abandonScene` on failure, or two
agents are left standing in a conversation that will never resolve.

## Saving

Every in-game hour, not only at the midnight rollover. A daily save leaves the
database a whole game day behind what is running: a crash loses that day, and
anything reading the database shows a world that no longer exists.
