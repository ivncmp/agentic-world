# src/persistence/

Postgres. Everything the tick loop reads and writes, plus everything the owner
fetches by address.

| File | Holds |
|---|---|
| `db.ts` | The pool and the migration runner |
| `world-repo.ts` | Save and load the whole world |
| `history-repo.ts` | Event log, scenes, diaries, LLM call metering |
| `owner-repo.ts` | Owners and their tokens |
| `migrations/` | Numbered SQL, applied in order at boot |

## What lives here rather than in dbrain

World state, the event log, scenes, diaries and metering. The rule is the access
pattern, not the content type:

**Diaries are here even though they are narrative.** The diary is *for the human*
and is fetched by agent and day — a lookup. The consolidated memory from the same
reflection is *for the agent* and is fetched by relevance, so it goes to dbrain.
One store would force one of them into the wrong kind of query.

**Relationship numbers are here, denormalised.** The gate reads them for every
co-located pair every tick; an HTTP hop to dbrain there would be ruinous. They
are a cache — dbrain holds the narrative behind them, and on divergence dbrain
wins.

## Migrations

Numbered, tracked by filename in `schema_migrations`, applied in lexicographic
order at boot. Number new ones from `013`.

Because the runner keys on the **filename**, renaming an applied migration makes
it run again. `012_owners.sql` is written to be idempotent for exactly that
reason.

## Round-tripping

A world must survive a restart in two senses: identical state after reload, *and*
50 further ticks agreeing with a run that never stopped. The second matters more
— divergent evolution is worse than lost data.

Gotchas, all paid for once:

- JSONB reorders keys — canonicalise before comparing.
- `openings` must be nullable: `NULL` means "not a workplace", `0` means "full".
- Postgres `NUMERIC` comes back as a string.
