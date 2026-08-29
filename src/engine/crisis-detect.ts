import type { Agent, AgentId } from '../agents/agent.js'
import { viceDef } from '../agents/vices.js'

export type CrisisKind = 'vice_temptation' | 'theft_temptation' | 'deep_debt' | 'isolation'

export type CrisisJob = {
  agent: AgentId
  kind: CrisisKind
  context: string
  tick: number
}

export type CrisisContext = {
  hour: number
  coLocated: readonly Agent[]
  scenesToday: number
}

const EAT_COST = 8
const VICE_CRISIS_THRESHOLD = 0.7
const DEBT_CRISIS_FACTOR = 2
const ISOLATION_SOCIAL_THRESHOLD = 0.65

/**
 * Detects whether an agent is in a crisis moment worth an inner thought.
 * Returns the most dramatic crisis, or null. Pure, deterministic, testable.
 */
export function detectCrisis(agent: Agent, ctx: CrisisContext): { kind: CrisisKind; context: string } | null {
  // Vice temptation — the urge is building past comfortable
  for (const vice of agent.vices) {
    if (vice.urge >= VICE_CRISIS_THRESHOLD) {
      const def = viceDef(vice.kind)
      const canAfford = def.moneyCost <= agent.money
      return {
        kind: 'vice_temptation',
        context: canAfford
          ? `Your ${def.label.toLowerCase()} urge is building (${Math.round(vice.urge * 100)}%). You could give in.`
          : `Your ${def.label.toLowerCase()} urge is building (${Math.round(vice.urge * 100)}%), but you can't afford it right now.`,
      }
    }
  }

  // Theft temptation — starving with marks nearby
  const starving = agent.money < EAT_COST && agent.needs.hunger >= 0.45
  if (starving && !agent.constraints.includes('no_theft')) {
    const marks = ctx.coLocated.filter((o) => o.money >= EAT_COST)
    if (marks.length > 0) {
      const richest = marks.reduce((best, o) => (o.money > best.money ? o : best))
      return {
        kind: 'theft_temptation',
        context: `You're broke and hungry. ${richest.name} is right here, and they have money.`,
      }
    }
  }

  // Deep debt — rent pressure is real
  if (agent.housing.kind !== 'none' && agent.housing.arrears >= agent.housing.due * DEBT_CRISIS_FACTOR) {
    return {
      kind: 'deep_debt',
      context: `You owe ${agent.housing.arrears} credits in unpaid rent. The pressure is mounting.`,
    }
  }

  // Isolation — a lonely afternoon
  if (agent.needs.social >= ISOLATION_SOCIAL_THRESHOLD && ctx.scenesToday === 0 && ctx.hour >= 14) {
    return {
      kind: 'isolation',
      context: `Nobody has spoken to you all day. The silence is getting to you.`,
    }
  }

  return null
}
