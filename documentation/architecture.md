# Architecture

**Characters are data; cognition is a service.** An agent is not a process —
there is no process per agent and no model client per agent. A character is a
row in Postgres plus a memory graph in dbrain. The engine calls the model; the
model never calls the engine.

## The shape of a tick

```
                        ┌──────────────────────────────────────┐
   every TICK_MS ──────▶│  tick(state, deps) → pure function   │
                        │  needs · actions · movement · money  │
                        └───────────────┬──────────────────────┘
                                        │
            ┌───────────────────────────┼────────────────────────┐
            ▼                           ▼                        ▼
     new WorldState              WorldEvent[]              job descriptions
            │                           │                        │
            ▼                           ▼                        ▼
     saved to Postgres         feed + event log          Redis (BullMQ)
     hourly                                                      │
                                                                 ▼
                                                    ┌────────────────────────┐
                                                    │  CognitionWorker × 6   │
                                                    │  scene · reflection    │
                                                    │  deliberation · crisis │
                                                    └───────────┬────────────┘
                                                                │  model call
                                                                ▼
                                                    ┌────────────────────────┐
                                                    │ apply/* pure reducers  │
                                                    │ fold result into state │
                                                    └────────────────────────┘
```

`tick()` in `src/engine/tick.ts` takes `(state, deps)` and returns
`{ state, events, sceneJobs, reflectionJobs, deliberationJobs, crisisJobs }`.
No I/O, no `await`, no model calls. That is what makes "never block the clock"
enforceable rather than aspirational, and it makes a simulated day testable in
milliseconds.

`deps.random` is injected so two runs with the same seed agree. Determinism is
what makes a change comparable to the change before it.

## The cognition path

1. **The gate scores, the budget decides.** `src/cognition/gate.ts` scores every
   co-located pair on debt, strength of feeling, goal conflict, a vice triggered
   by this location, time apart and noise, minus a damper for pairs who already
   spoke today. `shouldTriggerScene` applies a threshold; `selectScenes` then
   applies caps per tick, per agent per day and per location per tick.
   **The caps are the cost dial, not the threshold** — encounter density swings
   with where agents happen to be, so a threshold alone yields an unpredictable
   number of calls per day.

2. **Jobs go on a bounded queue.** `src/server/jobs/worker.ts` is BullMQ on
   Redis, capped at six concurrent. Each call spawns a CLI process through
   dproxy and takes seconds, not milliseconds. Redis outliving the engine
   process is deliberate: pending jobs survive a restart and the engine reports
   them at boot.

3. **A pure reducer folds the result back.** `src/engine/apply/` holds one
   reducer per kind of result — `scene`, `reflection`, `deliberation`, and
   `action` for the reflex layer. They are pure `(state, …) => state`, so the
   handler that received a model response never mutates the world by hand.

4. **A queued scene has a deadline.** `SCENE_TIMEOUT_MS` (120s by default)
   becomes a tick count. Set it below a real call duration and every
   conversation is abandoned before it arrives, then applied to two agents who
   already walked away.

## Two stores, split by access pattern

| Store | Holds | Why there |
|---|---|---|
| **Postgres** | World state, event log, scenes, diaries, LLM call metering | The tick reads and writes it constantly, and the owner asks for a diary *by address* ("day 5") — a lookup, not a search |
| **dbrain** | Episodic and identity memory | Narrative text recalled by relevance, with tiering and decay already built |

**Diaries live in Postgres even though they are narrative.** The diary is *for
the human* and is fetched by agent and day; the consolidated memory is *for the
agent* and is fetched by relevance. Same reflection, two artefacts, two access
patterns — putting both in one store forces one of them into the wrong kind of
lookup.

**Relationship numbers are a denormalised cache** in Postgres, because the gate
reads them for every co-located pair every tick and an HTTP hop to dbrain there
would be ruinous. dbrain holds the narrative that explains those numbers.
Nightly reflection writes both; on divergence, dbrain wins.

## Module map

| Directory | Holds |
|---|---|
| `src/engine/` | `tick.ts` (the pure loop), `actions.ts` (utility AI), `clock.ts`, `relationship.ts`, `crisis-detect.ts`, and `apply/` (the reducers) |
| `src/agents/` | Schema, values, needs, vices, goals, identity, creation |
| `src/cognition/` | `gate.ts`, the four routes, `provider.ts`, `json.ts` |
| `src/memory/` | `store.ts` interface, with dbrain and in-memory implementations |
| `src/world/` | City generator, layout, locations, occupations, baked cities |
| `src/persistence/` | Pool, three repositories, numbered SQL migrations |
| `src/server/` | `engine.ts` (entry), `world/` (context + feed), `http/` (routes), `jobs/` (worker + handlers) |
| `src/mcp/` | The owner-facing MCP server |
| `src/viewer/` | `scene/`, `core/`, `ui/` |
| `src/dev/` | One-off maintenance scripts, run after `pnpm build` |

There is no `economy/` directory. Money lives in the agent row and is moved by
`applyAction` in `src/engine/apply/action.ts`.

## The engine's HTTP surface

One plain `node:http` server on `:7070` serves both the viewer and the owner
loop:

| Method | Path | For |
|---|---|---|
| GET | `/world` | The static city — fetched once when the viewer boots |
| GET | `/state` | Current snapshot plus recent feed |
| GET | `/agent?id=` | The agent card: values, vices, needs, relationships, diaries |
| GET | `/rel-graph` | Who knows whom, and how they feel |
| GET | `/metering` | Cost and token totals per agent |
| GET | `/health` | Liveness, current tick |
| GET | `/briefing?id=&token=` | Owner loop: where the agent stands |
| GET | `/dilemmas?id=&token=` | Owner loop: actionable tensions, most severe first |
| POST | `/agents` | Create an agent (admin secret) |
| POST | `/guidance` | Submit typed owner guidance |
| POST | `/register_owner` | Mint an owner token (admin secret) |
| WS | `/live` | State and feed items, pushed every tick |

**The MCP server is a client of these.** It holds no world state of its own,
which is what keeps the owner loop from becoming a second source of truth.

## Provider abstraction

`src/cognition/provider.ts` defines `ModelProvider` — one method, `complete`.
The dproxy implementation shells out through a local CLI proxy; a direct API
implementation slots in behind the same interface. Switching is configuration,
never a refactor.

The provider sets its **own system prompt**. The CLI it shells out to carries an
assistant persona that declines to voice a character's vice or write their
private thoughts — and the refusal text would otherwise land in an agent's
diary as something they thought. Overriding the system prompt makes the
simulation the job rather than an odd request made of a coding assistant.

`src/cognition/json.ts` centralises pulling the JSON object out of a response:
models answer bare, fenced in ```json, or with a sentence of preamble, and each
route used to reimplement the extraction and break independently.
