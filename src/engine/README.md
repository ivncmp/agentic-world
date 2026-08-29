# src/engine/

The free layer. Everything here is pure TypeScript and runs every tick.

| File | Holds |
|---|---|
| `tick.ts` | The loop. A pure function |
| `actions.ts` | Utility AI — `scoreActions` and `chooseAction` |
| `clock.ts` | Ticks ↔ game time, day boundaries, hour of day |
| `relationship.ts` | `adjustFeeling` and `coolFeeling` |
| `crisis-detect.ts` | Spots a moment worth an interior monologue |
| `apply/` | The reducers that fold a result back into state |

## The tick is a pure function

```ts
tick(state, deps) => { state, events, sceneJobs, reflectionJobs, ... }
```

No I/O, no `await`, no model calls. Expensive cognition leaves as job
descriptions. That is what makes "never block the clock" enforceable rather than
aspirational, and it makes a whole simulated day testable in milliseconds.

`deps.random` is injected. Keep it that way — determinism is what makes two runs
comparable across a change.

## Values become behaviour in exactly one place

`scoreActions` in `actions.ts` is the only function where a value axis changes
anything. An axis no branch in there reads is decoration.

## apply/

One reducer per kind of result, all pure `(state, ...) => state`:
`action` for the reflex layer, and `scene` / `reflection` / `deliberation` for
the cognition routes. A handler that received a model response never mutates the
world by hand.

## Rules learned from long runs

The recurring shape: **a quantity that only moves one way eventually breaks the
world.**

- **Rates are per hour, not per tick.** A tick is 5 minutes; a doctor paid per
  tick earned 92x rent per day.
- **Consumption actions need a threshold**, or they beat idling at trivial need
  levels and drain the economy.
- **Every need needs a consumer.** A decaying need with nothing to satisfy it is
  dead weight.
- **An action that costs money must degrade when the money is not there.**
- **Any accumulating relationship number needs a route back to neutral.**
  `coolFeeling` drifts 3%/day toward neutral; without it every pair collapses to
  −1.00 and the whole town hates each other. `adjustFeeling` applies diminishing
  returns near the extremes for the same reason.
