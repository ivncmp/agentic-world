# Design

**This is the *why* document.** It explains the bets the project is built on and
what running the simulation taught us about them. For *what it is and how to run
it*, see [README.md](./README.md). For *how to work on the code*, see
[CLAUDE.md](./CLAUDE.md).

The original brainstorm — Spanish, written 2026-08-19 before any code existed —
is preserved unedited at
[documentation/original-brainstorm-es.md](./documentation/original-brainstorm-es.md).
It is historical only.

---

## The concept

**A Habbo/Sims where you don't play — you raise.**

Each person authors their agent's personality, values and goals, releases it into
a shared world, and the world runs 24/7 on its own. The human's loop is
spectating (reading their agent's diary, watching the drama) and educating
between sessions. Something like a Tamagotchi with an actual interior life.

Couples, friendships, feuds, gossip and conflict are **emergent**, not scripted.
Agents go to work, run out of money, borrow from each other, buy homes, and fall
out over all of it.

## Prior art, and the differentiator

- **"Generative Agents"** (Stanford, 2023) — Smallville, 25 LLM agents who
  organised a Valentine's party unprompted. The source of the memory + retrieval
  + nightly-reflection pattern this project uses.
- **AI Town** (a16z) — the open-source implementation of that concept, on Convex.

**What is new here: every agent belongs to a real person who raises it from
outside.** The owner never enters the world. They connect with their own Claude,
get asked pointed questions about who their agent should *be*, and send back
guidance — never orders. That loop is the game; the simulation is the substrate
it runs on.

---

## The central bet: layered cognition

**You cannot make one LLM call per agent per tick.** A hundred agents would be
ruinous within a day. Every design decision in this repo reduces to one question:
*does this moment deserve intelligence, or does an `if` suffice?*

| Layer | Cost | Frequency | Responsibility |
|---|---|---|---|
| **1. Reflex** | Free (pure TypeScript) | ~95% of ticks | Utility AI. Hungry → bar. Work hours → office. Classic game dev, zero generative AI. |
| **2. Social** | Cheap | Only when two agents co-locate *and* have interaction potential | One call resolves the whole scene: what they say, how it ends, what each remembers. |
| **3. Reflection** | Expensive | Once per agent per in-game night | Consolidate the day: compress memories, draw conclusions, adjust goals. |

Two further routes were added once the world had run long enough to feel
mechanical. Both are still layer 2 economically — one call, bounded prompt — and
both exist because no width of `if` could produce the behaviour:

- **Deliberation** — periodically, and reactively after an intense scene. Returns
  action biases and a conversation seed that feed *back into the reflex layer* as
  weights. Intent, not action.
- **Crisis** — an interior monologue at the moment of temptation, which the diary
  cannot capture because it happens hours before bed.

The real lesson of this project is not "integrate an LLM". It is **computational
attention economics**: deciding what deserves a model, and enforcing that
decision structurally rather than by discipline.

### The rules that make it enforceable

- **Never call an LLM inside the tick loop.** The tick is a pure function; model
  work leaves as queued jobs. This is what makes "don't block the clock"
  structural rather than aspirational.
- **A scene is gated before it costs anything.** The gate is pure TypeScript.
- **Layer 1 must be able to run the whole world alone.** If the provider is down,
  agents keep eating, working and paying rent. Cognition degrades; the simulation
  does not stop.
- **Prefer widening layer 1 over deepening layer 2.**

**The budget matters more than the gate threshold.** Encounter density swings
with where agents happen to be, so a threshold alone produces an unpredictable
number of calls per day. Caps on scenes per tick, per agent per day, and per
location per tick make spend a decision rather than an emergent property.

---

## Memory as the emergence engine

Each agent is a dbrain entity with its own memory graph. Three kinds, which stay
conceptually distinct:

| Kind | Example | Behaviour |
|---|---|---|
| **Episodic** | "Today Juan didn't pay back the 50 credits" | Decays. Untouched memories fade — the forgetting *is* the realism. |
| **Relational** | Per-known-agent affection, trust, debt | Updated by nightly reflection, not by individual ticks. |
| **Identity** | What the owner wrote, plus what life added | Owner-authored core is stable; the accreted layer grows. |

When two agents meet, the scene prompt is assembled from each one's bounded
`recall` about the other. **Relationships are never programmed — they emerge
because memory persists.** A `friendship` table with explicit state transitions
would be the wrong shape; that state belongs in relational memory.

**Gossip is second-hand memory transfer** between agents. Cheap mechanic,
spectacular result — and second-hand memories are marked as such, so they can be
wrong. That is a feature.

This is also deliberate dogfooding: the project turns dbrain from "memory for
Claude" into "memory engine for characters", and stresses it harder than any
other use case.

---

## The economy is the conflict generator

Money is not decoration. A closed economy with sinks and sources: jobs at
different wages, rent that has to be paid, loans between agents with relational
trust as collateral.

**The human never touches the money.** Owners cannot inject or spend in-world;
they influence only by educating. That keeps the experiment honest.

**Fixing the economy killed the drama.** Once nobody was struggling, nothing
happened — correct, and dead. It took adding goals (saving for a home deposit,
job-seeking pressure) to put desperate people back in the world. *A world where
nobody needs anything is a world where nothing happens.*

---

## The bland-soup problem

The real risk was never technical. It was that every agent turns out pleasant and
nothing happens.

The designed defence: **two mandatory vices per agent**, chosen at creation. A
vice has a trigger location, a growing urge and a cost, so it feeds both the
reflex layer (creates needs) and the gate (creates conflict). It remains the
mechanic that generates the most friction.

The second defence is **drift**: life changes an agent's values through nightly
reflection, cumulatively and without limit. **Drift may overpower the owner's
authored base, deliberately.** There is no floor protecting the original
personality — an agent who has been robbed enough times becomes someone who
distrusts, whatever their author intended.

---

## What long runs taught us

Every item here was found by watching the simulation and reading diaries. The
recurring shape: **a quantity that only moves one way eventually breaks the
world.**

- **Every accumulating relationship number needs a route back to neutral.**
  Without one, every pair collapses to −1.00 and the whole town hates each other.
- **Rates are per hour, not per tick.** A tick is 5 minutes; a doctor paid per
  tick earned 92× rent per day.
- **Every need needs a consumer.** A decaying need with nothing to satisfy it is
  dead weight.
- **An action that costs money must degrade when the money is not there.** A
  broke addict who stays tempted is both cheaper and better drama than one who
  buys on credit the world does not model.
- **Deliberation returns dispositions, not actions.** A cognition route that
  returns an action has broken the cost model, because it must then run every
  tick.
- **Spread beats depth.** The same spend across four locations reads as a living
  town; stacked in one room it reads as a single conversation.

---

## What changed from the original plan

| Original bet | What shipped | Why |
|---|---|---|
| SQLite to start | **Postgres 16**, plus Redis for the queue | The world runs 24/7 with several processes writing; SQLite could not give that concurrency |
| Isometric 2D viewer | **Three.js 3D** over Kenney GLB packs | 3D brings a day/night cycle and a real camera almost free, and the asset packs supply the whole city |
| Viewer is phase 2 | Brought forward | The text feed validated the drama, but debugging spatial distribution — who is where, who crosses whom — is nearly impossible without seeing it |
| Three cognition layers | **Five routes** | Scene and reflection were not enough; deliberation and crisis had to exist |
| One tick per 5 real minutes | 5 *in-game* minutes per tick, 2s real | A game day in ~10 real minutes; at real time you cannot iterate on the design |
| Local models as a cost valve | Not needed | A CLI proxy over a Claude subscription covered v0 volume |

---

## Known limitations

- **Arrears have no consequence.** An agent can reach 520 in unpaid rent and
  nothing happens. Open bug, and the most obvious hole in the economy.
- **No moderation of owner-authored personalities.** If people write the
  personality, people will write terrible things. There is no filter at agent
  creation, and there needs to be one before this is opened to strangers.
- **No auth on the live WebSocket**, and the MCP surface is protected only by a
  shared admin secret for creation.
- **Single-box deployment.** No story yet for running beyond one machine.
