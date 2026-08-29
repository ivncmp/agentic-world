# src/memory/

The narrative half of persistence. Postgres holds what the tick reads; this
holds the *why*, recalled by relevance.

| File | Holds |
|---|---|
| `store.ts` | The `MemoryStore` interface — the public API |
| `dbrain-store.ts` | The dbrain implementation, used in production |
| `in-memory-store.ts` | For tests and for `PERSIST=0` |

## Three memory kinds, kept distinct

| Kind | Example | Behaviour |
|---|---|---|
| **Episodic** | "Today Juan didn't pay back the 50 credits" | Decays. Untouched memories fade — the forgetting *is* the realism |
| **Relational** | Affection, trust, debt per known agent | Updated by nightly reflection, not by individual ticks |
| **Identity** | What the owner wrote, plus what life added | The authored core is stable; the accreted layer grows |

**Never program a relationship.** Relationships emerge because memory persists.
A `friendship` table with explicit state transitions would be the wrong shape —
that state belongs in relational memory, updated by reflection.

**Gossip is second-hand memory transfer.** Cheap mechanic, spectacular result.
Second-hand memories are marked as such, so they can be wrong. That is a feature.

## The dbrain adapter

Maps onto dbrain's existing fields: memory kind → `fact.category`, subject →
`fact.relatedEntities`, game tick → `fact.timestamp` as a real instant (there is
a regression test pinning that). `forget()` is a no-op — dbrain handles its own
decay.

## Two implementations, always

`MemoryStore` is public API for anyone adopting this project. Keep it small, and
keep both implementations working: `in-memory-store.ts` is what lets the whole
world run with no external services.

> All content stored here is **English**, always. A mixed-language corpus stops
> matching itself on recall. Translation belongs at display time.
