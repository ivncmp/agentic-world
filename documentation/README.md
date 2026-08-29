# Documentation

| Guide | Read it for |
|---|---|
| [architecture.md](./architecture.md) | How a tick becomes a model call and comes back — the pure loop, the gate, the queue, the two stores, the module map |
| [economy.md](./economy.md) | Sources and sinks, why goals had to exist, debt vs grievance, and the arrears hole |
| [owner-loop.md](./owner-loop.md) | The differentiator: MCP tools, typed guidance, decay, dilemmas, auth |
| [deployment.md](./deployment.md) | Services, every environment variable, resume behaviour, migrations |
| [viewer.md](./viewer.md) | The Three.js scene, determinism by hash, label rules, the asset gotcha |

Each `src/` subdirectory has its own README covering what lives there and the
rules specific to it — [agents](../src/agents/README.md),
[cognition](../src/cognition/README.md), [engine](../src/engine/README.md),
[memory](../src/memory/README.md), [persistence](../src/persistence/README.md),
[world](../src/world/README.md), [server](../src/server/README.md),
[viewer](../src/viewer/README.md), [mcp](../src/mcp/README.md),
[shared](../src/shared/README.md), [dev](../src/dev/README.md). The standalone
browser tools are documented in [tools/](../tools/README.md).

Elsewhere in the repo:

- **[README.md](../README.md)** — what this is and how to run it
- **[DESIGN.md](../DESIGN.md)** — *why* the project is shaped like this
- **[CLAUDE.md](../CLAUDE.md)** — working agreements for the codebase
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — setup, the non-negotiable rules, known gaps
- **[original-brainstorm-es.md](./original-brainstorm-es.md)** — the founding
  document, in Spanish, preserved unedited. Historical only.
