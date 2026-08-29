/**
 * The owner loop's HTTP surface: briefing, dilemmas, guidance, registration.
 *
 * The owner never enters the world. They read a briefing, see the tensions the
 * engine surfaces, and send back **dispositions** — value nudges and rules.
 * Nothing here selects an agent's next action; if the owner could predict what
 * happens tomorrow, the question was the wrong one.
 */
import type { ServerResponse } from 'node:http'
import { pairKey } from '../../engine/tick.js'
import { TICKS_PER_DAY, worldTime } from '../../engine/clock.js'
import { resolveValues, VALUE_AXES, type ValueAxis } from '../../agents/values.js'
import { viceDef } from '../../agents/vices.js'
import { occupationDef } from '../../world/occupations.js'
import { json, fail, failFrom, round2 } from './respond.js'
import type { World } from '../world/context.js'
import type { LiveFeed } from '../world/feed.js'
import type { Agent } from '../../agents/agent.js'

/**
 * Guidance fades unless the owner reinforces it. Education is a habit, not a
 * one-off command — without decay, one nudge would define the agent forever.
 */
const GUIDANCE_HALF_LIFE_DAYS = 14

/** Urge above which a vice is worth raising with the owner. */
const VICE_PRESSURE = 0.6
/** Grievance above which bad blood is worth raising. */
const GRIEVANCE_FLOOR = 0.4
/** Credits owed above which a debt is worth raising. */
const DEBT_FLOOR = 50
/** How far effective values may drift from base before it is worth mentioning. */
const DRIFT_FLOOR = 0.4

type AuthResult = { ok: true; agent: Agent } | { ok: false; error: string; status: number }

/** An owner may only ever act on their own agents. */
async function authenticate(world: World, agentId: string, token: string): Promise<AuthResult> {
  if (world.owners == null) return { ok: false, error: 'persistence is disabled', status: 500 }
  const agent = world.state.agents.find((a) => a.id === agentId)
  if (agent == null) return { ok: false, error: `agent "${agentId}" not found`, status: 404 }
  if (!(await world.owners.validate(agent.ownerId, token))) {
    return { ok: false, error: 'invalid owner token', status: 403 }
  }
  return { ok: true, agent }
}

/** Relationships as the owner sees them: no encounter counts, no internals. */
function relationshipsFor(world: World, a: Agent) {
  return world.state.agents
    .filter((o) => o.id !== a.id)
    .map((o) => {
      const rel = world.state.relationships.get(pairKey(a.id, o.id))
      if (rel == null || rel.encounters === 0) return null
      return {
        id: o.id,
        name: o.name,
        affection: round2(rel.affection),
        trust: round2(rel.trust),
        debt: round2(a.id < o.id ? rel.debt : -rel.debt),
        grievance: round2(rel.grievance),
      }
    })
    .filter((x) => x != null)
}

/** Where the agent stands right now, in the owner's terms. */
export async function handleBriefing(
  world: World,
  agentId: string,
  token: string,
  res: ServerResponse,
): Promise<void> {
  const auth = await authenticate(world, agentId, token)
  if (!auth.ok) return fail(res, auth.status, auth.error)
  const a = auth.agent
  const effective = resolveValues(a.values, world.now)

  json(res, 200, {
    id: a.id,
    name: a.name,
    occupation: occupationDef(a.occupation).label,
    day: Math.floor(world.state.tick / TICKS_PER_DAY) + 1,
    time: worldTime(world.state.tick).toISOString(),
    money: Math.round(a.money),
    housing: a.housing,
    needs: a.needs,
    job:
      a.job == null
        ? null
        : {
            employer: world.placeOf(a.job.employerId),
            wage: a.job.wage,
            shift: `${a.job.shiftStart}:00–${a.job.shiftEnd}:00`,
          },
    goals: a.goals,
    constraints: a.constraints,
    values: VALUE_AXES.map((axis) => ({
      axis,
      base: round2(a.values.base[axis]),
      drift: round2(a.values.drift[axis]),
      effective: round2(effective[axis]),
    })),
    vices: a.vices.map((v) => ({ kind: v.kind, label: viceDef(v.kind).label, urge: round2(v.urge) })),
    relationships: relationshipsFor(world, a),
    diaries: (await world.history?.recentDiaries(a.id, 3)) ?? [],
  })
}

