# src/cognition/

The parts that cost money, and the gate that decides whether to spend it.

| File | Holds |
|---|---|
| `gate.ts` | Scores co-located pairs, then applies the budget. Pure TypeScript |
| `scene.ts` | Two agents talk. The highest-volume and most expensive route |
| `reflection.ts` | Nightly: diary, memory consolidation, character drift |
| `deliberation.ts` | An agent rethinks — returns biases, not actions |
| `crisis.ts` | Interior monologue at the moment of temptation |
| `provider.ts` | The `ModelProvider` interface and the dproxy implementation |
| `json.ts` | Pulling the JSON object out of a response, and spotting a refusal |

## The gate, and the real cost dial

1. `scoreEncounter` weighs debt, strength of feeling (love *and* hate), goal
   conflict, a vice triggered by this location, time apart and noise, minus a
   damper for pairs who already spoke today.
2. `shouldTriggerScene` applies a threshold, discarding mere co-location.
3. `selectScenes` sorts by score and applies the budget: per tick, per agent per
   day, per location per tick.

**Step 3 is the cost dial, not step 2.** Encounter density swings with where
agents happen to be, so a threshold alone produces an unpredictable number of
calls per day. The budget makes spend a decision rather than an emergent
property.

`maxScenesPerLocationPerTick` exists because the other caps are blind to
*where*: a busy bar would otherwise eat the whole tick budget and the rest of
the city would go silent. Spread beats depth.

`GateContext.random` is injected so ticks stay deterministic and testable.

## Adding a route

Copy **deliberation**. It does not decide anything; it biases the free layer
that decides everything. A route that returns an action instead of a disposition
has broken the cost model, because it must then run every tick.

Every route follows the same shape: `buildXPrompt` → provider → `parseX`. Keep
the prompt bounded — recall for a scene is capped per participant, because
unbounded recall is how the token bill explodes.

## Prompts are load-bearing

Two things in here look like style and are not:

- **The provider sets its own system prompt.** The CLI it shells out to carries
  an assistant persona that refuses to voice a character's vice, and the refusal
  text lands in an agent's diary.
- **The crisis prompt rotates its entry point** via a stable hash. Without it the
  model opens most monologues with the same invocation, and crisis fires often
  enough that the repetition is the most visible tic in the feed.
