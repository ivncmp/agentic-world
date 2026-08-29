# Deployment

The world is designed to run 24/7 on a single box. That is the whole current
story — there is no multi-node story yet.

## Services

`docker compose up -d` brings up seven containers:

| Service | Image / build | Default port | Purpose |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5532 → 5432 | World state, event log, scenes, diaries, LLM metering |
| `redis` | `redis:7-alpine` | 6479 → 6379 | The BullMQ cognition queue |
| `dbrain` | built from `infra/dbrain/` | 7978, 7979 | Agent memory (episodic + identity) |
| `engine` | built from `infra/engine/` | 7070 | The tick loop, HTTP surface, `/live` WebSocket |
| `mcp` | built from `infra/mcp/` | 7071 | The owner loop, a thin client over the engine |
| `viewer` | nginx, or Vite in dev | 8080 | The 3D spectator view |
| `pgweb` | `sosedoff/pgweb` | 8082 (localhost only) | SQL browser, development convenience |

`engine` waits for `postgres`, `redis` and `dbrain` to report healthy before it
starts, so a cold `up` is safe.

`docker-compose.override.yml` is loaded automatically and replaces the viewer
with a Vite dev server with `src/` bind-mounted, so viewer edits hot-reload.
Delete or rename it to serve the production nginx build.

## Environment

Copy `.env.example` to `.env`. Two variables have no default and the stack
refuses to start without them:

| Variable | Why it is required |
|---|---|
| `POSTGRES_PASSWORD` | The database credential |
| `ADMIN_SECRET` | Gates owner registration and agent creation |

### The engine

| Variable | Default | Meaning |
|---|---|---|
| `TICK_MS` | 2000 | Real milliseconds per tick. A tick is 5 in-game minutes, so 2000 gives a game day every ~10 real minutes |
| `SEED` | 42 | Seeds city generation and the tick's injected randomness |
| `LLM` | 1 | `0` runs the world on the reflex layer alone — no model calls at all |
| `PERSIST` | 1 | `0` runs entirely in memory: no Postgres, no dbrain |
| `FRESH` | — | `1` starts from tick 0 even when a saved world exists |
| `CITY_TEMPLATE` | — | A baked city from `src/world/cities/`; omit to generate from the seed |
| `SCENE_TIMEOUT_MS` | 120000 | How long a pair will stand waiting for a scene before giving up |
| `COGNITION_CONCURRENCY` | 6 | Concurrent model calls |

### The model provider

```bash
MODEL_PROVIDER=dproxy
DPROXY_URL=http://localhost:7880
DPROXY_API_KEY=

SCENE_MODEL=claude-sonnet-5
DELIBERATION_MODEL=claude-sonnet-5
CRISIS_MODEL=claude-sonnet-5
REFLECTION_MODEL=claude-sonnet-5
```

**Two things must both be true for a model setting to take effect**: it has to
be in `.env`, *and* `docker-compose.yml` has to forward it into the `engine`
service. Setting only the first does nothing, silently — the engine reads
`undefined` and falls back to the provider's default, which is its most
expensive model. This cost real money before it was noticed.

**Leaving a route unset is not a neutral choice.** Measured on this stack:

| Route | Provider default (Opus-class) | Haiku | Sonnet |
|---|---|---|---|
| scene | 60s · 3,117 output tokens | 74s · 6,931 | **35s · 2,716** |
| deliberation | 7s · 188 | 44s · 3,705 | **6s · 251** |
| crisis | 5s · 54 | 7s · 396, ~50% refusals | **5s · 64, no refusals** |

Haiku is the counterintuitive result: through the CLI it thinks before
answering, and that reasoning is billed as output, so it is both slower and more
expensive per call while producing flatter dialogue. Sonnet is the default
recommendation for every route.

### What the clock costs

`TICK_MS` is the single largest lever on spend, and it is easy to miss because
it does not look like a cost setting.

A game day is 288 ticks. At the development default of `TICK_MS=2000` that is
9.6 real minutes, so the world runs **150 game days per real day** — and
cognition cost scales with game days, not with wall time.

Measured on a 10-agent world with Sonnet on every route:

| Route | Calls per agent per game day | Design target | Cost per game day |
|---|---|---|---|
| scene | 4.2 | ≤ 14 | $2.87 (59%) |
| crisis | 6.2 | 1-3 | $0.72 |
| deliberation | 3.3 | 2, plus reactive | $0.93 |
| reflection | 0.9 | 1 | $0.36 |
| | | | **$4.87** |

Under $5 per game day is reasonable. Multiplied by 150, it is not. **For
anything left running 24/7, raise `TICK_MS`** — 30s per tick gives a game day
every 2.4 hours and divides the daily cost by fifteen.

Two figures in that table are worth knowing about:

- **Scenes are 59% of spend** on 4.2 calls per agent per day, well under their
  cap. The driver is size, not volume: the prompt asks for 12-18 dialogue lines
  and a scene runs about 2,800 output tokens.
- **Crisis fires roughly twice its design target.** `CRISIS_COOLDOWN` is 48
  ticks — four game hours — which permits six firings a day per agent against a
  documented target of one to three. The cooldown is the binding constraint.

Costs reported through dproxy are **API-equivalent, not money spent**: it runs
on a Claude subscription. The figures still matter for subscription quota, and
they are the bill if you switch to the direct API.

### dbrain

```bash
DBRAIN_VERSION=1.0.1
DBRAIN_PORT=7978
DBRAIN_DASHBOARD_PORT=7979
DBRAIN_TOKEN=
```

Use a dedicated instance for the simulation. Sharing one with another brain
mixes an agent's memories into somebody else's recall.

## Operating it

```bash
docker compose logs -f engine        # the village log, live
curl localhost:7070/health           # liveness and current tick
curl localhost:7070/metering         # cost and tokens per agent
docker compose up -d --build engine  # deploy a code change
```

The engine saves world state **every in-game hour**, not only at the midnight
rollover. A daily save leaves the database a whole game day behind what is
running: a crash loses that day, and anything reading the database shows a world
that no longer exists.

## Restarts and resume

A restart resumes from the last save. Two things happen at boot that are worth
knowing about:

- **The city is re-laid if the street plan changed.** Each place moves onto its
  planned plot rather than the world starting over, and each move is logged.
  Relationships, memories and diaries are what make a world worth keeping, and
  none of them live in a coordinate — but a resumed world is not guaranteed to
  have its buildings on the same tiles as the run that created it.
- **Pending jobs survive.** BullMQ persists them in Redis, so stranded scenes
  from the previous run are picked up automatically and reported at boot.
  Missing diaries are backfilled from Postgres.

## Migrations

SQL files in `src/persistence/migrations/`, numbered, tracked by filename in a
`schema_migrations` table, applied in lexicographic order at boot. Number new
ones from `013`.

Because the runner keys on the **filename**, renaming an applied migration makes
it run again. `012_owners.sql` is written to be idempotent for exactly that
reason.

## Secrets

`.env` stays on the box and is gitignored, along with `*.pem`, `*.key` and
`.env.*`. Never commit credentials; never log them.

## Portability

This ships open source, so nothing in `src/` may hardcode a host, port or IP.
Everything goes through environment configuration with a documented default in
`.env.example`. The reference deployment is one machine on a LAN, co-located
with dbrain and the model proxy — but it is a reference, not *the* deployment.
