/**
 * WebSocket connection to the engine. Emits typed events so the Phaser scene
 * and DOM sidebar can both subscribe.
 */

export type AgentSnapshot = {
  id: string
  name: string
  occupation: string
  x: number
  y: number
  /** Journey endpoints and how far along it is, for street-following walks. */
  from: { x: number; y: number }
  to: { x: number; y: number }
  progress: number
  state: string
  at: string
  /** Who this agent is mid-conversation with, if anyone. */
  partner: string | null
  money: number
  arrears: number
}

export type LocationInfo = {
  id: string
  kind: string
  name: string
  district: string
  x: number
  y: number
}

/** A city block and what it is for. Roles come from the engine's layout. */
export type BlockInfo = {
  bx: number
  by: number
  role: 'plaza' | 'green' | 'civic' | 'residential'
}

export type WorldInfo = {
  city: {
    name: string
    grid: { width: number; height: number }
    streetPeriod: number
    districts: string[]
    blocks: BlockInfo[]
  }
  locations: LocationInfo[]
  agents: { id: string; name: string; occupation: string }[]
}

export type StateMsg = {
  type: 'state'
  tick: number
  time: string
  day: number
  hour: number
  minute: number
  agents: AgentSnapshot[]
  cognition: { pending: number; done: number; dropped: number; spentUsd: number; inputTokens: number; outputTokens: number }
}

export type FeedItem = {
  tick: number
  time: string
  kind: string
  text: string
  detail?: {
    a?: string
    b?: string
    dialogue?: { speaker: string; line: string }[]
    outcome?: string
    transfer?: { amount: number; from: string; to: string }
    text?: string
    drift?: Record<string, number>
    thought?: string
    crisisKind?: string
    biases?: { action: string; bias: number }[]
    seekScene?: { target: string }[]
    seed?: string
    gossip?: string
    [key: string]: unknown
  }
}

/** The full card behind a click on an agent. Mirrors the engine's /agent shape. */
export type AgentDetail = {
  id: string
  name: string
  occupation: string
  money: number
  location: string
  activity: string
  job: { employer: string; wage: number; shift: string } | null
  housing: { kind: string; due: number; arrears: number }
  needs: Record<string, number>
  goals: { kind: string; targetId?: string; priority: number }[]
  constraints: string[]
  values: { axis: string; base: number; drift: number; effective: number }[]
  vices: { kind: string; label: string; urge: number }[]
  relationships: {
    id: string; name: string; affection: number; trust: number
    debt: number; grievance: number; encounters: number
  }[]
  diaries: { day: number; text: string }[]
}

type Listener<T> = (data: T) => void

export class EngineConnection {
  private ws: WebSocket | null = null
  private stateListeners: Listener<StateMsg>[] = []
  private feedListeners: Listener<FeedItem>[] = []
  private connListeners: Listener<boolean>[] = []

  constructor(private readonly engineUrl: string) {}

  connect(): void {
    const wsUrl = this.engineUrl.replace(/^http/, 'ws') + '/live'
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.connListeners.forEach((fn) => fn(true))
    }

    this.ws.onclose = () => {
      this.connListeners.forEach((fn) => fn(false))
      setTimeout(() => this.connect(), 2000)
    }

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'state') {
        this.stateListeners.forEach((fn) => fn(msg as StateMsg))
      } else if (msg.type === 'feed') {
        this.feedListeners.forEach((fn) => fn(msg.item as FeedItem))
      } else if (msg.type === 'hello' && msg.feed) {
        for (const item of msg.feed as FeedItem[]) {
          this.feedListeners.forEach((fn) => fn(item))
        }
      }
    }
  }

  onState(fn: Listener<StateMsg>): void { this.stateListeners.push(fn) }
  onFeed(fn: Listener<FeedItem>): void { this.feedListeners.push(fn) }
  onConnection(fn: Listener<boolean>): void { this.connListeners.push(fn) }

  async fetchWorld(): Promise<WorldInfo> {
    const res = await fetch(this.engineUrl + '/world')
    return res.json()
  }

  async fetchAgent(id: string): Promise<AgentDetail> {
    const res = await fetch(`${this.engineUrl}/agent?id=${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error(`agent ${id}: ${res.status}`)
    return res.json()
  }
}
