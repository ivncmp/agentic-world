# The economy

Money is not decoration. It is the **conflict generator** — the thing that makes
agents need each other, resent each other, and act against their own stated
values. Everything in this document exists to keep somebody uncomfortable.

**The human never touches it.** An owner cannot inject credits, spend them, or
direct a purchase. They influence only by educating. That constraint is what
keeps the simulation an experiment rather than a management game.

## Sources and sinks

| Direction | Mechanism | Notes |
|---|---|---|
| **Source** | Wages, paid per hour of work | Rate comes from the occupation. Paid per *hour*, prorated per tick |
| **Source** | Theft | Capped per incident; leaves a grievance on the victim |
| **Source** | Transfers between agents | A scene can move money — a loan, a repayment, a gift |
| **Sink** | Rent, charged daily | Missing it accumulates arrears |
| **Sink** | Eating, washing, exercise, browsing | Small, constant, unavoidable |
| **Sink** | Indulging a vice | The largest discretionary drain |
| **Sink** | Buying a home | An aspirational sink — see below |

### Rates are per hour, not per tick

A tick is five in-game minutes. The first version of this paid wages per tick,
and a doctor earned ninety-two times their rent every day. Any new rate must be
expressed per hour and divided by `TICKS_PER_HOUR`.

### An action that costs money must degrade when the money is not there

Indulging a vice used to charge the full price regardless and push the agent
negative. It now spends what is available and relieves the urge proportionally:
paying in full clears the urge, paying part leaves 30% behind.

A broke addict who stays tempted is both cheaper to simulate and better drama
than one who buys on credit the world does not model.

### Consumption needs a threshold

Without one, eating at trivial hunger levels beats idling, and the whole town
grazes its money away. Every consumption action requires the need it satisfies
to be past a floor before it becomes attractive.

## Goals: what stops the world going quiet

**Fixing the economy killed the drama.** Once rent was payable and wages were
sane, nobody was ever in trouble and nothing happened. That world is correct and
dead.

Goals put pressure back in. They are derived from an agent's situation each
night and never stored:

- `savingDrive` raises the utility of working and job-seeking.
- `socialDrive` raises the utility of socialising.
- Aspirational sinks give money somewhere to go. `HOME_DEPOSIT` is the main one:
  an agent saves toward buying their flat, and once they do, housing cost drops
  by 60%. It typically fires around day 10-12.

Without an aspirational sink, a saving agent accumulates forever and becomes
immune to the pressures that generate stories.

## Debt and grievance

Two different quantities, deliberately:

- **Debt** is a voluntary loan between two agents, in credits, signed relative
  to the pair key. It is *settleable* — it can be paid and then it is gone.
- **Grievance** is what a theft leaves behind. It is not settleable by paying;
  it decays slowly on its own.

Both feed the scene gate, so an unpaid loan or an old theft raises the odds that
the next meeting between those two costs a model call — which is exactly when it
should.

## Arrears — the open hole

**Missing rent currently has no consequence.** Arrears accumulate, they appear
in the owner's dilemma list, and nothing else happens. An agent can reach
hundreds of credits behind and keep living exactly as before.

The constants for a consequence exist (`ARREARS_WARNING_FACTOR`,
`ARREARS_EVICTION_FACTOR`, `GARNISHMENT_RATE`) but nothing acts on them yet.
This is the most obvious gap in the economy and a good first contribution — see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Where to look

Money lives in the agent row and is moved in exactly one place:
`applyAction` in `src/engine/apply/action.ts`. There is no `economy/`
directory, and adding one would spread a single concern across two homes.

Rent, wages and arrears are handled in the daily rollover inside
`src/engine/tick.ts`. Goals are derived in `src/agents/goals.ts`.