type Dilemma = { kind: string; severity: number; summary: string; detail?: unknown }

/**
 * Actionable tensions, most severe first. The engine surfaces the raw pressure;
 * the owner's own Claude turns it into a question worth answering.
 */
export async function handleDilemmas(
  world: World,
  agentId: string,
  token: string,
  res: ServerResponse,
): Promise<void> {
  const auth = await authenticate(world, agentId, token)
  if (!auth.ok) return fail(res, auth.status, auth.error)
  const a = auth.agent

  const dilemmas: Dilemma[] = []
  const effective = resolveValues(a.values, world.now)

  if (a.housing.arrears > 0) {
    dilemmas.push({
      kind: 'arrears',
      severity: Math.min(1, a.housing.arrears / 200),
      summary: `${a.name} owes ${a.housing.arrears} in unpaid rent`,
      detail: { arrears: a.housing.arrears },
    })
  }
  if (a.money < a.housing.due * 2) {
    dilemmas.push({
      kind: 'broke',
      severity: Math.min(1, 1 - a.money / (a.housing.due * 3)),
      summary: `${a.name} has only ${Math.round(a.money)} credits — less than 2 days of rent`,
    })
  }
  if (a.job == null) {
    dilemmas.push({ kind: 'unemployed', severity: 0.8, summary: `${a.name} is unemployed` })
  }

  for (const v of a.vices) {
    if (v.urge <= VICE_PRESSURE) continue
    dilemmas.push({
      kind: 'vice_pressure',
      severity: v.urge,
      summary: `${viceDef(v.kind).label} urge is building (${round2(v.urge)})`,
      detail: { vice: v.kind, urge: round2(v.urge) },
    })
  }

  for (const o of world.state.agents) {
    if (o.id === a.id) continue
    const rel = world.state.relationships.get(pairKey(a.id, o.id))
    if (rel == null) continue
    if (rel.grievance > GRIEVANCE_FLOOR) {
      dilemmas.push({
        kind: 'grievance',
        severity: rel.grievance,
        summary: `Bad blood with ${o.name} (grievance ${round2(rel.grievance)})`,
        detail: { other: o.id, otherName: o.name, grievance: round2(rel.grievance) },
      })
    }
    const debt = a.id < o.id ? rel.debt : -rel.debt
    if (debt > DEBT_FLOOR) {
      dilemmas.push({
        kind: 'debt_owed',
        severity: Math.min(1, debt / 200),
        summary: `${a.name} owes ${round2(debt)} credits to ${o.name}`,
        detail: { creditor: o.id, creditorName: o.name, amount: round2(debt) },
      })
    }
  }

  // Life pulling against the personality the owner authored is itself the story
  for (const axis of VALUE_AXES) {
    const gap = effective[axis] - a.values.base[axis]
    if (Math.abs(gap) <= DRIFT_FLOOR) continue
    dilemmas.push({
      kind: 'value_drift',
      severity: Math.abs(gap),
      summary: `${axis} has drifted ${gap > 0 ? '+' : ''}${round2(gap)} from the base personality`,
      detail: { axis, base: round2(a.values.base[axis]), effective: round2(effective[axis]) },
    })
  }

  dilemmas.sort((x, y) => y.severity - x.severity)
  json(res, 200, { agentId: a.id, agentName: a.name, dilemmas })
}

/**
 * Applies typed guidance. The typed fields feed the reflex layer for free every
 * tick; the prose note becomes identity memory in dbrain, which is the only
 * place free text is affordable.
 */
