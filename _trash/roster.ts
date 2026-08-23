import type { CreateAgentInput } from '../agents/create.js'

/** The v0 cast. Real agents will be created at runtime through MCP. */
export const ROSTER: CreateAgentInput[] = [
  { id: 'marta', name: 'Marta', ownerId: 'ivan', occupation: 'nurse',
    base: { honesty: 0.8, industriousness: 0.6, pride: 0.7 }, vices: ['grudge', 'idleness'],
    interests: ['hiking', 'crime novels', 'cooking for friends'] },
  { id: 'juan', name: 'Juan', ownerId: 'ivan', occupation: 'mechanic',
    base: { honesty: -0.6, riskTolerance: 0.7, thrift: -0.5 }, vices: ['gambling', 'drinking'],
    interests: ['football', 'motorcycles', 'card games'] },
  { id: 'lucia', name: 'Lucia', ownerId: 'ivan', occupation: 'shopkeeper',
    base: { sociability: 0.8, loyalty: 0.7, thrift: 0.6 }, vices: ['vanity', 'envy'],
    interests: ['fashion', 'neighbourhood gossip', 'dancing'] },
  { id: 'pedro', name: 'Pedro', ownerId: 'ivan', occupation: 'bartender',
    base: { industriousness: -0.5, honesty: -0.3, pride: -0.4 }, vices: ['drinking', 'idleness'],
    interests: ['music', 'fishing', 'old movies'] },
  { id: 'sara', name: 'Sara', ownerId: 'ivan', occupation: 'engineer',
    base: { industriousness: 0.9, thrift: 0.8, sociability: -0.4 }, vices: ['envy', 'vanity'],
    interests: ['puzzles', 'astronomy', 'running'] },
  { id: 'diego', name: 'Diego', ownerId: 'ivan', occupation: 'student',
    base: { sociability: 0.6, riskTolerance: 0.5, industriousness: -0.2 }, vices: ['idleness', 'envy'],
    interests: ['video games', 'skateboarding', 'comic books'] },
  { id: 'ana', name: 'Ana', ownerId: 'ivan', occupation: 'doctor',
    base: { industriousness: 0.8, pride: 0.6, loyalty: 0.4 }, vices: ['vanity', 'grudge'],
    interests: ['yoga', 'theatre', 'wine tasting'] },
  { id: 'tomas', name: 'Tomas', ownerId: 'ivan', occupation: 'cashier',
    base: { thrift: -0.7, riskTolerance: 0.8, honesty: -0.4 }, vices: ['gambling', 'drinking'],
    interests: ['bowling', 'betting on football', 'street food'] },
]
