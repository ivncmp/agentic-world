# src/agents/

What an agent *is*. No behaviour lives here — this is the schema and the rules
for reading it.

| File | Holds |
|---|---|
| `agent.ts` | The `Agent` row and `Relationship`. The source of truth for the shape |
| `values.ts` | The seven value axes and `resolveValues` — how the three strata sum |
| `needs.ts` | Need decay and vice-urge growth, applied every tick |
| `vices.ts` | The closed vice catalogue |
| `goals.ts` | Goals derived from an agent's situation each night, never stored |
| `identity.ts` | The founding identity facts written to dbrain at creation |
| `create.ts` | Validating and assembling a new agent, and allocating them a home |

## Personality is three strata that sum

```
effective = clamp(base + drift + decayed guidance)
```

`base` is what the owner authored and effectively never changes. `drift` is what
life does, via nightly reflection, cumulatively and without limit. `guidance` is
the owner educating, and it **decays on a half-life** unless reinforced.

**Drift may overpower base, deliberately.** Do not add a floor that protects the
owner's original values — an agent who has been robbed enough times becoming
someone who distrusts is the entire point.

## Seven axes, not a personality model

`honesty · industriousness · thrift · sociability · riskTolerance · loyalty ·
pride`, each −1..+1.

Descriptive models like Big Five are not usable here. **An axis earns its place
only if some branch in `scoreActions` reads it.** Adding an axis means adding
the behaviour that consults it, or it is decoration.

## Vices are pulls, not low values

Exactly two per agent, mandatory. A vice has a trigger location, a growing urge
and a cost, so it feeds both the reflex layer (it creates a need) and the scene
gate (it creates conflict).

The catalogue is **closed but extensible**: `ViceKind` derives from the object's
keys, so adding an entry widens the type while an arbitrary string still fails
to compile. Free-text vices would need a model call to interpret, which the
reflex layer cannot afford.
