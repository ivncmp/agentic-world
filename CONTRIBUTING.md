# Contributing

Thanks for looking. This is a simulation with unusual constraints, so read
[The rules that are not style preferences](#the-rules-that-are-not-style-preferences)
before writing code — a change that ignores them will look fine in review and
quietly break the project's economics.

## Getting set up

You need **Node 22** (pinned in `.tool-versions`), **pnpm**, and **Docker
Compose v2**.

```bash
pnpm install
cp .env.example .env     # set POSTGRES_PASSWORD and ADMIN_SECRET at minimum
docker compose up -d     # postgres, redis, dbrain, engine, mcp, viewer
open http://localhost:8080
```

`docker-compose.override.yml` is picked up automatically and serves the viewer
as a Vite dev server with `src/` bind-mounted, so viewer edits hot-reload
without rebuilding. Delete or rename it to serve the production nginx build.

**You do not need a model provider to work on most of the code.** Set `LLM=0`
in `.env` and the world runs on the reflex layer alone — deterministic, free,
and the fastest way to check a change to needs, action scoring or the economy.
Everything except the four cognition routes is exercised that way.

## Checks

```bash
pnpm check    # tsc --noEmit + vitest
```

That is the whole gate, and it must pass. There is no linter or formatter in
this repo yet; match the style of the file you are editing.

## The rules that are not style preferences

Breaking any of these breaks the project rather than the build, so they are
worth stating plainly. The reasoning behind each is in
[CLAUDE.md](./CLAUDE.md) and [DESIGN.md](./DESIGN.md).

- **Never call a model inside the tick loop.** `tick()` is a pure function —
  no I/O, no `await`, no model calls. Expensive work leaves as a queued job.
  This is what makes "the world never blocks on cognition" structural rather
  than a promise.
- **Keep the tick deterministic.** Randomness comes from the injected
  `deps.random`, never `Math.random()`. Two runs with the same seed must agree,
  or no change can be compared against another.
- **Gate before you spend.** A scene costs money only after pure-TypeScript
  scoring says it is worth it. Tune the gate and its budget before tuning a
  prompt.
- **Widen layer 1 before deepening layer 2.** New behaviour should default to a
  rule. Escalate to a model only when it genuinely needs judgment or language.
- **A cognition route returns dispositions, not actions.** A route that decides
  what an agent does must run every tick, which breaks the cost model.
  `deliberation` is the pattern to copy: it biases the free layer.
- **The viewer has no authority and no `Math.random`.** It draws what the engine
  sends; anything not sent is derived from a stable hash, so two people watching
  the same world see the same town.
- **All generated content is English.** A mixed-language memory corpus stops
  matching itself on recall.

## Making a change

- Branch from `main`.
- Commit messages in English, imperative mood, one line.
- If you touch the tick loop, action scoring or the economy, run a world with
  `LLM=0` for a few in-game days and check the event feed still makes sense.
  Several of the rules above exist because a plausible-looking change produced
  a dead or absurd world; the tests will not catch that for you.
- If you add a value axis, add the behaviour that reads it. An axis no branch in
  `scoreActions` consults is decoration.

## Known gaps — good places to start

These are real, open, and deliberately not fixed yet:

- **Arrears have no consequence.** An agent can accumulate hundreds in unpaid
  rent and nothing happens. The most obvious hole in the economy.
- **No moderation of owner-authored personalities.** Anyone can write anything
  at agent creation. This needs to exist before the world is opened to
  strangers.
- **No auth on the `/live` WebSocket**, and the MCP surface is gated only by a
  shared admin secret for creation.
- **Thin test coverage** outside the tick loop and the cognition parsers:
  `actions.ts`, `clock.ts`, the `apply/` reducers, persistence, `create.ts`,
  `needs.ts` and `goals.ts` have none.
- **No runtime validation** of MCP guidance input beyond hand-written checks.
- **Single-box deployment.** No story for running beyond one machine.

## Reporting things

Bugs and ideas: open an issue. For anything about emergent behaviour ("my agent
did something strange"), include the day number and the relevant diary or feed
entries — that is usually enough to find it.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
