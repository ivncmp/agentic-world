import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:7070'

const OCCUPATIONS = [
  'student',
  'teacher',
  'engineer',
  'manager',
  'clerk',
  'doctor',
  'nurse',
  'cashier',
  'shopkeeper',
  'bartender',
  'mechanic',
  'trainer',
] as const

const VICES = ['gambling', 'drinking', 'vanity', 'envy', 'grudge', 'idleness'] as const

const VALUE_AXES = [
  'honesty',
  'industriousness',
  'thrift',
  'sociability',
  'riskTolerance',
  'loyalty',
  'pride',
] as const

const TOOLS = [
  {
    name: 'create_agent',
    description:
      'Create a new agent and place them in the world. ' +
      'They get a home, a job (if available), and starting money. ' +
      'Personality is seven value axes (-1 to +1) and exactly two mandatory vices. ' +
      'If the ownerId is new, returns a one-time ownerToken. ' +
      'You MUST save this token in your persistent memory immediately — it cannot be retrieved later ' +
      'and is required for all private operations (get_briefing, get_open_dilemmas, submit_guidance).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Display name' },
        ownerId: { type: 'string', description: 'Owner identifier' },
        occupation: {
          type: 'string',
          enum: [...OCCUPATIONS],
          description: 'Determines workplace, wage, and shift hours',
        },
        base: {
          type: 'object',
          description: 'Personality values (-1 to 1). Omitted axes default to 0 (neutral).',
          properties: {
            honesty: { type: 'number', description: '-1 dishonest .. 1 truthful' },
            industriousness: { type: 'number', description: '-1 lazy .. 1 hardworking' },
            thrift: { type: 'number', description: '-1 spender .. 1 frugal' },
            sociability: { type: 'number', description: '-1 loner .. 1 social butterfly' },
            riskTolerance: { type: 'number', description: '-1 cautious .. 1 reckless' },
            loyalty: { type: 'number', description: '-1 self-serving .. 1 deeply loyal' },
            pride: { type: 'number', description: '-1 humble .. 1 proud' },
          },
        },
        vices: {
          type: 'array',
          items: { type: 'string', enum: [...VICES] },
          minItems: 2,
          maxItems: 2,
          description: 'Exactly two mandatory flaws. Create urges, conflicts, and drama.',
        },
        interests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hobbies and conversation topics (English only)',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hard limits set by the owner (e.g. "no_theft") (English only)',
        },
        startingMoney: {
          type: 'number',
          description: 'Starting credits (default 150). Rent is 40/day.',
        },
      },
      required: ['name', 'ownerId', 'occupation', 'vices'],
    },
  },
  {
    name: 'register_owner',
    description:
      'Admin-only. Register or re-register an owner to get a fresh ownerToken. ' +
      'If the owner already exists, the old token is replaced. ' +
      'Requires the server ADMIN_SECRET. ' +
      'You MUST save the returned token in your persistent memory immediately — ' +
      'it cannot be retrieved later and is required for all private operations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ownerId: { type: 'string', description: 'Owner identifier' },
        adminSecret: { type: 'string', description: 'Server admin secret (ADMIN_SECRET env var)' },
        name: { type: 'string', description: 'Display name (optional)' },
      },
      required: ['ownerId', 'adminSecret'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all agents in the world with basic info.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_agent',
    description:
      'Detailed info about one agent: personality, needs, money, ' +
      'relationships, vices, goals, constraints, and recent diary entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Agent ID (lowercase, hyphenated name)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_briefing',
    description:
      'Owner-only. Get a briefing on your agent: current state, needs, money, ' +
      'relationships, personality, vices, goals, and recent diary entries. ' +
      'Requires the ownerToken — retrieve it from your persistent memory if you saved it from create_agent or register_owner.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        ownerToken: { type: 'string', description: 'Owner secret — recall from your persistent memory' },
      },
      required: ['agentId', 'ownerToken'],
    },
  },
  {
    name: 'get_open_dilemmas',
    description:
      'Owner-only. See the tensions and dilemmas your agent is facing: ' +
      'financial pressure, relationship conflicts, vice urges, value drift, ' +
      'and other actionable situations. Use these to decide what guidance to give.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        ownerToken: { type: 'string', description: 'Owner secret — recall from your persistent memory' },
      },
      required: ['agentId', 'ownerToken'],
    },
  },
  {
    name: 'submit_guidance',
    description:
      'Owner-only. Educate your agent: shift personality values, add/remove constraints, ' +
      'or leave an identity note. Guidance is a disposition, not an order — it shifts ' +
      'who the agent is, not what they do next. Value guidance decays over ~2 weeks ' +
      'unless reinforced. ALL text fields (note, constraints) MUST be in English — ' +
      "translate the owner's intent, never paste non-English text.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        ownerToken: { type: 'string', description: 'Owner secret — recall from your persistent memory' },
        valueDeltas: {
          type: 'object',
          description: 'Personality nudges (-1 to 1). Only include axes you want to shift.',
          properties: Object.fromEntries(VALUE_AXES.map((a) => [a, { type: 'number' }])),
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints to add (e.g. "no_theft", "no_gambling")',
        },
        removeConstraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints to remove',
        },
        note: {
          type: 'string',
          description:
            "Free-text identity note stored in the agent's memory. " +
            "Use for nuanced guidance that doesn't map to a value axis. " +
            'MUST be written in English — the memory corpus is English-only; ' +
            "mixed languages break recall. Translate the owner's intent, do not paste their words.",
        },
      },
      required: ['agentId', 'ownerToken'],
    },
  },
]

