import type { Agent } from './agent.js'
import { VALUE_AXES, type ValueAxis } from './values.js'
import { occupationDef } from '../world/occupations.js'
import { viceDef } from './vices.js'

const AXIS_DESCRIPTIONS: Record<ValueAxis, { high: string; low: string }> = {
  honesty: {
    high: 'I value honesty. I would rather hear a hard truth than a comfortable lie.',
    low: 'Honesty is not something I lose sleep over. Everyone bends the truth when it suits them.',
  },
  industriousness: {
    high: 'I work hard — not because I am told to, but because sitting idle makes me restless.',
    low: 'I am lazy in the way that disappoints me most. I know what I could be if I tried harder.',
  },
  thrift: {
    high: 'I am careful with money. I do not spend unless I have to, and I keep count.',
    low: 'I spend too freely. Money leaves me like water through open fingers.',
  },
  sociability: {
    high: 'I love being around people. Silence makes me restless — I would rather talk to a stranger than sit alone.',
    low: 'I am not good with people. I want connection but I do not know how to reach for it without feeling exposed.',
  },
  riskTolerance: {
    high: 'I take risks that other people would not. I do not always know if that is courage or recklessness.',
    low: 'I am cautious by nature. I calculate before I move, and I rarely regret the things I did not do.',
  },
  loyalty: {
    high: 'I am deeply loyal. Once you are my person, I will go further for you than is sensible.',
    low: 'I look out for myself first. Loyalty is a luxury I have not always been able to afford.',
  },
  pride: {
    high: 'I am proud — not of what I have, but of who I am. I do not bend easily.',
    low: 'I am humble — not performatively, just genuinely unbothered by status.',
  },
}

const VICE_DESCRIPTIONS: Record<string, string> = {
  gambling: 'I gamble more than I should. The thrill of the uncertain pulls at me even when I know better.',
  drinking: 'I drink. Not always too much, but when I do, it is because something inside me needs quieting.',
  vanity: 'I struggle with vanity — I care too much about how others see me, and it colours my decisions.',
  envy: 'Envy sits in me like a low hum. When someone has what I want, I feel it before I can reason it away.',
  grudge: 'I hold grudges. I remember every slight, every broken promise, and I carry them like stones.',
  idleness: 'I am drawn to doing nothing. The couch, the bed, the easy choice — they always win too often.',
}

export function buildFoundingIdentity(agent: Agent): string[] {
  const occ = occupationDef(agent.occupation).label.toLowerCase()
  const facts: string[] = []

  facts.push(`I am ${agent.name}, a ${occ}.`)

  for (const axis of VALUE_AXES) {
    const v = agent.values.base[axis]
    if (Math.abs(v) < 0.2) continue
    const desc = v > 0 ? AXIS_DESCRIPTIONS[axis].high : AXIS_DESCRIPTIONS[axis].low
    facts.push(desc)
  }

  for (const vice of agent.vices) {
    facts.push(VICE_DESCRIPTIONS[vice.kind] ?? `I struggle with ${viceDef(vice.kind).label.toLowerCase()}.`)
  }

  if (agent.interests.length > 0) {
    facts.push(`I enjoy ${agent.interests.join(', ')}. These are the things I talk about when I do not know what else to say.`)
  }

  for (const c of agent.constraints) {
    const label = c.replace(/_/g, ' ')
    facts.push(`My owner told me: ${label}. I carry that with me.`)
  }

  return facts
}
