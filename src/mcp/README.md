# src/mcp/

The owner-facing MCP server. Runs as its own container on `:7071`.

| File | Holds |
|---|---|
| `index.ts` | The HTTP host and health endpoint |
| `server.ts` | The seven tools |

## It is a client, not a second source of truth

Every tool here is a thin wrapper over the engine's HTTP surface. This server
holds **no world state**, so it can never disagree with the engine about what is
true.

| Tool | Calls |
|---|---|
| `register_owner` | `POST /register_owner` |
| `create_agent` | `POST /agents` |
| `list_agents`, `get_agent` | `GET /agent` |
| `get_briefing` | `GET /briefing` |
| `get_open_dilemmas` | `GET /dilemmas` |
| `submit_guidance` | `POST /guidance` |

## MCP is for the human side

There is no MCP client per agent and no agent-facing MCP. Agents are data; the
engine calls the model. This server exists so a *person* can reach their agent
from outside the world.

## Guidance is typed

`submit_guidance(agentId, { valueDeltas, priorities, constraints, note })`.

The typed fields feed the reflex layer for free, every tick. Only `note` is
prose, and it goes to dbrain as identity memory. Free-text-only guidance would
force a model call just to interpret what the owner meant, on every decision.

**Guidance shifts dispositions, never actions.** If the owner can predict what
happens tomorrow, the question was wrong. See
[documentation/owner-loop.md](../../documentation/owner-loop.md).
