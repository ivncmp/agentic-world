/**
 * The venue panel: what a place is, and who is inside it right now.
 *
 * Opened by clicking a building in the scene or a venue label. Reads the same
 * state message the scene does, so the list of occupants can never disagree
 * with the figures standing in the room.
 */
import type {
  EngineConnection,
  WorldInfo,
  LocationInfo,
  StateMsg,
  AgentSnapshot,
} from '../core/connection.js'
import { avatarImg } from './avatar.js'

const KIND_LABEL: Record<string, string> = {
  home: 'Home',
  bar: 'Bar',
  office: 'Offices',
  shop: 'Shop',
  supermarket: 'Supermarket',
  clinic: 'Clinic',
  school: 'School',
  gym: 'Gym',
  garage: 'Garage',
  park: 'Park',
  plaza: 'Plaza',
  cinema: 'Cinema',
  bowling: 'Bowling',
  cafe: 'Cafe',
}

const ROLE_LABEL: Record<string, string> = {
  residential: 'Residential Building',
  civic: 'Office Building',
  plaza: 'Plaza',
  green: 'Park',
}

const STATE_COLORS: Record<string, string> = {
  sleep: '#60a5fa',
  work: '#4ade80',
  travel: '#fbbf24',
  scene: '#e879f9',
  steal: '#f87171',
  indulge_vice: '#fb923c',
  socialize: '#a78bfa',
  eat: '#facc15',
  relax: '#34d399',
  idle: '#94a3b8',
  exercise: '#38bdf8',
  seek_job: '#fb7185',
  browse: '#a78bfa',
  wash: '#67e8f9',
}

let el: HTMLElement | null = null
let openId: string | null = null
let latestAgents: AgentSnapshot[] = []

/**
 * Wires the venue panel: opens on a building or label click, lists occupants.
 */
export function initVenueCard(conn: EngineConnection, world: WorldInfo): void {
  el = document.createElement('div')
  el.id = 'venue-card'
  el.hidden = true
  document.body.appendChild(el)

  const locMap = new Map(world.locations.map((l) => [l.id, l]))

  conn.onState((s: StateMsg) => {
    latestAgents = s.agents
    if (openId != null) {
      const loc = locMap.get(openId)
      if (loc != null) render(loc)
    }
  })

  el.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  el.addEventListener('pointerup', (ev) => ev.stopPropagation())
  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement
    if (t.closest('[data-close]')) {
      closeCard()
      return
    }
    const row = t.closest('[data-agent]')
    const agentId = row?.getAttribute('data-agent')
    if (agentId != null) {
      window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: agentId } }))
    }
  })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeCard()
  })

  window.addEventListener('aw:venue-click', (ev) => {
    const detail = (ev as CustomEvent<{ id: string | null; role?: string }>).detail
    const agentCard = document.getElementById('agent-card')
    if (agentCard) agentCard.hidden = true

    if (detail.id == null) {
      const clickId = `filler-${detail.role}`
      if (openId === clickId) {
        closeCard()
        return
      }
      openId = clickId
      el!.hidden = false
      renderFiller(detail.role ?? 'residential')
      return
    }

    const loc = locMap.get(detail.id)
    if (loc == null) return
    if (openId === detail.id) {
      closeCard()
      return
    }
    openId = detail.id
    el!.hidden = false
    render(loc)
  })

  window.addEventListener('aw:agent-click', () => closeCard())
}

function closeCard(): void {
  openId = null
  if (el != null) el.hidden = true
}

function render(loc: LocationInfo): void {
  if (el == null) return
  const occupants = latestAgents.filter((a) => a.at === loc.id && a.state !== 'travel')
  const kindLabel = KIND_LABEL[loc.kind] ?? loc.kind

  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${esc(loc.name)}</div>
        <div class="card-sub">${esc(kindLabel)} · ${esc(loc.district)}</div>
      </div>
      <button class="card-x" data-close>&times;</button>
    </div>
    <div class="card-body">
      ${occupantsBlock(occupants)}
    </div>`
}

function occupantsBlock(occupants: AgentSnapshot[]): string {
  if (occupants.length === 0) {
    return section('inside', '<div class="dim">nobody here</div>')
  }
  const rows = occupants
    .map((a) => {
      const col = STATE_COLORS[a.state] ?? '#94a3b8'
      return `<tr data-agent="${a.id}">
      <td>${avatarImg(a.id)}${esc(a.name)}</td>
      <td style="color:${col}">${esc(a.state)}</td>
      <td class="dim">${esc(a.occupation)}</td>
    </tr>`
    })
    .join('')
  return section(
    `inside <span class="hint">${occupants.length}</span>`,
    `<table class="occupants">${rows}</table>`,
  )
}

function renderFiller(role: string): void {
  if (el == null) return
  const label = ROLE_LABEL[role] ?? 'Building'
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${esc(label)}</div>
        <div class="card-sub dim">No activity tracked</div>
      </div>
      <button class="card-x" data-close>&times;</button>
    </div>
    <div class="card-body">
      <section><div class="dim">This building is part of the city scenery.</div></section>
    </div>`
}

const section = (title: string, body: string): string => `<section><h3>${title}</h3>${body}</section>`

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}
