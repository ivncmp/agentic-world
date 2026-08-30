/**
 * Assembling a new agent and moving them into town.
 *
 * Validation lives at the HTTP edge; by the time input reaches here it is
 * trusted. What this owns is the starting position: a home allocated from the
 * city's free plots, an occupation with its wage and shift, two vices at rest,
 * and enough money to survive the first few days without immediately being
 * desperate.
 */
import type { Agent, Housing } from './agent.js'
import { zeroVector, type ValueVector } from './values.js'
import type { ViceKind, ViceInstance } from './vices.js'
import type { GeneratedCity } from '../world/generator.js'
import type { Location } from '../world/locations.js'
import { occupationDef, type Occupation } from '../world/occupations.js'
import type { Goal } from './agent.js'

/**
 * Creating an agent is a runtime operation — the world starts empty and people
 * join through MCP. This is what that endpoint will call, so it must produce a
 * fully placed agent: a private home, a job if one is going, and money.
 */
/** What an owner supplies. Anything omitted gets a sensible default. */
export type CreateAgentInput = {
  id: string
  name: string
  ownerId: string
  occupation: Occupation
  /** Owner-authored personality. Anything omitted sits at neutral. */
  base?: Partial<ValueVector>
  /** Exactly two — DESIGN.md's mandatory flaws. */
  vices: [ViceKind, ViceKind]
  interests?: string[]
  constraints?: string[]
  startingMoney?: number
}

/** The agent plus the home allocated for them, which the world must register. */
export type CreatedAgent = {
  agent: Agent
  /** The agent's own home, to be added to the world's locations. */
  home: Location
}

/** Enough to eat and pay rent for a few days — not enough to be comfortable. */
export const STARTING_MONEY = 150
/** Charged daily. Set against wages so a job covers it and idleness does not. */
export const RENT_DUE = 25

const initialGoals = (vacancy: string | null, homeId: string): Goal[] => {
  const goals: Goal[] = [{ kind: 'buy_home', targetId: homeId, priority: 0.4 }]
  if (vacancy == null) goals.push({ kind: 'get_job', targetId: undefined, priority: 0.9 })
  return goals
}

/**
 * Builds the agent and allocates their home. Mutates the city's plot pool, so
 * two calls never hand out the same tile.
 */
export function createAgent(input: CreateAgentInput, city: GeneratedCity): CreatedAgent {
  // The district comes with the plot rather than being chosen separately: it
  // decides which bar and which park this agent habitually uses, so it has to
  // describe where they actually live.
  const plot = city.allocateHome()
  const home: Location = {
    id: `home-${input.id}`,
    kind: 'home',
    name: `${input.name}'s place`,
    district: plot.district,
    tile: plot.tile,
    residentId: input.id,
  }

  const def = occupationDef(input.occupation)
  const vacancy = city.locations.find((l) => l.kind === def.worksAt && (city.openings.get(l.id) ?? 0) > 0)
  if (vacancy != null) {
    city.openings.set(vacancy.id, (city.openings.get(vacancy.id) ?? 1) - 1)
  }

  const housing: Housing = { kind: 'rent', due: RENT_DUE, arrears: 0 }

  const agent: Agent = {
    id: input.id,
    name: input.name,
    ownerId: input.ownerId,
    occupation: input.occupation,
    values: {
      base: { ...zeroVector(), ...input.base },
      drift: zeroVector(),
      guidance: {},
    },
    vices: input.vices.map((kind) => ({ kind, urge: 0.1 })) as [ViceInstance, ViceInstance],
    interests: input.interests ?? [],
    needs: { hunger: 0.2, energy: 0.2, social: 0.3, hygiene: 0.2, fun: 0.2 },
    money: input.startingMoney ?? STARTING_MONEY,
    location: home.id,
    job:
      vacancy == null
        ? null
        : {
            employerId: vacancy.id,
            wage: def.wage,
            shiftStart: def.shiftStart,
            shiftEnd: def.shiftEnd,
          },
    housing,
    arrivedTick: null,
    lastTheftTick: null,
    lastReflectionDay: 0,
    activity: null,
    // Seeded so a brand-new agent has a reason to act before its first
    // day rollover; refreshed from the world every night thereafter.
    goals: initialGoals(vacancy?.id ?? null, home.id),
    constraints: input.constraints ?? [],
    deliberation: null,
    lastDeliberationTick: 0,
    lastCrisisTick: 0,
  }

  return { agent, home }
}
