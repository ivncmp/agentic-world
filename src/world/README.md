# src/world/

The map. Generated once from a seed, or loaded from a baked template.

| File | Holds |
|---|---|
| `generator.ts` | Builds a city: blocks, venues, homes, water |
| `layout.ts` | The street grid and block roles |
| `locations.ts` | Location kinds, travel time, minimum stay |
| `occupations.ts` | Occupations, wages, shifts, where each one works |
| `config.ts` | The default city and template loading |
| `rng.ts` | Seeded PRNG |
| `cities/` | Baked city templates as JSON |

## Streets are a rule, not a tilemap

A tile is a street when `x % streetPeriod === 0 || y % streetPeriod === 0`. The
grid size and the period travel to the viewer, which rebuilds the street map
from the same rule.

That is deliberate: shipping a tilemap would give the engine and the viewer two
copies of one decision, and they would quietly stop agreeing.

Block **roles** do travel, because which block is the plaza is a layout decision
rather than something derivable.

## Seeded, not random

Everything here goes through `rng.ts` seeded by `SEED`. The same seed gives the
same city, which is what lets a bug in city generation be reproduced.

## Baked cities

`cities/*.json` are exported layouts, loaded via `CITY_TEMPLATE`. Use one when
you want a stable world across restarts and code changes rather than whatever
the current generator produces.

Note that a resumed world **re-lays its city** if the street plan changed
underneath it: each place moves onto its planned plot and the move is logged.
Relationships, memories and diaries are what make a world worth keeping, and
none of them live in a coordinate.
