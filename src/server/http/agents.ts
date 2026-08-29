/**
 * Agent-facing HTTP: the spectator's agent card, and creating a new agent.
 *
 * Both run per human request rather than per tick, so a few joins and a
 * database round trip are affordable here in a way they never are in the loop.
 */
import type { ServerResponse } from 'node:http'
import { pairKey } from '../../engine/tick.js'
import { resolveValues, VALUE_AXES, type ValueAxis } from '../../agents/values.js'
import { viceDef, VICE_CATALOG, type ViceKind } from '../../agents/vices.js'
import { occupationDef, OCCUPATIONS } from '../../world/occupations.js'
import { createAgent, type CreateAgentInput } from '../../agents/create.js'
import { buildFoundingIdentity } from '../../agents/identity.js'
import { DbrainStore } from '../../memory/dbrain-store.js'
import { json, failFrom, round2 } from './respond.js'
import type { World } from '../world/context.js'
import type { LiveFeed } from '../world/feed.js'

/** How much a relationship matters, for ordering the agent card's list. */
const weight = (r: { affection: number; grievance: number; debt: number }): number =>
  Math.abs(r.affection) + r.grievance + Math.abs(r.debt) / 100

/**
 * Everything the spectator view needs about one agent: the three personality
 * strata side by side, the vices with their current pressure, live needs, who
 * they know, and the diaries.
 */
export async function agentDetail(world: World, id: string): Promise<unknown | null> {
  const a = world.state.agents.find((x) => x.id === id)
  if (a == null) return null

  const effective = resolveValues(a.values, world.now)
  const known = world.state.agents
    .filter((o) => o.id !== a.id)
    .map((o) => {
      const rel = world.state.relationships.get(pairKey(a.id, o.id))
      if (rel == null || rel.encounters === 0) return null
      return {
        id: o.id,
        name: o.name,
        affection: round2(rel.affection),
        trust: round2(rel.trust),
        // Debt is signed relative to the pair key, whose first member is the
        // lexicographically smaller id. Flip it when this agent is the second
        // one, or the card shows the creditor as the debtor. Compare the ids
        // the same way pairKey does — matching on the key string would break
        // the day one id is a prefix of another.
        debt: round2(a.id < o.id ? rel.debt : -rel.debt),
        grievance: round2(rel.grievance),
        encounters: rel.encounters,
      }
    })
    .filter((x) => x != null)
    .sort((x, y) => weight(y) - weight(x))

  return {
    id: a.id,
    name: a.name,
    occupation: occupationDef(a.occupation).label,
    money: Math.round(a.money),
    location: world.placeOf(a.location),
    activity: a.activity?.kind ?? 'idle',
    job:
      a.job == null
        ? null
        : {
            employer: world.placeOf(a.job.employerId),
            wage: a.job.wage,
            shift: `${a.job.shiftStart}:00–${a.job.shiftEnd}:00`,
          },
    housing: a.housing,
    needs: a.needs,
    goals: a.goals,
    constraints: a.constraints,
    values: VALUE_AXES.map((axis) => ({
      axis,
      base: round2(a.values.base[axis]),
      drift: round2(a.values.drift[axis]),
      effective: round2(effective[axis]),
    })),
    vices: a.vices.map((v) => ({ kind: v.kind, label: viceDef(v.kind).label, urge: round2(v.urge) })),
    relationships: known,
    diaries: (await world.history?.recentDiaries(a.id, 7)) ?? [],
  }
}

/** Validate a create-agent request body into the input the factory accepts. */
function parseCreateInput(world: World, raw: Record<string, unknown>): CreateAgentInput {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name === '') throw new Error('name is required')

  const ownerId = typeof raw.ownerId === 'string' ? raw.ownerId.trim() : ''
  if (ownerId === '') throw new Error('ownerId is required')

  if (typeof raw.occupation !== 'string' || !(raw.occupation in OCCUPATIONS))
    throw new Error(`occupation must be one of: ${Object.keys(OCCUPATIONS).join(', ')}`)

  // Exactly two vices, always: they are the designed friction against every
  // agent converging on the same agreeable personality.
  if (
    !Array.isArray(raw.vices) ||
    raw.vices.length !== 2 ||
    !raw.vices.every((v: unknown) => typeof v === 'string' && v in VICE_CATALOG)
  )
    throw new Error(`vices must be exactly 2 from: ${Object.keys(VICE_CATALOG).join(', ')}`)

  const id =
    typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id.trim()
      : name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
  if (world.state.agents.some((a) => a.id === id)) throw new Error(`agent "${id}" already exists`)

  const base: Partial<Record<ValueAxis, number>> = {}
  if (raw.base != null && typeof raw.base === 'object') {
    for (const [k, v] of Object.entries(raw.base as Record<string, unknown>)) {
      if (!(VALUE_AXES as readonly string[]).includes(k)) throw new Error(`unknown value axis: ${k}`)
      if (typeof v !== 'number' || v < -1 || v > 1) throw new Error(`${k} must be between -1 and 1`)
      base[k as ValueAxis] = v
    }
  }

  const strings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []

  return {
    id,
    name,
    ownerId,
    occupation: raw.occupation as CreateAgentInput['occupation'],
    base,
    vices: raw.vices as [ViceKind, ViceKind],
    interests: strings(raw.interests),
    constraints: strings(raw.constraints),
    startingMoney: typeof raw.startingMoney === 'number' ? raw.startingMoney : undefined,
  }
}

/**
 * Creates an agent and moves them into town: allocate a home, seed the founding
 * identity into dbrain, save, and announce the arrival on the feed.
 */
export async function addAgent(
  world: World,
  feed: LiveFeed,
  body: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const input = parseCreateInput(world, JSON.parse(body) as Record<string, unknown>)
    const created = createAgent(input, world.city)

    world.state = { ...world.state, agents: [...world.state.agents, created.agent] }
    world.addLocation(created.home)

    // First agent for an unknown owner mints their token — there is no other
    // moment where the owner is guaranteed to be listening.
    let ownerToken: string | null = null
    if (world.owners != null && !(await world.owners.exists(input.ownerId))) {
      ownerToken = await world.owners.register(input.ownerId, input.name)
    }

    if (world.store instanceof DbrainStore) await world.store.ensureAgent(input.id, input.name)
    for (const fact of buildFoundingIdentity(created.agent)) {
      await world.store.remember({
        agentId: created.agent.id,
        kind: 'identity',
        text: fact,
        tick: world.state.tick,
      })
    }

    await world.save()
    feed.publish('arrival', `${created.agent.name} moved to town`)
    feed.broadcast(feed.snapshot())

    json(res, 201, {
      id: created.agent.id,
      name: created.agent.name,
      home: created.home.name,
      district: created.home.district,
      job:
        created.agent.job == null
          ? null
          : {
              employer: world.placeOf(created.agent.job.employerId),
              wage: created.agent.job.wage,
            },
      money: created.agent.money,
      ...(ownerToken != null ? { ownerToken } : {}),
    })
  } catch (err) {
    failFrom(res, err)
  }
}