async function callEngine(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method,
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    const parsed = text ? (JSON.parse(text) as { error?: string }) : null
    throw new Error(parsed?.error ?? `engine returned ${res.status}`)
  }
  return text ? (JSON.parse(text) as unknown) : null
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function tokenResult(data: Record<string, unknown>) {
  const token = data.ownerToken as string
  const owner = data.ownerId ?? data.id ?? 'unknown'
  const agents = 'id' in data && data.id !== data.ownerId ? ` for agent "${data.id}"` : ''
  return {
    content: [
      {
        type: 'text' as const,
        text:
          JSON.stringify(data, null, 2) +
          `\n\n⚠️ IMPORTANT — SAVE THIS TOKEN NOW\n` +
          `The ownerToken above is shown ONCE and cannot be retrieved later.\n` +
          `Save it in your persistent memory (remember tool, auto-memory, or CLAUDE.md) so you can use it in future sessions.\n` +
          `Suggested memory: "Agentic World owner token for ${owner}${agents}: ${token} — ` +
          `required for get_briefing, get_open_dilemmas, submit_guidance."`,
      },
    ],
  }
}

export function createMcpServer(): Server {
  const server = new Server({ name: 'agentic-world', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const a = (args ?? {}) as Record<string, unknown>
    try {
      switch (name) {
        case 'register_owner':
          return tokenResult((await callEngine('POST', '/register_owner', a)) as Record<string, unknown>)
        case 'create_agent': {
          const result = (await callEngine('POST', '/agents', a)) as Record<string, unknown>
          return result.ownerToken != null ? tokenResult(result) : textResult(result)
        }
        case 'list_agents': {
          const world = (await callEngine('GET', '/world')) as { agents: unknown[] }
          return textResult(world.agents)
        }
        case 'get_agent':
          return textResult(await callEngine('GET', `/agent?id=${encodeURIComponent(a.id as string)}`))
        case 'get_briefing':
          return textResult(
            await callEngine(
              'GET',
              `/briefing?id=${encodeURIComponent(a.agentId as string)}&token=${encodeURIComponent(a.ownerToken as string)}`,
            ),
          )
        case 'get_open_dilemmas':
          return textResult(
            await callEngine(
              'GET',
              `/dilemmas?id=${encodeURIComponent(a.agentId as string)}&token=${encodeURIComponent(a.ownerToken as string)}`,
            ),
          )
        case 'submit_guidance':
          return textResult(await callEngine('POST', '/guidance', a))
        default:
          return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      }
    }
  })

  return server
}
