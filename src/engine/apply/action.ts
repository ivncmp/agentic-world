/**
 * How a chosen action changes the world.
 *
 * `scoreActions` decides *what* an agent does; this decides what that costs and
 * relieves. It is the only place in the reflex layer where money moves, and it
 * runs inside the tick loop — so it stays pure, synchronous and allocation-light.
 *
 * Two rules the simulation learned the hard way:
 * - **Rates are per hour, not per tick.** A tick is 5 minutes; a wage paid per
 *   tick earned 92x rent per day.
 * - **An action that costs money must degrade when the money is not there.** A
 *   broke addict who stays tempted is cheaper and better drama than one who
 *   buys on credit the world does not model.
 */
import { TICKS_PER_HOUR } from '../clock.js'
import { viceDef } from '../../agents/vices.js'
import { occupationDef } from '../../world/occupations.js'
import type { Agent, AgentId } from '../../agents/agent.js'
import type { Action } from '../actions.js'
import type { LocationId, LocationKind } from '../../world/locations.js'
import type { WorldEvent, TickDeps } from '../tick.js'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const credits = (n: number) => Math.round(n * 100) / 100

/** Chance per tick that job-hunting finds a vacancy. */
const HIRE_CHANCE = 0.06
/** Most an agent can lift from one victim in one go. */
const MAX_THEFT = 30

export type ApplyActionContext = {
  /** Every agent this tick, mutable — theft debits the victim in place. */
  draft: Map<AgentId, Agent>
  events: WorldEvent[]
  tick: number
  deps: TickDeps
  /** Free posts per workplace, decremented on hire. */
  openings: Map<LocationId, number>
  kindOf: ReadonlyMap<LocationId, LocationKind>
}

/** Returns the agent as the action leaves them. Never mutates `agent` itself. */
export function applyAction(agent: Agent, action: Action, ctx: ApplyActionContext): Agent {
  switch (action.kind) {
    case 'eat':
      return {
        ...agent,
        needs: { ...agent.needs, hunger: clamp01(agent.needs.hunger - 0.6) },
        money: agent.money - 8,
      }

    case 'sleep':
      return { ...agent, needs: { ...agent.needs, energy: clamp01(agent.needs.energy - 0.7) } }

    case 'work':
      return applyWork(agent, ctx)

    case 'seek_job':
      return applySeekJob(agent, ctx)

    case 'relax':
      return {
        ...agent,
        needs: {
          ...agent.needs,
          fun: clamp01(agent.needs.fun - 0.5),
          social: clamp01(agent.needs.social - companyBonus(agent, ctx)),
        },
      }

    case 'exercise':
      return {
        ...agent,
        money: agent.money - 10,
        needs: {
          ...agent.needs,
          fun: clamp01(agent.needs.fun - 0.45),
          hygiene: clamp01(agent.needs.hygiene + 0.2),
          social: clamp01(agent.needs.social - companyBonus(agent, ctx)),
        },
      }

    case 'browse':
      return {
        ...agent,
        money: agent.money - 25,
        needs: {
          ...agent.needs,
          fun: clamp01(agent.needs.fun - 0.6),
          social: clamp01(agent.needs.social - companyBonus(agent, ctx)),
        },
      }

    case 'wash':
      return { ...agent, needs: { ...agent.needs, hygiene: clamp01(agent.needs.hygiene - 0.8) } }

    case 'socialize':
      return {
        ...agent,
        needs: {
          ...agent.needs,
          social: clamp01(agent.needs.social - 0.3),
          fun: clamp01(agent.needs.fun - 0.15),
        },
      }

    case 'indulge_vice':
      return applyVice(agent, action)

    case 'steal':
      return applyTheft(agent, action, ctx)

    default:
      return agent
  }
}

/** Being around other people takes the edge off the social need. */
function companyBonus(agent: Agent, { draft }: ApplyActionContext): number {
  const alone = ![...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
  return alone ? 0 : 0.1
}

function applyWork(agent: Agent, { draft }: ApplyActionContext): Agent {
  if (agent.job == null) return agent
  const hasCoworkers = [...draft.values()].some((o) => o.id !== agent.id && o.location === agent.location)
  return {
    ...agent,
    money: credits(agent.money + agent.job.wage / TICKS_PER_HOUR),
    needs: {
      ...agent.needs,
      energy: clamp01(agent.needs.energy + 0.04),
      fun: clamp01(agent.needs.fun + 0.015),
      social: clamp01(agent.needs.social - (hasCoworkers ? 0.01 : 0)),
    },
  }
}

/** An engineer looks for engineering work; wages come from the occupation. */
function applySeekJob(agent: Agent, ctx: ApplyActionContext): Agent {
  if (ctx.deps.random() > HIRE_CHANCE) return agent

  const def = occupationDef(agent.occupation)
  const vacancy = [...ctx.openings.entries()].find(
    ([id, free]) => free > 0 && ctx.kindOf.get(id) === def.worksAt,
  )
  if (vacancy == null) return agent

  ctx.openings.set(vacancy[0], vacancy[1] - 1)
  ctx.events.push({ type: 'hired', tick: ctx.tick, agent: agent.id })
  return {
    ...agent,
    job: {
      employerId: vacancy[0],
      wage: def.wage,
      shiftStart: def.shiftStart,
      shiftEnd: def.shiftEnd,
    },
  }
}

/**
 * Spends what is available rather than what the vice costs: paying in full
 * clears the urge, paying part of it leaves 30% behind.
 */
function applyVice(agent: Agent, action: Action): Agent {
  const kind = action.targetAgent
  const indulged = agent.vices.find((v) => v.kind === kind) ?? agent.vices[0]!
  const fullCost = viceDef(indulged.kind).moneyCost
  const cost = Math.min(fullCost, agent.money)
  const vices = agent.vices.map((v) =>
    v.kind === indulged.kind ? { ...v, urge: cost >= fullCost ? 0 : v.urge * 0.3 } : v,
  ) as Agent['vices']
  return { ...agent, vices, money: agent.money - cost }
}

function applyTheft(agent: Agent, action: Action, ctx: ApplyActionContext): Agent {
  const victim = action.targetAgent == null ? undefined : ctx.draft.get(action.targetAgent)
  if (victim == null) return agent

  const amount = Math.floor(Math.min(victim.money, MAX_THEFT))
  if (amount <= 0) return agent

  ctx.draft.set(victim.id, { ...victim, money: victim.money - amount })
  ctx.events.push({ type: 'theft', tick: ctx.tick, thief: agent.id, victim: victim.id, amount })
  return { ...agent, money: agent.money + amount, lastTheftTick: ctx.tick }
}
