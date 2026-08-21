import type { Agent, Goal } from './agent.js'
import type { ValueVector } from './values.js'

/**
 * Goals are the keystone. Without them a comfortable agent wants nothing, so it
 * idles and its money piles up; the gate scores a goal conflict that can never
 * happen; and the owner has nothing to advise about. Everything downstream of
 * "why would this agent do anything today" runs through here.
 */

/** Deposit needed before an agent can stop renting. */
export const HOME_DEPOSIT = 1200
/** Capital needed to start a business. */
export const BUSINESS_CAPITAL = 2000

export type GoalContext = {
  values: ValueVector
  /** Ids this agent owes money to. */
  creditors: readonly string[]
  /** How many people this agent has any relationship with. */
  acquaintances: number
  /** A workplace with a vacancy matching the agent's occupation, if any. */
  vacancy: string | null
  /** Someone worth getting to know, if the agent is short of company. */
  strangerId: string | null
}

/**
 * Derived from situation rather than stored, so goals cannot drift out of sync
 * with the world. Recomputed nightly.
 */
export function deriveGoals(agent: Agent, ctx: GoalContext): Goal[] {
  const goals: Goal[] = []
  const v = ctx.values

  if (agent.job == null && ctx.vacancy != null) {
    // Two jobless agents of the same trade chasing one vacancy is the cleanest
    // source of goal conflict in the world.
    goals.push({ kind: 'get_job', targetId: ctx.vacancy, priority: 0.9 })
  }

  for (const creditor of ctx.creditors) {
    goals.push({
      kind: 'repay_debt',
      targetId: creditor,
      priority: 0.4 + Math.max(0, v.loyalty) * 0.4 + Math.max(0, v.honesty) * 0.2,
    })
  }

  if (agent.housing.kind === 'rent' && agent.housing.arrears === 0) {
    goals.push({
      kind: 'buy_home',
      targetId: agent.location,
      priority: 0.3 + Math.max(0, v.thrift) * 0.5,
    })
  }

  if (agent.money > BUSINESS_CAPITAL * 0.4 && v.riskTolerance > 0.2) {
    goals.push({ kind: 'start_business', targetId: undefined, priority: 0.3 + v.riskTolerance * 0.5 })
  }

  if (ctx.acquaintances < 3 && ctx.strangerId != null && v.sociability > -0.3) {
    goals.push({
      kind: 'befriend',
      targetId: ctx.strangerId,
      priority: 0.3 + Math.max(0, v.sociability) * 0.5,
    })
  }

  return goals
}

/** Extra pull a goal lends to earning money. */
export function savingDrive(goals: readonly Goal[]): number {
  let drive = 0
  for (const g of goals) {
    if (g.kind === 'buy_home' || g.kind === 'start_business' || g.kind === 'repay_debt') {
      drive += g.priority
    }
  }
  return Math.min(1, drive)
}

/** Extra pull a goal lends to seeking company. */
export function socialDrive(goals: readonly Goal[]): number {
  return Math.min(1, goals.filter((g) => g.kind === 'befriend').reduce((n, g) => n + g.priority, 0))
}
