import { describe, it, expect } from 'vitest'
import { buildCrisisPrompt, parseCrisisResponse } from '../crisis.js'
import { zeroVector } from '../../agents/values.js'
import type { Agent } from '../../agents/agent.js'

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'a', name: 'Alice', ownerId: 'o', occupation: 'clerk',
  values: { base: { ...zeroVector(), honesty: 0.8 }, drift: zeroVector(), guidance: {} },
  vices: [{ kind: 'gambling', urge: 0.75 }, { kind: 'idleness', urge: 0 }],
  needs: { hunger: 0.2, energy: 0.3, social: 0.4, hygiene: 0.2, fun: 0.3 },
  money: 80, location: 'bar-1', job: null,
  housing: { kind: 'rent', due: 25, arrears: 0 },
  arrivedTick: null, lastTheftTick: null, lastReflectionDay: 0,
  activity: null, goals: [], constraints: [], interests: [],
  deliberation: null, lastDeliberationTick: 0, lastCrisisTick: 0,
  ...over,
})

describe('buildCrisisPrompt', () => {
  it('includes agent name and occupation', () => {
    const prompt = buildCrisisPrompt({
      agent: agent(), values: { ...zeroVector(), honesty: 0.8 },
      kind: 'vice_temptation', context: 'Your gambling urge is building (75%).',
    })
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('clerk')
  })

  it('includes crisis context', () => {
    const prompt = buildCrisisPrompt({
      agent: agent(), values: zeroVector(),
      kind: 'deep_debt', context: 'You owe 100 credits in unpaid rent.',
    })
    expect(prompt).toContain('100 credits')
  })

  it('includes personality traits', () => {
    const prompt = buildCrisisPrompt({
      agent: agent(), values: { ...zeroVector(), honesty: 0.8 },
      kind: 'vice_temptation', context: 'test',
    })
    expect(prompt).toContain('high honesty')
  })
})

describe('parseCrisisResponse', () => {
  it('parses well-formed JSON', () => {
    const result = parseCrisisResponse('{"thought":"I need to stop this."}')
    expect(result).toBe('I need to stop this.')
  })

  it('extracts JSON from surrounding text', () => {
    const result = parseCrisisResponse('Here: {"thought":"The weight is crushing me."}\nDone.')
    expect(result).toBe('The weight is crushing me.')
  })

  it('falls back to raw text if no JSON', () => {
    const result = parseCrisisResponse('I feel like everything is falling apart.')
    expect(result).toBe('I feel like everything is falling apart.')
  })

  it('strips surrounding quotes from raw text', () => {
    const result = parseCrisisResponse('"I can\'t take this anymore."')
    expect(result).toBe("I can't take this anymore.")
  })

  it('truncates at 300 characters', () => {
    const long = 'x'.repeat(400)
    const result = parseCrisisResponse(`{"thought":"${long}"}`)
    expect(result.length).toBe(300)
  })

  it('handles empty thought gracefully', () => {
    const result = parseCrisisResponse('{"thought":""}')
    expect(result).toBe('')
  })
})
