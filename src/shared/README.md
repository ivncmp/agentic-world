# src/shared/

Code with more than one consumer across the server/browser boundary. Deliberately
almost empty: most things belong to a layer, and a shared folder is where
unrelated code goes to accumulate.

| File | Holds |
|---|---|
| `hash.ts` | FNV-1a, and `pickBy` for choosing deterministically from a list |

## Why a hash is shared

Two places need things to look varied without being random, and neither may use
`Math.random`:

- **The viewer** picks a building model, a rotation, a tree for every filler
  tile. It must produce the same town on every reload, in every browser, for
  every spectator watching the same world.
- **The crisis prompt** rotates its entry point per call, because the model
  otherwise opens most monologues the same way. The tick loop has to stay
  reproducible, so the choice is derived from the agent and the tick.

Same requirement, so one implementation. `src/viewer/core/hash.ts` re-exports
from here rather than keeping a copy that could drift.
