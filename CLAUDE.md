# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**agentic-world** is a persistent multi-agent social simulation — a Habbo/Sims-style world where the human doesn't play, they *raise*. Each person authors their agent's personality, values and goals, releases it into a shared world, and the world runs 24/7 on its own. The human's gameplay loop is spectating (reading their agent's diary, watching the drama) and educating between sessions.

Relationships, rivalries, gossip and conflict are **emergent**, not scripted. They emerge from persistent memory: when two agents meet, the scene prompt is built from each one's `recall` about the other.

The owner never enters the world. They connect from outside with their own Claude, get asked a few pointed questions about who their agent should *be*, and send back guidance — never orders. See [The owner loop](#the-owner-loop); it is the differentiator.

Full concept and rationale: **[DESIGN.md](./DESIGN.md)** — read it before making architectural decisions.

**Status: pre-v0, simulation core runs headless.** What exists: agent schema, personality resolution, scene gate, and a working tick loop with utility AI, economy and scene queueing (`src/agents`, `src/cognition`, `src/engine`), plus Postgres + dbrain in `docker-compose.yml`. What does not: the cognition worker (nothing calls a model yet), persistence, the MCP server, any viewer. Update this line as that changes.

Toolchain: Node 22 + TypeScript throughout (`.tool-versions` pins it). `pnpm check` runs typecheck + tests.

## Prior art

- **"Generative Agents" (Stanford, 2023)** — Smallville. Source of the memory + retrieval + nightly-reflection pattern. Steal the architecture.
- **AI Town (a16z)** — open-source implementation of the same idea, on Convex.
- **Our differentiator:** every agent belongs to a real person who tends it from outside. That is the game; don't lose it while chasing simulation fidelity.

---

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

There are three routes to a model, with different economics. Both sit behind the same provider interface.

| Route | What it is | Cost shape | Good for |
|-------|-----------|-----------|----------|
| **dproxy** | `dproxy serve` on weepserver (REST, `:7880`, `POST /v1/ask`). Shells out to the Claude Code CLI, so it runs on the **Claude subscription**. | ~zero marginal tokens, but bounded by **subscription rate limits** and slow (process spawn per call) | Nightly reflection — low volume, high value, latency-tolerant |
| **Direct API** | `@anthropic-ai/sdk` with an API key | Pay per token, high throughput, low latency | Social scenes at volume, once the prototype outgrows the subscription |
| **Local Ollama** | Dropped by decision — not used | — | — |

Model IDs when going direct: `claude-haiku-4-5` ($1 / $5 per MTok) for scenes, `claude-opus-5` ($5 / $25) for reflection.

**v0 decision: everything goes through dproxy** at `http://100.115.51.71:7880` (weepserver over Tailscale). One provider, no local models. Measured and accepted with eyes open — see Measured baseline below.

Rules:

- **All model calls go through one provider abstraction.** dproxy ↔ API ↔ Ollama must be a config change, never a refactor. This interface is load-bearing — see the ToS note under Deployment.
- Never hand-roll HTTP against the Anthropic API; use the official SDK on the direct route.
- Before writing or changing any Claude API call, load the `claude-api` skill — it carries current model IDs, parameter shapes and pricing. Do not write model IDs from memory.
- Always send `memory/life/workspace/chatLog: false` on simulation calls — dcontext injection is for coding sessions and is pure overhead here.
- Keep calls **stateless**. Never use `sessionId`/`continueSession` to fake agent memory: that is dbrain's job, and it would grow context without bound.

### dproxy surface: what we use, and what we deliberately don't

Canonical address is the **Tailscale IP**, `http://100.115.51.71:7880`. The LAN address `192.168.1.80` found in older Ingeniorum notes is stale — verified unreachable on that subnet even from a host sitting on it. The tailnet is the perimeter, which is what makes the server's `0.0.0.0` bind and cleartext bearer token acceptable; if dproxy is ever exposed beyond the tailnet, move it to `127.0.0.1` behind a tunnel.

We use `POST /v1/ask` and `GET /v1/health`. Two other endpoints exist and must **not** be used:

- **`/v1/memory/:key`** — dproxy's own memory. Agent memory belongs in our dedicated dbrain, reached directly. Using both would split the source of truth.
- **`/v1/templates`** — server-side prompt templates. Our prompts live in this repo, in version control. Prompts stored on weepserver would be invisible state that an open-source clone silently lacks.

### Measured baseline (2026-08-19, real call against weepserver)

A scene-resolution prompt (2 agents, debt conflict, JSON schema requested) via `POST /v1/ask`:

| Metric | Value |
|---|---|
| Wall clock | **14.3 s** |
| `costUsd` | **$0.057** |
| Real input / output | 3 / 538 tokens |
| `cache_creation` + `cache_read` | **24,542 tokens** |
| Model served | `claude-sonnet-4-6` (+ a Haiku auxiliary call) |

Two conclusions, both load-bearing:

1. **JSON works without structured outputs.** Asking for *"ONLY a JSON object, no prose, no markdown fences"* returned valid parseable JSON first try — no regex extraction needed. Still parse defensively and retry: there is no schema guarantee, only a well-behaved model.
2. **Per-call overhead is ~24.5k tokens and constant.** That is the Claude Code harness itself; `memory/life/workspace/chatLog: false` trims only ~4.7k of it. Useful payload was ~540 tokens — a ~45x overhead ratio. Scene resolution (small prompt, small output, high frequency) is the worst-case shape for a CLI-wrapping proxy. The same scene on the direct Haiku API would be roughly $0.003 and sub-second: ~17x cheaper, ~10x faster.

**weepserver's Claude Code runs on the subscription, not an API key** (confirmed). So `costUsd` is *notional* — nothing is billed. Read those figures as a proxy for quota burn, not spend.

That makes dproxy the clear v0 winner: ~30 calls/day costs nothing real, and 14 s per scene is invisible against 5-minute ticks. The direct Haiku API would be ~17x cheaper *per token* but that is ~$3/month of real money versus $0 — not a trade worth making at this scale. What you actually pay is **latency and quota**: ~735k tokens/day of overhead at 10 agents, ~7.35M at 100.

**dproxy-only is right for v0.** The provider abstraction is what makes growing out of it a config change rather than a rewrite — and the trigger to switch is a rate-limit wall or an interactive path that cannot wait 14 s, not a bill.

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

Fictional money is not decoration — it is the **conflict generator**. Without scarcity, agents are pleasant to each other and nothing happens (see "bland soup" under Risks).

- Jobs with differing wages.
- Rent/mortgage that must be paid → a delinquent agent generates drama automatically.
- Businesses agents can start.
- Peer-to-peer loans, with relational trust as collateral.

It's a closed economy: design **sinks and sources** so it doesn't hyperinflate, same as any MMO.

**The human never touches the money.** Agent earnings unlock things for the owner (cosmetics, land, a second agent), but the owner cannot inject or spend currency in-world. They influence only by educating — see The owner loop below for what "educating" is allowed to mean. This keeps the experiment honest; protect this boundary.

---

## Nightly reflection — layer 3

`src/cognition/reflection.ts` + `src/engine/apply-reflection.ts`. Once per agent per game day, at the midnight rollover.

**This is the only writer of `values.drift`.** Before it existed the three-strata personality model was really two: `base` and `guidance` moved, and the stratum recording *what living did to someone* stayed zero forever. An agent could not be changed by their own life.

What a night produces:

| Output | Where it goes |
|---|---|
| `diary` | First person, past tense — what the owner reads in the morning. The owner's main interface, per DESIGN.md. |
| `consolidated` | One memory that replaces the day's episodic noise |
| `drift` | Lasting shifts in character, capped at ±0.1 a night |
| `relationships` | Considered revisions on reflection, beyond the per-scene deltas |

Two rules worth keeping:

- **A day nudges, it does not remake.** `MAX_DRIFT_PER_NIGHT = 0.1`. But drift *accumulates without limit*, so eight consistent nights can outweigh how an owner authored someone — deliberately. See the test that fixes this.
- **Consolidation is also decay.** `persistReflection` writes the day's one keepable memory and then forgets everything episodic that came before. DESIGN.md is explicit that the forgetting *is* the realism: a lossless agent behaves like a ledger, not a person.

Cost scales with **agent count, not activity** — one call each, every night, whatever happened. That is the one part of the cost model no gate can reduce, and it is what will break first at 150 agents (see the measured baseline).

> Naming note: the day rollover is `isDayBoundary`, not `isNightfall`. It fires at 00:00, not at dusk — the old name described a time of day the code never meant.

## Persistence

Two stores, split by what the data is for — not by convenience.

| Store | Holds | Why there |
|---|---|---|
| **Postgres** (`src/persistence/`) | World state, event log, scenes, diaries | The tick loop reads and writes it every five minutes; the owner asks for a diary *by address* ("day 5"), which is a lookup, not a search |
| **dbrain** (`src/memory/dbrain-store.ts`) | Episodic and identity memory | Narrative text recalled by relevance, with tiering and decay already built |

**Diaries are in Postgres even though they are narrative.** The diary is *for the human* and is fetched by agent+day; the consolidated memory is *for the agent* and is fetched by relevance. Same reflection, two artefacts, two access patterns — putting them in one store forces one of them to use the wrong kind of lookup.

### What round-tripping actually has to prove

`dist/dev/persist-check.js` checks two things, and the second is the one that matters:

```
state identical after reload : yes
50 further ticks agree       : yes
```

A world that reloads with the right numbers but then *evolves differently* is worse than one that forgets, because the divergence is invisible until the story stops making sense.

Two traps found doing it:

- **JSONB reorders object keys**, so a `JSON.stringify` comparison reports a difference where the data is identical — it looks exactly like a persistence bug and is not one. The check canonicalises key order.
- **`openings` needed to be nullable.** Storing `0` for every location made all eight homes look like workplaces with no vacancies. `NULL` means "not a workplace"; `0` means "a workplace that is full".
- Postgres returns `NUMERIC` as a **string** to protect precision — money needs `Number()` on the way back.

### The dbrain adapter is shaped by dbrain, not by us

dbrain has **no free-form tags**. The adapter maps onto the fields it does have rather than inventing a tag convention inside the fact text, which would make the facts unreadable in dbrain's own dashboard and defeat the point of dogfooding it:

| Ours | dbrain |
|---|---|
| memory kind | `fact.category` (`episodic` / `identity` / `hearsay`) |
| who it is about | `fact.relatedEntities` — the graph edge dbrain already models |
| game tick | `fact.timestamp`, as a real instant |

Ticks map to instants (5 real minutes each) rather than dates. An earlier version rounded to whole days and silently collapsed every memory formed on the same day to one timestamp, losing recall ordering — there is a regression test for it.

`forget()` is deliberately a **no-op**: dbrain has its own tiering and compaction, and deleting facts underneath it would fight its decay model instead of using it. Consolidation still happens, because reflection writes one summary fact a day.

> All generated content is **English**, always — both prompts say so and say why. Memories are recalled and compared against each other, so a mixed-language corpus stops matching itself. Translation belongs at display time.

## The owner loop

This is the project's differentiator, and DESIGN.md left it as an open question. It is now decided.

The owner connects **from outside the world** with their own Claude (or any MCP client). The world's MCP server hands over structured state; the user's Claude turns it into a conversation, asks the human a few pointed questions, and sends back **guidance** — which becomes part of who the agent is.

```
world MCP  ──get_briefing / get_open_dilemmas──▶  user's Claude
                                                      │ converses with the human
world MCP  ◀──────────submit_guidance────────────────┘
     │
     └─▶ typed deltas → reflex layer (free, every tick)
         prose note   → identity memory in dbrain → scene prompts
```

### The rule that makes it work: dispositions, not actions

**Guidance shifts values, priorities and constraints. It never selects the agent's next move.**

| Wrong (owner is playing) | Right (owner is raising) |
|---|---|
| "A. rob someone  B. get a job  C. sell the house" | "A. 'Honesty matters more than eating'  B. 'Do what you must, we'll fix it later'  C. 'Ask Juan for help even if it's humiliating'" |

The second form doesn't tell the agent to steal — it moves a weight. She may not steal anyway. Another agent may act first and make it moot. Advice can *backfire*, and reading about that tomorrow is the product.

**Test for a well-formed question: if the owner can predict what happens tomorrow, it's wrong.** An owner who selects actions is playing a slow turn-based game, and emergence — the entire claim of this project — is dead.

### Guidance must be machine-readable

Free-text guidance would force an LLM call inside the world to interpret it, reintroducing cost into the loop we work hardest to protect. So `submit_guidance` is **typed**, with prose as an extra channel rather than the payload:

```ts
submit_guidance(agentId, {
  valueDeltas:  { honesty: +0.3, riskTolerance: -0.2 },
  priorities:   ["seek_employment"],
  constraints:  ["no_theft"],
  note:         "free text → identity memory in dbrain",
})
```

- **Typed fields feed the reflex layer** — honoured in pure TS, every tick, zero cost. Non-negotiable: guidance that only exists in prose cannot influence the 95% of ticks where the agent actually lives.
- **`note` goes to identity memory** in dbrain and enriches scene prompts.

### Who authors the question

Don't let the user's Claude invent options freely — it will offer "move to another city" when there is one neighbourhood. Split it:

- **The engine exposes live, actionable tensions** (`get_open_dilemmas`): the situation, the relevant behavioural history, and the levers that actually exist in-world.
- **The user's Claude phrases them** as a conversation and handles nuance.
- **The MCP server validates on the way back** — guidance outside the possible space is rejected or normalised.

### Second-order rules

- **Guidance decays**, like episodic memory. Otherwise agents accumulate an ever-growing rulebook and stop surprising anyone. Decay also makes educating continuous rather than one-shot — which is the retention loop.
- **Cap the cadence** (N questions/day). Without a cap an intensive owner micromanages, and micromanaging is playing.
- **An absent owner must still have an interesting agent.** No guidance → falls back to authored personality. Never punish absence with a boring agent.

### Why this is the right place for user-supplied inference

The expensive cognitive work — reading context, understanding it, formulating good questions — runs on the **user's own subscription**, not the world's budget. It is naturally rate-limited by human attention, it is ToS-clean (their Claude, their agent), and for an open-source deployment it means an operator never has to fund their users' advisory layer.

This **replaces** "bring your own agent brain" as the way users plug their own model in. Do not let user-supplied inference drive ticks — that is the 2,880-calls/day trap. It drives advice, which is bounded by design.

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

Keeping them separate is what makes creation, education and lived experience individually visible and revisable. It also gives the owner loop's `valueDeltas` something concrete to add to.

**Drift may overpower base, deliberately.** An agent whose life contradicts how its owner wrote it is the story working. Decided explicitly; do not add a floor that protects the owner's original values.

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

### `pnpm watch` — the debug frontend, and the actual v0 deliverable

`src/dev/watch.ts`. A live text view of the neighbourhood: the isometric grid with agents on their tiles, a table of who is doing what and where, and a feed carrying events and full scene dialogue. **This is DESIGN.md's "village log"** — the v0 product, not a developer convenience. If the drama does not grip here, in ASCII, no isometric renderer will save it.

```
pnpm watch                      # engine only, a day in seconds
LLM=1 MAX_SCENES=6 pnpm watch   # with cognition; scenes cost 7-40s each
TICKS=140 MS=0 pnpm watch       # jump to a specific tick and stop
```

Cognition is opt-in because each scene costs real seconds against dproxy. With it on, the world pauses while a pair talks — honest, since those two are frozen in-world too.

Design rule for this view: **make wrongness visible, not plausible.** It shows the *direction* of a money transfer rather than the amount, because a reversed sign that reads fine is worse than one that looks obviously wrong.

Three views, three questions: `watch` asks *does this look like a real place?*, `soak` asks *is the world alive?*, `diary` asks *is any one life worth following?* The third found three bugs the second had called healthy for days.

### `pnpm soak` — the bland-soup detector

`src/dev/soak.ts` runs a full game day headless (seeded, reproducible) and prints a village log plus histograms. Run it after any change to needs, action scoring or the economy. Three real bugs were found this way and by nothing else:

- **Theft scored on dishonesty alone** (added instead of multiplied by desperation), so any crooked agent robbed on every idle tick: 661 thefts a day. Desperation and dishonesty must intersect.
- **Theft left no grievance**, so it was invisible to the gate and the social layer could never dramatise it. Thefts now damage trust/affection and add debt.
- **`interactionsToday` was hardcoded to 0**, so the repeat-conversation damper never fired and one pair burned five scenes in 75 minutes.

The log is also the evidence the design works: a theft at 03:49 produced the day's highest-tension scene at 04:00, a retaliation at 04:09, and the same pair still feuding at midnight — with no LLM involved.

### Balance: what the soak taught us

Four bugs of the same shape, found only by simulating:

| Bug | Symptom | Rule it taught |
|---|---|---|
| Wage paid **per tick**, not per hour | A doctor earned 92x rent per day | Quoted rates are per hour; a tick is 5 minutes |
| `eat` had no satiation threshold | Agents ate 13x/day at 8% hunger | **Consumption actions need a threshold**, or they beat idling at trivial need levels and drain the economy |
| Vice urges grew ~10x too fast | 11 indulgences/day at 40-60 credits each | Urge growth is calibrated against `VICE_URGE_THRESHOLD` and 288 ticks/day for **1-3 firings a day** |
| `hygiene` decayed with nothing to satisfy it | Dead need | Every need needs a consumer |

**Fixing the economy killed the drama** before goals existed: idle went 39% → 60% and scenes 17 → 7. A world where nobody is desperate and nobody wants anything is correct and dead. That is what goals are for.

Still open: **arrears have no consequence.** An agent can reach 520 in unpaid rent and nothing happens — no eviction, no collection, no bailiff. The downward spiral is currently just a number going up.

### Feelings need a way back — the fifth bug of the same shape

Found by reading the agent cards in the viewer, not by the soak. By day 8 the village had collapsed into mutual hostility: of 56 pairs exactly **one** was warm, **eleven** sat at exactly −1.00, and the rest were slightly negative.

The cause was structural rather than a tuning miss. `grievance` decayed daily; `affection` and `trust` only ever had deltas *added* and were then clamped. The gate selects for conflict, conflict scenes subtract, and nothing ever added back — so the only available direction was down, and the clamp made the floor an **absorbing state**. Worse, it destroyed ordering: three different people at exactly −1.00 means the world can no longer tell "annoyed" from "mortal enemy", and neither can the scene prompt that reads the number back.

`src/engine/relationship.ts` fixes both halves, and every writer of a feeling now goes through it:

- **`adjustFeeling`** — diminishing returns near the extremes. Pushing further out is damped by `1 − |current|`; pulling back toward neutral is never damped, because forgiving is not made harder by having hated hard.
- **`coolFeeling`** — 3% a day toward neutral, a half-life of about three weeks. This is what makes the floor escapable.

Two lessons worth keeping:

- **The soak cannot catch this.** It runs without cognition, so scene deltas never apply and the spiral never forms. The soak asks *is the world alive?*; it does not ask *is the drama varied?* A world uniformly hostile looks healthy in every histogram it prints.
- **Any accumulating relationship number needs a route back to neutral.** This is the same bug as the four above — a quantity that only moves one way — and it is the one to check first when a new number is added.

### Goals are the keystone

`src/agents/goals.ts`. Derived from situation nightly, never stored, so they cannot drift from the world. Without them:

- A comfortable agent wants nothing, so it idles and its money piles up
- The gate scores a `goalConflict` that can never happen
- The owner loop has nothing to advise about

`savingDrive` raises work and job-seeking and stiffens resistance to costly vices; `socialDrive` raises socialising. Two jobless agents of one trade chasing one vacancy is the cleanest conflict source in the world.

Aspirational sinks are where surplus goes: at `HOME_DEPOSIT` an agent buys their home and their housing cost drops to 60%. Measured: fires around day 10-12 for the highest earners.

### The day needs a clock, and the city needs neighbourhoods

Two distribution bugs, both invisible in aggregate and obvious the moment you read one agent's diary:

**No circadian rhythm.** Sleep was purely need-driven, so agents napped every ~8h regardless of the hour, never slept through a night, and spent 19h–06h milling about in public. `sleepPull(hour)` now lets the clock push on its own: 23h–06h sleep wins even when rested, 10h–18h resists napping even when tired. Nights went from ~13 sleep actions an hour to ~1,300, and the action mix landed at a believable 33% work / 29% sleep / 27% idle.

**One venue per kind.** `firstOfKind` sent every agent to `park-1`, `bar-1` and so on, so 21 of 30 public places were unreachable and all eight agents lived in one square. Venues are now chosen per agent, preferring their **home district** and falling back to a stable hash — habitual haunts, not random wandering. Locations in use went 9 → 30, and an agent now sees 4-5 others a day instead of all 7.

Spreading agents out costs scenes (20.6 → 12.3 a day) and that trade is worth taking: repeat encounters with the same neighbours are what let relationships form at all. **A community, not a crowd.**

**The midnight burst.** Clearing the per-pair damper at nightfall released every damped pair at once — ~80% of the day's scenes fired in hour 0. It now halves instead of clearing.

### Idling should move

Idle stays around half of all actions, and that is fine — what was not fine was idling *in place*, which produces no encounters and no story. An unmotivated agent now drifts to a public place chosen by `sociability`: sociable to the bar, solitary to the park. That single change nearly doubled co-located pair-ticks (3504 → 6621) and took scenes from 14.7 to 17.7 a day.

**Judge idle by co-location and scenes per day, not by its share of actions.**

## Architecture

```
Server (authoritative)          Consumers
┌──────────────────────┐        ┌──────────────────┐
│ tick engine (pure TS)│───WS──▶│ v0: text feed    │
│ layer 1 reflex       │        │ phase 2: Phaser  │
│ scene queue ─▶ LLM   │        └──────────────────┘
│ nightly reflection   │
│ economy              │        ┌──────────────────┐
├──────────────────────┤◀─MCP──▶│ owner's Claude   │
│ SQLite (world state) │        │ (briefing/advice)│
│ dbrain (memories)    │        └──────────────────┘
└──────────────────────┘
```

**The reframe that decides everything: characters are data, cognition is a service.**

"Agent" is two different things, and conflating them wrecks the cost model:

| | What it is | Where it lives | Cost |
|---|---|---|---|
| **The character** | Position, money, needs, memory, identity | Rows the engine owns | Free |
| **The cognition** | "What does this character say in this ambiguous moment?" | A service the engine invokes | Expensive — hence rationed |

Consequences:

- **Agents are not processes and do not connect to the world.** There is no process per agent, no MCP client per agent, no connection to hold open. A character is a row in SQLite plus a graph in dbrain.
- **The engine calls the model; the model never calls the engine.** Cognition is invoked at gated moments, not subscribed to the tick.
- **MCP's role is the human side, not the agent side** — the owner loop above. Agents driven by MCP tool calls would mean one LLM call per agent per tick (~2,880/day at 10 agents on 5-minute ticks) versus ~30/day for gated scenes plus nightly reflection. Two orders of magnitude, and the reflex layer would have nowhere to live.
- **The world is a pure server-side simulation.** No rendering, no client authority. The browser is a *viewer*.
- **Two persistence layers, distinct responsibilities.** SQLite holds world state (positions, economy, jobs, buildings, tick counter). dbrain holds memories. Do not put memories in SQLite or world state in dbrain.
- **The v0 UI is a text feed** — a "village log". If emergent drama is gripping in plain text, the game works; if not, no amount of pixel art saves it. The Phaser viewer is phase 2 and should not be started early.

### Intended layout

```
agentic-world/
├── src/
│   ├── engine/       # tick loop, scheduler, world clock
│   ├── agents/       # agent schema, reflex layer (utility AI / FSM)
│   ├── cognition/    # scene gating, LLM provider abstraction, prompts
│   ├── memory/       # dbrain adapter: episodic / relational / identity
│   ├── economy/      # wages, rent, loans, sinks & sources
│   ├── world/        # tilemap, locations, co-location queries
│   ├── mcp/          # owner-facing MCP server: briefing, dilemmas, guidance
│   └── persistence/  # SQLite schema + migrations
├── DESIGN.md
└── CLAUDE.md
```

---

## Stack

| Layer | Choice |
|-------|--------|
| Simulation | Node.js + TypeScript (server-side tick engine) |
| Memory | dbrain (MCP / direct API), co-located on weepserver |
| LLMs | Routed — see Model routing above (dproxy / direct API / Ollama) |
| World persistence | SQLite (state, economy, positions). Postgres is available on weepserver if single-writer SQLite ever becomes the bottleneck — it won't in v0. |
| Viewer (phase 2) | Phaser 3, isometric, WebSocket |

Follow the Ingeniorum workspace conventions: `pnpm`, and the standard script names (`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm format`, `pnpm check`). Update this section with the real commands once `package.json` exists.

---

## Deployment: weepserver

The simulation is designed to run 24/7, so it lives on **weepserver** (`192.168.1.80`, LAN) rather than a laptop. The dtoolkit services are already there and co-located:

| Service | Role in this project |
|---------|---------------------|
| **dbrain** | Agent memory graph — the backbone. LAN-local, so the two `recall`s per scene are cheap. |
| **dproxy** | Model routing over the Claude subscription (`dproxy serve`, `:7880`). |
| **dwork** | Task/backlog tracking for the project itself. |
| **dcontext** | Session context injection. |
| Postgres | Available; not used in v0. |

Consequences to keep in mind:

- **It's a private LAN address.** Nothing is publicly reachable. Once friends need to read their agents' diaries, that needs a tunnel (Tailscale / Cloudflare Tunnel) or a separately hosted frontend — this is real work, don't discover it late.
- **Co-location is the point.** Simulation, memory and model routing on one box means dbrain calls are sub-millisecond. Don't split them across machines without a reason.
- **Secrets stay on the box.** Never commit credentials or connection strings to this repo.

### On using the subscription via dproxy

Routing through dproxy means the Claude Code subscription pays for inference instead of API billing. In the PoC every agent belongs to us — the "users" are fake profiles we author ourselves — so this is the subscriber's own use and there is no third party in the loop. That keeps it clean.

Two constraints remain, and they are engineering constraints, not legal ones:

1. **The ceiling is quota, not dollars.** Rate limits replace the cost curve. A 24/7 simulation with a per-agent nightly reflection will find that ceiling; measure calls-per-window from day one.
2. **It's slow.** Process spawn per call, so think seconds. Fine for nightly reflection, wrong for anything a human waits on.

The line to watch is **who the agents belong to**. Our own profiles on our own subscription is personal use. A hosted instance where other people's agents live would not be, and that is not a thing this repo should grow into by accident — anyone running it publicly brings their own API billing.

## Open source: portability is a design constraint

This ships open source. Each operator brings their own infrastructure and their own model access. That makes portability a constraint on the code, not a packaging afterthought:

- **weepserver is our reference deployment, not the deployment.** No hardcoded hosts, ports, paths or IPs anywhere in `src/`. Everything through env/config, with a committed `.env.example`. A stranger cloning this repo must be able to run the world on a laptop.
- **The provider interface is public API.** It was already load-bearing for cost reasons; now it is also the seam every adopter will reach for. Document it, keep it small, and ship at least two working implementations (dproxy and one of API/Ollama) so it is proven to be a real abstraction and not a shape fitted to one backend.
- **Memory needs the same treatment.** dbrain stays the reference implementation and the thing we dogfood — that is half the point of the project, per DESIGN.md, and it does not change. But a hard dbrain dependency is a steep adoption barrier for someone who just wants to watch agents argue. Put episodic/relational/identity behind a `MemoryStore` interface with dbrain as the default implementation. Dogfooding survives; the barrier doesn't.
- **No dtoolkit-wide dependency.** Depend on the specific packages actually used, not the monorepo.
- **Secrets never enter the repo.** No connection strings, no keys, no LAN addresses in committed code.
- **License:** MIT, matching dtoolkit — confirm before first public push.

## v0 scope (4–6 weeks of spare time)

Deliberately small. Resist scope creep — the point is to find out whether emergent drama is compelling.

- One neighbourhood: 1 tilemap, 6–8 locations (home, bar, office, shop).
- ~10 agents, all from **fake profiles we author ourselves**. No external users in the PoC. This is an advantage, not a compromise: we control every personality, so we can deliberately author agents with incompatible goals and mandatory vices to stress-test the "bland soup" risk head-on instead of hoping drama shows up.
- Tick every 5 real minutes; one game day = one real day.
- Cognition: reflex layer in pure TS + social scenes on Haiku + nightly reflection.
- **No graphics.** Text feed only.
- dbrain as the memory backend from day one — it is half the point of the project.
- **The owner loop ships in v0.** It is the differentiator, so it cannot be deferred to "later" — a v0 that only spectates hasn't tested the actual product. Convenient sequencing: since every profile is ours and we're on the LAN, the MCP server can be local-only. Auth and public exposure are a multi-user problem, not a v0 one.

## Risks to keep in view

1. **Throughput per agent per day.** Measure from v0. Working estimate: ~10–20 small calls + 1 reflection per agent per day. On dproxy the binding limit is subscription quota and process-spawn latency; on the API it's dollars. Either way the fix is the same: more local Ollama, less cloud, and a tighter scene gate.
2. **Bland soup.** The real risk: every agent is nice to everyone and nothing happens. Requires *friction by design* — scarce resources, mutually incompatible goals, and mandatory character flaws (creators must pick 2 vices, not just virtues).
3. **Moderation.** Not a PoC problem — we author every profile. It becomes real the moment anyone else can write a personality, and it is a known cost of going multi-user. Anyone running a public instance owns this; don't design it in as though it were free.

## Open questions

These are unresolved by design — flag them rather than quietly deciding:

1. **Tick engine + agent schema.** What fields make up a personality, what exactly a tick does, when a social scene fires. This is the heart, and it's prototypable in a weekend with hardcoded agents and zero graphics.
2. ~~The human's exact role.~~ **Resolved** — see The owner loop. What remains open is tuning: how many questions per day, how fast guidance decays, and how the engine picks which tensions are worth surfacing.
3. **dbrain memory format for agents** (episodic / relational / identity) and a real per-agent cost estimate.

## Conventions

- Commit messages in English, no `Co-Authored-By` lines, no GPG signing.
- Code and identifiers in English; the DESIGN.md and conversation are in Spanish.
- The tick loop is hot — keep it allocation-light and free of async I/O.