export async function handleGuidance(
  world: World,
  feed: LiveFeed,
  body: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>
    const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : ''
    const token = typeof raw.ownerToken === 'string' ? raw.ownerToken.trim() : ''
    if (agentId === '' || token === '') throw new Error('agentId and ownerToken are required')

    const auth = await authenticate(world, agentId, token)
    if (!auth.ok) return fail(res, auth.status, auth.error)
    const a = auth.agent

    const applied: string[] = []
    const deltas: string[] = []
    const added: string[] = []
    const removed: string[] = []

    if (raw.valueDeltas != null && typeof raw.valueDeltas === 'object') {
      for (const [k, v] of Object.entries(raw.valueDeltas as Record<string, unknown>)) {
        if (!(VALUE_AXES as readonly string[]).includes(k)) throw new Error(`unknown value axis: ${k}`)
        if (typeof v !== 'number' || v < -1 || v > 1) throw new Error(`${k} delta must be between -1 and 1`)
        a.values.guidance[k as ValueAxis] = {
          delta: v,
          setAt: world.now,
          halfLifeDays: GUIDANCE_HALF_LIFE_DAYS,
        }
        deltas.push(`${k} ${v > 0 ? '+' : ''}${v}`)
        applied.push(`guidance.${k} = ${v > 0 ? '+' : ''}${v}`)
      }
    }

    if (Array.isArray(raw.constraints)) {
      for (const c of raw.constraints.filter((x): x is string => typeof x === 'string')) {
        if (a.constraints.includes(c)) continue
        a.constraints.push(c)
        added.push(c)
        applied.push(`+constraint "${c}"`)
      }
    }

    if (Array.isArray(raw.removeConstraints)) {
      for (const c of raw.removeConstraints.filter((x): x is string => typeof x === 'string')) {
        const idx = a.constraints.indexOf(c)
        if (idx < 0) continue
        a.constraints.splice(idx, 1)
        removed.push(c)
        applied.push(`-constraint "${c}"`)
      }
    }

    const note = typeof raw.note === 'string' ? raw.note.trim() : ''
    if (note !== '') applied.push('identity note saved')

    // The agent remembers being educated, in their own voice — that memory is
    // what a later scene or reflection actually reads.
    const parts: string[] = []
    if (deltas.length > 0) parts.push(`My owner nudged my personality: ${deltas.join(', ')}.`)
    if (added.length > 0) parts.push(`New rules from my owner: ${added.join(', ')}.`)
    if (removed.length > 0) parts.push(`My owner lifted restrictions: ${removed.join(', ')}.`)
    if (note !== '') parts.push(`My owner told me: "${note}"`)
    if (parts.length > 0) {
      await world.store.remember({
        agentId: a.id,
        kind: 'identity',
        text: parts.join(' '),
        tick: world.state.tick,
      })
    }

    await world.save()
    feed.publish('guidance', `${a.name} received owner guidance: ${applied.join(', ') || 'no changes'}`)
    json(res, 200, { ok: true, applied })
  } catch (err) {
    failFrom(res, err)
  }
}

/** Mints an owner token. Gated on the server's admin secret, not on a session. */
export async function handleRegisterOwner(
  world: World,
  adminSecret: string,
  body: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>

    if (adminSecret === '') throw new Error('ADMIN_SECRET not configured on the server')
    if (raw.adminSecret !== adminSecret) return fail(res, 403, 'invalid admin secret')

    const id = typeof raw.ownerId === 'string' ? raw.ownerId.trim() : ''
    if (id === '') throw new Error('ownerId is required')
    if (world.owners == null) throw new Error('persistence is disabled')

    const token = await world.owners.register(id, typeof raw.name === 'string' ? raw.name : undefined)
    json(res, 200, { ownerId: id, ownerToken: token })
  } catch (err) {
    failFrom(res, err)
  }
}
