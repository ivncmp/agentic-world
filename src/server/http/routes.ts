/**
 * The engine's HTTP surface, in one table.
 *
 * The viewer and the MCP server are both clients of these endpoints — the MCP
 * server holds no world state of its own, which is what keeps the owner loop
 * from becoming a second source of truth.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { worldTime } from '../../engine/clock.js'
import { occupationDef } from '../../world/occupations.js'
import { agentDetail, addAgent } from './agents.js'
import { handleBriefing, handleDilemmas, handleGuidance, handleRegisterOwner } from './owner.js'
import { json, withBody, round2 } from './respond.js'
import type { World } from '../world/context.js'
import type { LiveFeed } from '../world/feed.js'

export type RouteDeps = {
  world: World
  feed: LiveFeed
  /** Shared secret gating owner registration and agent creation. */
  adminSecret: string
}

export function createRequestHandler(deps: RouteDeps) {
  const { world, feed, adminSecret } = deps

  return (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end()
      return
    }

    if (req.method === 'POST') {
      switch (path) {
        case '/register_owner':
          return withBody(req, (b) => handleRegisterOwner(world, adminSecret, b, res))
        case '/agents':
          return withBody(req, (b) => addAgent(world, feed, b, res))
        case '/guidance':
          return withBody(req, (b) => handleGuidance(world, feed, b, res))
      }
      res.writeHead(404); res.end()
      return
    }

    const id = url.searchParams.get('id') ?? ''
    const token = url.searchParams.get('token') ?? ''

    switch (path) {
      case '/briefing': void handleBriefing(world, id, token, res); return
      case '/dilemmas': void handleDilemmas(world, id, token, res); return
      case '/agent':
        void agentDetail(world, id).then((detail) => {
          if (detail == null) { res.writeHead(404); res.end(); return }
          json(res, 200, detail)
        })
        return
      case '/metering':
        if (world.history == null) { res.writeHead(503); res.end(); return }
        void world.history.meteringSummary().then((data) => json(res, 200, data))
        return
      case '/health':
        json(res, 200, {
          status: 'alive',
          tick: world.state.tick,
          time: worldTime(world.state.tick).toISOString(),
        })
        return
      case '/world': json(res, 200, worldPayload(world)); return
      case '/rel-graph': json(res, 200, relationshipGraph(world)); return
      case '/state': json(res, 200, { state: feed.snapshot(), feed: feed.recent() }); return
    }

    res.writeHead(404); res.end()
  }
}

/** The static picture of the city, fetched once when the viewer boots. */
function worldPayload(world: World): unknown {
  const { city } = world
  return {
    // The grid and street period travel together because the viewer rebuilds
    // the street map from the same rule the generator used, rather than the
    // server shipping a tilemap the two could then disagree about.
    city: {
      name: city.config.name,
      grid: city.layout.grid,
      streetPeriod: city.layout.streetPeriod,
      districts: city.config.districts,
      // Roles travel rather than being re-derived: which block is the plaza is
      // a layout decision, and duplicating that decision in the viewer is how
      // the two quietly stop agreeing.
      blocks: city.layout.blocks.map((b) => ({ bx: b.bx, by: b.by, role: b.role })),
      water: city.water,
    },
    locations: world.locations.map((l) => ({
      id: l.id, kind: l.kind, name: l.name, district: l.district,
      x: l.tile.x, y: l.tile.y,
    })),
    agents: world.state.agents.map((a) => ({
      id: a.id, name: a.name, occupation: occupationDef(a.occupation).label,
    })),
  }
}

/** Who knows whom, and how they feel about it. Pairs never met are omitted. */
function relationshipGraph(world: World): unknown {
  const nodes = world.state.agents.map((a) => ({ id: a.id, name: a.name }))
  const edges: {
    source: string; target: string
    affection: number; trust: number; grievance: number; encounters: number
  }[] = []

  for (const [key, rel] of world.state.relationships) {
    if (rel.encounters === 0) continue
    const parts = key.split(':')
    edges.push({
      source: parts[0]!, target: parts[1]!,
      affection: round2(rel.affection), trust: round2(rel.trust),
      grievance: round2(rel.grievance), encounters: rel.encounters,
    })
  }
  return { nodes, edges }
}
