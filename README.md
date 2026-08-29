<p align="center">
  <img src="src/viewer/public/agentic-world-logo.png" alt="Agentic World" width="500">
</p>

<p align="center">
  <strong>A persistent multi-agent social simulation where you don't play — you raise.</strong>
</p>

---

A Habbo/Sims-style world that runs 24/7. Each person authors their agent's personality, values, and goals, releases it into a shared world, and watches emergent relationships, rivalries, gossip, and conflict unfold. The human's gameplay is spectating (reading their agent's diary, watching the drama) and educating between sessions — never controlling.

## How it works

Every design decision reduces to one question: *does this moment deserve intelligence, or does an `if` suffice?*

| Layer | Cost | When |
|-------|------|------|
| **Reflex** | Free (pure TS) | ~95% of ticks — utility AI over needs, values, money and goals |
| **Scene** | One call | Two agents co-locate *and* the gate scores them worth a conversation |
| **Deliberation** | One call | An agent rethinks after something intense — returns biases, not actions |
| **Crisis** | One call | Interior monologue at the moment of temptation: a vice, a theft, deep debt, isolation |
| **Reflection** | One call | Once per agent per game night — diary, memory consolidation, character drift |

The tick engine is a pure function and runs deterministically. LLM calls leave as jobs on a bounded Redis queue and resolve out-of-band, so the world never blocks on cognition — if the provider disappears, agents keep eating, working and paying rent.

## Quick start

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and ADMIN_SECRET at minimum
docker compose up -d          # postgres, redis, dbrain, engine, worker, mcp, viewer
open http://localhost:8080    # the city, in 3D
```

`docker-compose.override.yml` is loaded automatically and runs the viewer as a Vite dev server with `src/` mounted, so viewer edits hot-reload. Delete it to serve the static nginx build.

| Service | Port |
|---|---|
| Viewer | 8080 |
| Engine (HTTP + `/live` WebSocket) | 7070 |
| MCP (owner loop) | 7071 |
| dbrain | 7978, dashboard 7979 |
| Postgres | 5532 (pgweb on 8082) |
| Redis | 6479 |

## Development

```bash
pnpm check                    # tsc --noEmit + vitest
docker compose logs -f engine # the village log, live
```

`LLM=0` in `.env` runs the world on the reflex layer alone — the fastest way to check a change to needs, action scoring or the economy.

## Architecture

Characters are data, cognition is a service. Agents are not processes — a character is a row in Postgres plus a memory graph in [dbrain](https://dtoolkit.vercel.app/).

| Store | What | Why there |
|-------|------|-----------|
| **Postgres** | World state, events, scenes, diaries | Written every tick; read by address ("day 5"), which is a lookup |
| **dbrain** | Episodic and identity memory | Narrative text recalled by relevance, with decay already built |

Relationships are never programmed. They emerge because memory persists: when two agents meet, the scene prompt is built from each one's recall about the other. Gossip is just second-hand memory transfer — and second-hand memories can be wrong, which is a feature.

## The viewer

Three.js over Kenney asset packs. The browser is a spectator with no authority: it draws `GET /world` once and follows the `/live` WebSocket. Buildings and agents are clickable and hoverable, venue labels show who is inside, and the sun tracks the in-game clock — sunrise at 6, noon at 13, sunset at 20.

## The owner loop

The differentiator: owners connect from outside via MCP, receive briefings and open dilemmas about their agent's life, and send back **guidance** — disposition shifts, never direct actions. If the owner can predict what happens tomorrow, the question was wrong.

Guidance is typed (`valueDeltas`, `priorities`, `constraints`, plus a prose `note`) so it can feed the free reflex layer every tick instead of costing a call to interpret. It decays on a half-life, so raising is continuous, and an absent owner means the agent falls back to its authored personality.

## Documentation

| | |
|---|---|
| [DESIGN.md](./DESIGN.md) | Why the project is shaped like this, and what long runs taught us |
| [documentation/architecture.md](./documentation/architecture.md) | How a tick becomes a model call and comes back |
| [documentation/economy.md](./documentation/economy.md) | Sources, sinks, goals, and the arrears hole |
| [documentation/owner-loop.md](./documentation/owner-loop.md) | MCP tools, typed guidance, decay, dilemmas |
| [documentation/deployment.md](./documentation/deployment.md) | Services, environment variables, migrations |
| [documentation/viewer.md](./documentation/viewer.md) | The Three.js scene and its determinism rules |

## Contributing

Start with [CONTRIBUTING.md](./CONTRIBUTING.md) — it covers setup, the handful
of rules that are not style preferences, and a list of known gaps that are good
places to start. By participating you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE).
