# The owner loop

This is the differentiator. Everything else in the project is a substrate for
it.

**The owner never enters the world.** They connect from outside with their own
Claude, read a briefing about their agent's life, see the tensions the engine
has surfaced, and send back **guidance** — a shift in disposition, never an
instruction.

## The test

> **If the owner can predict what happens tomorrow, the question was wrong.**

Guidance shifts values, priorities and constraints. It never selects the agent's
next move. "Be more careful with money" is guidance; "go to work instead of the
bar" is a command, and a command turns raising into playing.

## The round trip

```
   owner's Claude ──── get_briefing ───────▶  MCP server ──▶ engine /briefing
                  ──── get_open_dilemmas ──▶              ──▶ engine /dilemmas
                                                                    │
   owner reads, decides, phrases it        ◀───────────────────────┘
                  ──── submit_guidance ───▶  MCP server ──▶ engine /guidance
                                                                    │
                              ┌─────────────────────────────────────┘
                              ▼
                  typed deltas → the reflex layer (free, every tick)
                  prose note   → dbrain identity memory
```

The engine surfaces *actionable tensions*; the owner's own Claude phrases them
as questions; the MCP server validates whatever comes back. The inference that
turns a dilemma into a good question runs on **the owner's subscription**, not
the world's budget — and it never drives a tick.

## MCP tools

`src/mcp/server.ts` exposes seven, on `:7071`:

| Tool | Purpose |
|---|---|
| `register_owner` | Mint an owner token (requires the admin secret) |
| `create_agent` | Author a new agent: values, vices, occupation, constraints |
| `list_agents` | The agents this owner owns |
| `get_agent` | Full detail for one agent |
| `get_briefing` | Where the agent stands: money, housing, needs, job, goals, values, vices, relationships, last three diaries |
| `get_open_dilemmas` | Actionable tensions, most severe first |
| `submit_guidance` | Apply typed guidance |

The MCP server is a **thin client over the engine's HTTP surface**. It holds no
world state, so it can never disagree with the engine about what is true.

## Guidance is typed

```ts
submit_guidance(agentId, {
  valueDeltas:       { thrift: +0.3, riskTolerance: -0.2 },
  constraints:       ['no_theft'],
  removeConstraints: ['avoid_bars'],
  note:              'You do not owe your brother anything anymore.',
})
```

- **`valueDeltas`** shift one of the seven value axes by −1..+1.
- **`constraints`** and **`removeConstraints`** are hard rules the reflex layer
  reads directly.
- **`note`** is prose, and it becomes an **identity memory** in dbrain.

The typed fields are what make this affordable: they feed the free reflex layer
every tick. Free-text-only guidance would force a model call just to interpret
what the owner meant, on every decision.

The agent also *remembers being educated*, in their own voice — "My owner
nudged my personality: thrift +0.3." That memory is what a later scene or
reflection actually reads.

## Guidance decays

Personality is three strata that sum:

```
effective = clamp(base + drift + decayed guidance)
```

| Stratum | Author | Changes |
|---|---|---|
| `base` | The owner, at creation | Effectively never |
| `drift` | Life, via nightly reflection | Slowly, cumulatively, without limit |
| `guidance` | The owner, educating | **Decays on a 14-day half-life** unless reinforced |

Decay is what makes raising a habit rather than a one-off command. An owner who
says something once and disappears watches it fade; an owner who keeps saying it
changes who the agent is.

**Drift may overpower base, deliberately.** There is no floor protecting the
owner's original values. An agent who has been robbed enough times becomes
someone who distrusts, whatever their author intended — and an owner who wants
otherwise has to show up and say so.

**An absent owner is a valid state.** With no guidance, the agent falls back to
its authored personality plus whatever life has done to it.

## Dilemmas

`get_open_dilemmas` returns what the engine can see going wrong, each with a
severity between 0 and 1:

| Kind | Fires when |
|---|---|
| `arrears` | Unpaid rent is accumulating |
| `broke` | Less than two days of rent in hand |
| `unemployed` | No job |
| `vice_pressure` | A vice urge is above 0.6 |
| `grievance` | Bad blood with someone above 0.4 |
| `debt_owed` | Owes another agent more than 50 credits |
| `value_drift` | An axis has moved more than 0.4 from the authored base |

`value_drift` is the one that most often produces a good question: life pulling
against the personality the owner wrote is the story the owner came to read.

## Authentication

An owner token is minted by `register_owner`, gated on the server's
`ADMIN_SECRET`. Every briefing, dilemma and guidance call carries the token, and
the engine checks that the token's owner actually owns that agent.

Creating the first agent for an unknown owner mints their token and returns it
once — there is no other moment where the owner is guaranteed to be listening.

**Known gap:** there is no auth on the `/live` WebSocket, and no rate limit on
guidance beyond the intended cadence cap.
