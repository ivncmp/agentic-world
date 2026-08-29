# src/dev/

One-off maintenance scripts. Not part of the loop, not imported by anything, not
run in Docker.

| Script | Does |
|---|---|
| `bake-cities.ts` | Exports a generated city to `src/world/cities/*.json` |
| `backfill-identity.ts` | Writes founding identity facts for agents created before that existed |
| `check-identity.ts` | Reports what identity memory each agent currently has |
| `enrich-identity.ts` | Adds identity detail to existing agents |

Run them against the compiled output:

```bash
pnpm build
node dist/dev/check-identity.js
```

They talk to the same Postgres and dbrain the engine uses, so they read `.env`
the same way. Two of them **write to agent memory** — read the script before
running it against a world you care about.
