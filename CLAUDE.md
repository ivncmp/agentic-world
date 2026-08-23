# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**agentic-world** is a persistent multi-agent social simulation — a Habbo/Sims-style world where the human doesn't play, they *raise*. Each person authors their agent's personality, values and goals, releases it into a shared world, and the world runs 24/7 on its own. The human's gameplay loop is spectating (reading their agent's diary, watching the drama) and educating between sessions.

Relationships, rivalries, gossip and conflict are **emergent**, not scripted. They emerge from persistent memory: when two agents meet, the scene prompt is built from each one's `recall` about the other.

The owner never enters the world. They connect from outside with their own Claude, get asked a few pointed questions about who their agent should *be*, and send back guidance — never orders. See [The owner loop](#the-owner-loop); it is the differentiator.

Full concept and rationale: **[DESIGN.md](./DESIGN.md)** — read it before making architectural decisions.

**Status: pre-v0, simulation core runs headless.** What exists: agent schema, personality resolution, scene gate, and a working tick loop with utility AI, economy and scene queueing (`src/agents`, `src/cognition`, `src/engine`), plus Postgres + dbrain in `docker-compose.yml`. What does not: the cognition worker (nothing calls a model yet), persistence, the MCP server, any viewer. Update this line as that changes.

Toolchain: Node 22 + TypeScript throughout (`.tool-versions` pins it). `pnpm check` runs typecheck + tests.

## The central constraint: layered cognition

**This is the whole project.** You cannot make one LLM call per agent per tick — 100 agents would be ruinous within a day. Every design decision reduces to one question: *does this moment deserve intelligence, or does an `if` suffice?*

| Layer | Cost | Frequency | Responsibility |
|-------|------|-----------|----------------|
| **1. Reflex** | Free (pure TS) | ~95% of ticks | Utility AI / state machine. Hungry → bar. Work hours → office. Classic game dev, zero generative AI. |
| **2. Social** | Cheap (`claude-haiku-4-5`, or local Ollama) | Only when two agents co-locate *and* have interaction potential (they know each other, share history, have conflicting interests) | One call resolves the whole scene: what they say, how it ends, what each remembers. |
| **3. Reflection** | Expensive (`claude-opus-5`) | Once per agent per in-game night | Consolidate the day: compress memories, draw conclusions ("Marta lied twice, I don't trust her"), adjust goals. Straight from the Stanford paper. |

### Hard rules

These are not style preferences — violating them breaks the project's economics.

- **Never call an LLM inside the tick loop.** The tick loop is synchronous, deterministic, pure TypeScript. LLM work is queued and resolved out-of-band.
- **A scene must be gated before it costs anything.** The gate (`shouldTriggerScene`) is pure TS and runs on co-location. Only if it passes does a layer-2 call happen. Tune the gate before tuning the prompt.
- **Every LLM call is metered.** Log model, route, token usage and the agent it was attributed to. Cost *and* calls-per-window per agent are first-class metrics from v0, not an afterthought — see Risks below.
- **LLM resolution is a bounded, serialized queue.** Via dproxy each call spawns a `claude` CLI process (seconds, not milliseconds). Never fan out unbounded parallel scene resolutions — cap concurrency and let the backlog drain across ticks.
- **A tick must never block on the queue.** If scene resolution lags behind the tick rate, the world keeps ticking on layer 1 and the scene resolves late. Falling behind degrades richness, never correctness.
- **Layer 1 must be able to run the whole world alone.** If the LLM provider is down, agents keep eating, working and paying rent. Cognition degrades; the simulation does not stop.
- **Prefer widening layer 1 over deepening layer 2.** New behaviour should default to a rule. Escalate to a model only when the behaviour genuinely requires judgment or language.

### Model routing

Two routes behind one provider abstraction (switching is a config change, never a refactor):

| Route | Good for |
|-------|----------|
| **dproxy** (`POST /v1/ask`, Tailscale `http://100.115.51.71:7880`) | v0 default — runs on Claude subscription, ~14s/call, free |
| **Direct API** (`@anthropic-ai/sdk`) | Volume scenes once subscription quota is hit |

Rules:

- Load the `claude-api` skill before writing any Claude API call. Do not write model IDs from memory.
- Always send `memory/life/workspace/chatLog: false` on simulation calls.
- Keep calls **stateless** — never use `sessionId`/`continueSession`.
- Use only `POST /v1/ask` and `GET /v1/health` from dproxy. **Do not** use `/v1/memory/:key` (our dbrain) or `/v1/templates` (prompts in repo).

---

## Memory model (dbrain)

Each agent is a **dbrain entity** with its own memory graph. This is deliberate dogfooding: the project turns dbrain from "memory for Claude" into "memory engine for characters", and this use case stresses it harder than any other.

Three memory kinds, which must stay conceptually distinct:

| Kind | Example | Behaviour |
|------|---------|-----------|
| **Episodic** | "Today Juan didn't pay back the 50 credits" | Subject to **decay**. Untouched memories fade. The forgetting *is* the realism — do not make it lossless. |
| **Relational** | Per-known-agent score: affection, trust, debt | Updated by nightly reflection, not by individual ticks. |
| **Identity** | What the owner wrote at creation + what life added ("since the bankruptcy, distrusts banks") | Owner-authored core is stable; the accreted layer grows. |

Design consequences:

- **Never program a relationship.** Relationships emerge because memory persists. If you find yourself writing a `friendship` table with explicit state transitions, stop — that state belongs in relational memory updated by reflection.
- **Gossip is just second-hand memory transfer** between agents. Cheap mechanic, spectacular result. Second-hand memories should be marked as such (they can be wrong — that's a feature).
- Scene prompts are assembled from a bounded `recall` per participant. Bound it hard; unbounded recall is how the token bill explodes.

---

## Economy

Money is the **conflict generator**. Closed economy with sinks and sources. **The human never touches the money** — owner cannot inject or spend in-world. Jobs, rent, loans, businesses.

## Nightly reflection — layer 3

`src/cognition/reflection.ts` + `src/engine/apply-reflection.ts`. Once per agent per game day, at the midnight rollover (`isDayBoundary`, fires at 00:00). **Only writer of `values.drift`.**

Outputs: `diary` (first person, for the owner), `consolidated` (one memory replacing the day's noise), `drift` (±0.1 max per night, accumulates without limit), `relationships` (revised on reflection).

- **Consolidation is also decay.** `persistReflection` forgets everything episodic before the day's summary.
- Cost scales with **agent count, not activity** — one call each, every night.

## Persistence

Two stores, split by what the data is for — not by convenience.

| Store | Holds | Why there |
|---|---|---|
| **Postgres** (`src/persistence/`) | World state, event log, scenes, diaries | The tick loop reads and writes it every five minutes; the owner asks for a diary *by address* ("day 5"), which is a lookup, not a search |
| **dbrain** (`src/memory/dbrain-store.ts`) | Episodic and identity memory | Narrative text recalled by relevance, with tiering and decay already built |

**Diaries are in Postgres even though they are narrative.** The diary is *for the human* and is fetched by agent+day; the consolidated memory is *for the agent* and is fetched by relevance. Same reflection, two artefacts, two access patterns — putting them in one store forces one of them to use the wrong kind of lookup.

### Round-tripping

`dist/dev/persist-check.js` checks state-identical-after-reload *and* 50-further-ticks-agree. The second matters more — divergent evolution is worse than lost data. Gotchas: JSONB reorders keys (canonicalise), `openings` must be nullable (`NULL` = not a workplace, `0` = full), Postgres `NUMERIC` returns strings.

### The dbrain adapter

Maps onto dbrain's existing fields: memory kind → `fact.category`, subject → `fact.relatedEntities`, game tick → `fact.timestamp` (as real instants, not dates — regression test exists). `forget()` is a no-op; dbrain handles its own decay.

> All generated content is **English**, always. Mixed-language corpus stops matching itself in recall. Translation belongs at display time.

## The owner loop

Owner connects from outside via MCP (`get_briefing`, `get_open_dilemmas` → user's Claude → `submit_guidance`). Typed deltas feed the reflex layer; prose note goes to dbrain identity memory.

### Dispositions, not actions

**Guidance shifts values, priorities and constraints. It never selects the agent's next move.** Test: if the owner can predict what happens tomorrow, the question is wrong.

### Guidance is typed

`submit_guidance(agentId, { valueDeltas, priorities, constraints, note })`. Typed fields feed the reflex layer (free, every tick). `note` goes to dbrain identity memory. Free-text-only guidance would force an LLM call to interpret it.

### Rules

- Engine exposes actionable tensions (`get_open_dilemmas`); user's Claude phrases them; MCP server validates on return.
- **Guidance decays** on a half-life. **Cap cadence** (N questions/day). **Absent owner → falls back to authored personality.**
- User-supplied inference runs on the **user's subscription**, not the world's budget. Never let it drive ticks.

## Agent schema

Types live in `src/agents/` and are the source of truth — this section records *why*, not *what*. Read the code for field detail.

### Personality is three strata that sum

```
effective = clamp(base + drift + decayed guidance)
```

| Stratum | Author | Changes |
|---|---|---|
| `base` | The owner, at creation | Effectively never |
| `drift` | Life, via nightly reflection | Slowly, cumulatively |
| `guidance` | The owner, educating | **Decays** on a half-life unless reinforced |

**Drift may overpower base, deliberately.** Do not add a floor that protects the owner's original values.

### Seven value axes, not a personality model

`honesty · industriousness · thrift · sociability · riskTolerance · loyalty · pride`, each −1..+1.

Descriptive models (Big Five) are not usable here: an axis earns its place only if some decision in the reflex layer branches on it. Adding an axis means adding the behaviour that reads it.

### Vices are pulls, not low values

Exactly two per agent, mandatory — DESIGN.md's designed friction against the "bland soup" risk. A vice has a trigger location, a growing urge and a cost, so it feeds both the reflex layer (creates needs) and the gate (creates conflict).

The catalogue in `src/agents/vices.ts` is **closed but extensible**: `ViceKind` derives from the object's keys, so adding an entry widens the type while an arbitrary string still fails to compile. Free-text vices would need an LLM call to interpret, which the reflex layer cannot afford.

### Where each thing lives

| Data | Store | Why |
|---|---|---|
| Agent row, values, needs, money, position | Postgres | The tick reads and writes it every 5 minutes |
| **Relationship scores** (affection, trust, debt) | Postgres, denormalised | The gate reads them per co-located pair per tick; an HTTP hop to dbrain there would be ruinous |
| Episodic memories, identity narrative, owner notes | dbrain | The *why*, read only when building scene prompts |

Relationship numbers are a cache; dbrain is the source of truth for the narrative behind them. Nightly reflection writes both. **On divergence, dbrain wins.**

### The gate, and the real cost dial

`src/cognition/gate.ts` scores every co-located pair, then a budget decides what we actually pay for:

1. `scoreEncounter` — debt, strength of feeling (love *and* hate), goal conflict, a vice triggered by this location, time apart, noise, minus a damper for pairs who already spoke today.
2. `shouldTriggerScene` — threshold; discards mere co-location.
3. `selectScenes` — sorts by score and applies `maxScenesPerTick` / `maxScenesPerAgentPerDay`.

**Step 3 is the cost dial, not step 2.** Encounter density swings with where agents happen to be, so a threshold alone produces an unpredictable number of calls per day. The budget makes spend a decision rather than an emergent property. Tune volume here — never by making prompts cheaper.

`GateContext.random` is injected so ticks stay deterministic and testable. Keep it that way.

## The tick loop

`src/engine/tick.ts`. **A pure function** — `(state, deps) => { state, events, sceneJobs, reflectionJobs }`. No I/O, no awaits, no model calls; expensive cognition leaves as queued jobs. That is what makes the "never block the clock" rule enforceable rather than aspirational, and it makes a whole simulated day testable in milliseconds.

`deps.random` is injected. Keep it that way: determinism is what makes soak runs comparable across changes.

### Values become behaviour in exactly one place

`scoreActions` in `src/engine/actions.ts` is the only function where a value axis changes anything. **An axis that no branch in there reads is decoration** — adding one means adding the behaviour that consults it.

### `pnpm watch` — the village log

`src/dev/watch.ts`. Live text view: grid, agent table, event feed with full scene dialogue.

```
pnpm watch                      # engine only, a day in seconds
LLM=1 MAX_SCENES=6 pnpm watch   # with cognition; scenes cost 7-40s each
TICKS=140 MS=0 pnpm watch       # jump to a specific tick and stop
```

### `pnpm soak` — the bland-soup detector

`src/dev/soak.ts` runs a full game day headless (seeded, reproducible) and prints a village log plus histograms. Run it after any change to needs, action scoring or the economy.

### Design rules learned from simulation

All found by `pnpm soak` or diary reading, all fixed. The recurring shape: **a quantity that only moves one way eventually breaks the world.**

- **Rates are per hour, not per tick.** A tick is 5 minutes. A doctor paid per tick earned 92x rent/day.
- **Consumption actions need a threshold**, or they beat idling at trivial need levels and drain the economy.
- **Vice urge growth** is calibrated against `VICE_URGE_THRESHOLD` and 288 ticks/day for 1-3 firings/day.
- **Every need needs a consumer** — a decaying need with nothing to satisfy it is dead weight.
- **Fixing the economy killed the drama** until goals existed. A world where nobody is desperate is correct and dead.
- **Arrears still have no consequence.** An agent can reach 520 in unpaid rent and nothing happens — open bug.

**Feelings:** `src/engine/relationship.ts` prevents the absorbing-state problem (all pairs collapse to −1.00). `adjustFeeling` applies diminishing returns near extremes; `coolFeeling` drifts 3%/day toward neutral (~3-week half-life). **Any accumulating relationship number needs a route back to neutral.**

**Goals** (`src/agents/goals.ts`): derived from situation nightly, never stored. `savingDrive` raises work/job-seeking; `socialDrive` raises socialising. Aspirational sinks (e.g. `HOME_DEPOSIT` → buy home, housing cost drops 60%) fire around day 10-12.

**Distribution:** `sleepPull(hour)` adds circadian rhythm. Venues chosen per agent by home district + stable hash (not `firstOfKind`). Idle agents drift to public places by `sociability`. Per-pair damper halves at midnight (not clears). Judge idle by co-location and scenes/day, not by action share.

## Architecture

**Characters are data, cognition is a service.** Agents are not processes — no process per agent, no MCP client per agent. A character is a row in Postgres plus a graph in dbrain. The engine calls the model; the model never calls the engine.

- **MCP is for the human side** (owner loop), not the agent side.
- **Two persistence layers:** Postgres (world state) and dbrain (memories). Don't mix them.
- The browser is a *viewer* — no client authority.

### Layout

`src/`: `engine/` (tick, scheduler, clock), `agents/` (schema, reflex), `cognition/` (gate, LLM, prompts), `memory/` (dbrain adapter), `economy/`, `world/` (tilemap, locations), `mcp/` (owner-facing), `persistence/` (Postgres migrations), `viewer/` (Phaser 3 isometric).

### Stack

Node 22 + TypeScript, Postgres, dbrain, dproxy/direct API, Phaser 3 (viewer). `pnpm` with standard scripts (`dev`, `build`, `lint`, `format`, `check`).

---

## Deployment & portability

Runs 24/7 on **weepserver** (LAN, co-located with dbrain + dproxy + Postgres). Secrets stay on the box — never commit credentials.

Portability rules (this ships open source):

- **No hardcoded hosts, ports or IPs in `src/`.** Everything through env/config + `.env.example`.
- Provider and memory interfaces are public API — keep them small, ship two implementations each.
- No dtoolkit-wide dependency. MIT license.

## Conventions

- Commit messages in English, no `Co-Authored-By` lines, no GPG signing.
- Code and identifiers in English; the DESIGN.md and conversation are in Spanish.
- The tick loop is hot — keep it allocation-light and free of async I/O.
