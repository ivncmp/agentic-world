import { describe, it, expect } from 'vitest'
import { parseDeliberation, buildDeliberationPrompt, type DeliberationInput } from '../deliberation.js'
import type { Agent } from '../../agents/agent.js'
import { zeroVector } from '../../agents/values.js'

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  ownerId: 'o',
  occupation: 'clerk',
  values: { base: zeroVector(), drift: zeroVector(), guidance: {} },
  vices: [
    { kind: 'grudge', urge: 0 },
    { kind: 'idleness', urge: 0 },
  ],
  needs: { hunger: 0.2, energy: 0.3, social: 0.4, hygiene: 0.2, fun: 0.3 },
  money: 80,
  location: 'bar-1',
  job: { employerId: 'office-1', wage: 15, shiftStart: 9, shiftEnd: 17 },
  housing: { kind: 'rent', due: 25, arrears: 0 },
  arrivedTick: null,
  lastTheftTick: null,
  lastReflectionDay: 0,
  activity: null,
  goals: [],
  constraints: [],
  interests: ['poker', 'cooking'],
  deliberation: null,
  lastDeliberationTick: 0,
  lastCrisisTick: 0,
  ...over,
})

const validIds = new Set(['alice', 'bob', 'carol'])

describe('parseDeliberation', () => {
  it('parses well-formed JSON', () => {
    const text = JSON.stringify({
      biases: [
        { action: 'eat', bias: 0.8 },
        { action: 'work', bias: -0.3 },
      ],
      seekScene: [{ target: 'alice', reason: 'we should meet' }],
      conversationSeed: 'the new park opening',
      thought: 'I should eat something before work.',
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.biases).toHaveLength(2)
    expect(o.biases[0]).toEqual({ action: 'eat', bias: 0.8 })
    expect(o.seekScene).toHaveLength(1)
    expect(o.seekScene[0]?.target).toBe('alice')
    expect(o.conversationSeed).toBe('the new park opening')
    expect(o.thought).toBe('I should eat something before work.')
  })

  it('rejects invalid action kinds', () => {
    const text = JSON.stringify({
      biases: [
        { action: 'fly_to_moon', bias: 1 },
        { action: 'eat', bias: 0.5 },
      ],
      seekScene: [],
      conversationSeed: null,
      thought: 'hmm',
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.biases).toHaveLength(1)
    expect(o.biases[0]?.action).toBe('eat')
  })

  it('rejects unknown agent ids in seekScene', () => {
    const text = JSON.stringify({
      biases: [],
      thought: '',
      seekScene: [
        { target: 'unknown-agent', reason: 'why' },
        { target: 'alice', reason: 'ok' },
      ],
      conversationSeed: null,
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.seekScene).toHaveLength(1)
    expect(o.seekScene[0]?.target).toBe('alice')
  })

  it('rejects self-targeting in seekScene', () => {
    const text = JSON.stringify({
      biases: [],
      thought: '',
      conversationSeed: null,
      seekScene: [{ target: 'bob', reason: 'talk to myself' }],
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.seekScene).toHaveLength(0)
  })

  it('clamps bias values to [-1, 1]', () => {
    const text = JSON.stringify({
      biases: [
        { action: 'work', bias: 5 },
        { action: 'eat', bias: -3 },
      ],
      seekScene: [],
      conversationSeed: null,
      thought: '',
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.biases[0]?.bias).toBe(1)
    expect(o.biases[1]?.bias).toBe(-1)
  })

  it('limits biases to 4', () => {
    const text = JSON.stringify({
      biases: [
        { action: 'eat', bias: 0.1 },
        { action: 'work', bias: 0.2 },
        { action: 'sleep', bias: 0.3 },
        { action: 'relax', bias: 0.4 },
        { action: 'browse', bias: 0.5 },
      ],
      seekScene: [],
      conversationSeed: null,
      thought: '',
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.biases).toHaveLength(4)
  })

  it('limits seekScene to 2', () => {
    const text = JSON.stringify({
      biases: [],
      thought: '',
      conversationSeed: null,
      seekScene: [
        { target: 'alice', reason: 'a' },
        { target: 'bob', reason: 'b' },
        { target: 'carol', reason: 'c' },
      ],
    })
    // 'bob' is self, so filtered. That leaves alice and carol = 2.
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.seekScene).toHaveLength(2)
  })

  it('handles missing fields gracefully', () => {
    const text = JSON.stringify({ thought: 'only thought' })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.biases).toHaveLength(0)
    expect(o.seekScene).toHaveLength(0)
    expect(o.conversationSeed).toBeNull()
    expect(o.thought).toBe('only thought')
  })

  it('extracts JSON from surrounding text', () => {
    const text =
      'Here is my response:\n{"biases":[],"seekScene":[],"conversationSeed":null,"thought":"test"}\nDone.'
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.thought).toBe('test')
  })

  it('treats literal string "null" as null for conversationSeed', () => {
    const text = JSON.stringify({
      biases: [],
      seekScene: [],
      conversationSeed: 'null',
      thought: '',
    })
    const o = parseDeliberation(text, validIds, 'bob')
    expect(o.conversationSeed).toBeNull()
  })
})

describe('buildDeliberationPrompt', () => {
  const baseInput = (): DeliberationInput => ({
    agent: agent('bob', {
      housing: { kind: 'rent', due: 25, arrears: 30 },
      needs: { hunger: 0.5, energy: 0.3, social: 0.6, hygiene: 0.2, fun: 0.3 },
    }),
    values: zeroVector(),
    hour: 14,
    recentMemories: [],
    relationships: [],
    allAgentNames: [
      { id: 'bob', name: 'Bob' },
      { id: 'alice', name: 'Alice' },
    ],
  })

  it('includes arrears when present', () => {
    const prompt = buildDeliberationPrompt(baseInput())
    expect(prompt).toContain('Behind on rent by 30 credits')
  })

  it('includes hunger warning', () => {
    const input = baseInput()
    input.agent = agent('bob', {
      money: 5,
      needs: { hunger: 0.5, energy: 0.3, social: 0.3, hygiene: 0.2, fun: 0.3 },
    })
    const prompt = buildDeliberationPrompt(input)
    expect(prompt).toContain('Hungry but cannot afford food')
  })

  it('lists other agents by id', () => {
    const prompt = buildDeliberationPrompt(baseInput())
    expect(prompt).toContain('Alice (alice)')
    expect(prompt).not.toContain('Bob (bob)')
  })
})
