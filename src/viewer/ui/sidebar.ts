/**
 * Tab-based sidebar: Town (roster), Feed (rich events), Agent (detail panel).
 * Driven by the same EngineConnection the 3D scene uses.
 */
import type { EngineConnection, WorldInfo, StateMsg, FeedItem } from '../core/connection.js'
import { avatarImg } from './avatar.js'

const STATE_COLORS: Record<string, string> = {
  sleep: '#60a5fa', work: '#4ade80', travel: '#fbbf24', scene: '#e879f9',
  steal: '#f87171', indulge_vice: '#fb923c', socialize: '#a78bfa',
  eat: '#facc15', relax: '#34d399', idle: '#94a3b8', exercise: '#38bdf8',
  seek_job: '#fb7185', browse: '#a78bfa', wash: '#67e8f9',
}

type Tab = 'town' | 'places' | 'feed' | 'agent' | 'graph'

const KIND_LABEL: Record<string, string> = {
  home: 'home', bar: 'bar', office: 'offices', shop: 'shop',
  supermarket: 'supermarket', clinic: 'clinic', school: 'school',
  gym: 'gym', garage: 'garage', park: 'park', plaza: 'plaza',
  cinema: 'cinema', bowling: 'bowling', cafe: 'cafe', restaurant: 'restaurant',
}

let activeTab: Tab = 'town'
let feedUnread = false

function switchTab(tab: Tab): void {
  activeTab = tab
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  document.querySelectorAll<HTMLElement>('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === `tab-${tab}`)
  })
  if (tab === 'feed') {
    feedUnread = false
    const badge = document.getElementById('feed-badge')
    if (badge) badge.hidden = true
  }
}

export function initSidebar(conn: EngineConnection, world: WorldInfo): void {
  const clockEl = document.getElementById('clock')!
  const dateEl = document.getElementById('date')!
  const phaseEl = document.getElementById('phase')!
  const connEl = document.getElementById('conn')!
  const tableEl = document.getElementById('agents-table')!
  const feedEl = document.getElementById('feed')!
  const cogEl = document.getElementById('cog')!

  const cityNameEl = document.getElementById('city-name')
  if (cityNameEl) cityNameEl.textContent = world.city.name

  const locMap = new Map(world.locations.map((l) => [l.id, l]))

  // Tab switching
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab as Tab))
  })

  // Agent click: switch to agent tab
  window.addEventListener('aw:agent-click', () => switchTab('agent'))

  // Delegated click on roster rows
  tableEl.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest('[data-agent]')
    const id = row?.getAttribute('data-agent')
    if (id != null) {
      window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id } }))
    }
  })

  // Places tab: click a place to open its card and fly the camera to it
  const placesEl = document.getElementById('places-list')!
  placesEl.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).closest('[data-place]')?.getAttribute('data-place')
    if (id == null) return
    window.dispatchEvent(new CustomEvent('aw:venue-focus', { detail: { id } }))
    window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id } }))
  })

  const publicPlaces = world.locations.filter(l => l.kind !== 'home')
  const homes = world.locations.filter(l => l.kind === 'home')
  const byDistrict = new Map<string, typeof world.locations>()
  for (const l of publicPlaces) {
    const list = byDistrict.get(l.district) ?? []
    list.push(l)
    byDistrict.set(l.district, list)
  }

  function renderPlaces(occ: Map<string, number>): void {
    const row = (l: { id: string; name: string; kind: string }): string => {
      const n = occ.get(l.id) ?? 0
      return `<div class="place-row${n > 0 ? ' busy' : ''}" data-place="${l.id}">` +
        `<span class="place-name">${esc(l.name)}</span>` +
        `<span class="place-kind">${esc(KIND_LABEL[l.kind] ?? l.kind)}</span>` +
        `<span class="place-occ">${n > 0 ? n : '·'}</span></div>`
    }
    let html = ''
    for (const [district, list] of byDistrict) {
      html += `<div class="places-group">${esc(district)}</div>` +
        [...list].sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')
    }
    if (homes.length > 0) {
      html += `<div class="places-group">Homes</div>` +
        [...homes].sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')
    }
    placesEl.innerHTML = html
  }
  renderPlaces(new Map())

  conn.onConnection((connected) => {
    connEl.textContent = connected ? 'live' : 'reconnecting...'
    connEl.className = connected ? 'conn on' : 'conn off'
  })

  // --- Clock interpolation (same as before) ---
  const GAME_MINUTES_PER_TICK = 5
  let lastTickEpoch = 0
  let lastTickReal = 0
  let tickIntervalMs = 2000

  function displayTime(gameMs: number) {
    const d = new Date(gameMs)
    const h = d.getUTCHours()
    const m = d.getUTCMinutes()
    clockEl.textContent =
      String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
    const icon =
      h >= 22 || h < 6 ? '\u{1F319}'
        : h < 8 ? '\u{1F305}'
          : h < 18 ? '☀️'
            : h < 20 ? '\u{1F305}'
              : '\u{1F319}'
    phaseEl.textContent =
      `${icon} ` + (
        h >= 23 || h < 7
          ? 'night'
          : h < 9
            ? 'morning'
            : h < 18
              ? 'working hours'
              : 'evening'
      )
  }

  let lastDisplayedMinute = -1
  function tickClock() {
    if (lastTickEpoch !== 0) {
      const elapsed = performance.now() - lastTickReal
      const frac = Math.min(elapsed / tickIntervalMs, 1)
      const interpMs = lastTickEpoch + frac * GAME_MINUTES_PER_TICK * 60_000
      const m = new Date(interpMs).getUTCMinutes()
      if (m !== lastDisplayedMinute) {
        displayTime(interpMs)
        lastDisplayedMinute = m
      }
    }
    requestAnimationFrame(tickClock)
  }
  requestAnimationFrame(tickClock)

  // --- State (agent roster + header) ---
  const knownAgents = new Set<string>()

  conn.onState((s: StateMsg) => {
    for (const a of s.agents) knownAgents.add(a.id)
    const nowReal = performance.now()
    const nowGame = new Date(s.time).getTime()
    if (lastTickReal > 0) {
      const gap = nowReal - lastTickReal
      if (gap > 500) tickIntervalMs = gap
    }
    lastTickEpoch = nowGame
    lastTickReal = nowReal

    displayTime(nowGame)
    dateEl.textContent = new Date(s.time).toDateString() + ` · day ${s.day}`

    const c = s.cognition
    const tk = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

    let tooltipHtml = ''
    if (c.breakdown && Object.keys(c.breakdown).length > 0) {
      const lines = Object.entries(c.breakdown).map(([kind, { queued, running }]) => {
        const parts: string[] = []
        if (running) parts.push(`${running} running`)
        if (queued) parts.push(`${queued} queued`)
        return `${kind}: ${parts.join(', ')}`
      })
      tooltipHtml = `<div class="cog-tooltip">${lines.join('<br>')}</div>`
    }

    cogEl.innerHTML =
      `<span class="cog-calls">${c.done} calls</span>` +
      (c.pending ? ` · <span class="cog-pending">${c.pending} pending</span>` : '') +
      (c.dropped ? ` · <span class="cog-dropped">${c.dropped} dropped</span>` : '') +
      ` · <span class="cog-tokens">${tk(c.inputTokens)} in / ${tk(c.outputTokens)} out</span>` +
      ` · <span class="cog-cost">$${c.spentUsd.toFixed(3)}</span>` +
      (tooltipHtml ? ` <span class="cog-info">ⓘ</span>` + tooltipHtml : '')

    const occ = new Map<string, number>()
    for (const a of s.agents) {
      if (a.state === 'travel') continue
      occ.set(a.at, (occ.get(a.at) ?? 0) + 1)
    }
    renderPlaces(occ)

    tableEl.innerHTML = s.agents
      .map((a) => {
        const col = STATE_COLORS[a.state] ?? '#94a3b8'
        const loc = locMap.get(a.at)
        const money = a.arrears > 0
          ? `${a.money}c <span class="neg">-${a.arrears}</span>`
          : `${a.money}c`
        return (
          `<div class="agent-row" data-agent="${a.id}">` +
          `<div class="agent-row-top">` +
          `${avatarImg(a.id)}<span class="agent-row-name">${a.name}</span>` +
          `<span class="agent-row-money">${money}</span>` +
          `</div>` +
          `<div class="agent-row-bottom">` +
          `<span class="agent-row-state" style="color:${col}">${a.state}</span>` +
          `<span class="agent-row-where">${loc?.name ?? a.at}</span>` +
          `</div></div>`
        )
      })
      .join('')
  })

  // --- Feed (rich rendering per event kind) ---
  conn.onFeed((item: FeedItem) => {
    if (activeTab !== 'feed') {
      feedUnread = true
      const badge = document.getElementById('feed-badge')
      if (badge) badge.hidden = false
    }

    const t = new Date(item.time)
    const when = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
    const d = item.detail as Record<string, unknown> | undefined

    let html = `<div class="when">${when}</div>`

    if (item.kind === 'scene' && d?.dialogue) {
      const dialogue = d.dialogue as { speaker: string; line: string }[]
      const outcome = d.outcome as string | undefined
      const transfer = d.transfer as { amount: number; from: string; to: string } | undefined
      const gossip = d.gossip as string | undefined
      html +=
        `<div class="head">${esc(item.text)}</div>` +
        (outcome ? `<div class="outcome">${esc(outcome)}</div>` : '') +
        (transfer ? `<div class="xfer">\u{1F4B0} ${transfer.amount}c · ${esc(transfer.from)} → ${esc(transfer.to)}</div>` : '') +
        (gossip ? `<div class="gossip-line">\u{1F5E3}️ ${esc(gossip)}</div>` : '') +
        `<button class="expand-btn">▸ dialogue (${dialogue.length})</button>` +
        `<div class="dialogue">${dialogue.map((x) => `<div class="line"><b>${esc(x.speaker)}:</b> ${esc(x.line)}</div>`).join('')}</div>`
    } else if (item.kind === 'crisis' && d) {
      const thought = (d.thought ?? d.text ?? '') as string
      const crisisKind = (d.crisisKind ?? '') as string
      html +=
        `<div class="head">\u{1F4AD} ${esc(item.text)}</div>` +
        (thought ? `<div class="thought">${esc(thought)}</div>` : '') +
        (crisisKind ? `<span class="tag">${esc(crisisKind.replace(/_/g, ' '))}</span>` : '')
    } else if (item.kind === 'deliberation' && d) {
      const biases = d.biases as { action: string; bias: number }[] | undefined
      const seekScene = d.seekScene as { target: string }[] | undefined
      const seed = d.seed as string | undefined
      const thought = (d.thought ?? d.text ?? '') as string
      html += `<div class="head">\u{1F9E0} ${esc(item.text)}</div>`
      if (thought) html += `<div class="thought">${esc(thought)}</div>`
      if (biases?.length || seekScene?.length || seed) {
        html += '<div class="delib-detail">'
        if (biases?.length) html += `<span>${biases.map((b) => `${b.action}${b.bias > 0 ? '+' : ''}${b.bias.toFixed(1)}`).join(', ')}</span> `
        if (seekScene?.length) html += `<span>seek: ${seekScene.map((s) => esc(s.target)).join(', ')}</span> `
        if (seed) html += `<span>topic: ${esc(seed)}</span>`
        html += '</div>'
      }
    } else if (item.kind === 'diary' && d?.text) {
      const text = d.text as string
      const drift = d.drift as Record<string, number> | undefined
      html +=
        `<div class="head">\u{1F4D3} ${esc(item.text)}</div>` +
        `<div class="thought">${esc(text)}</div>` +
        (drift && Object.keys(drift).length
          ? `<div class="drift-line">Δ ${Object.entries(drift)
              .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${(v as number).toFixed(2)}`)
              .join(', ')}</div>`
          : '')
    } else if (item.kind === 'theft') {
      html += `<div class="head">\u{1F3AD} ${esc(item.text)}</div>`
      if (d?.outcome) html += `<div class="outcome">${esc(d.outcome as string)}</div>`
      if (d?.transfer) {
        const tr = d.transfer as { amount: number; from: string; to: string }
        html += `<div class="xfer">\u{1F4B0} ${tr.amount}c · ${esc(tr.from)} → ${esc(tr.to)}</div>`
      }
    } else if (item.kind === 'error') {
      html += `<div class="head">⚠️ ${esc(item.text)}</div>`
    } else {
      html += `<div class="plain">${esc(item.text)}</div>`
    }

    const el = document.createElement('div')
    el.className = 'ev ' + item.kind
    el.innerHTML = html
    feedEl.prepend(el)

    // Wire up dialogue expand button
    const expandBtn = el.querySelector('.expand-btn')
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        const dial = el.querySelector('.dialogue')
        if (dial) {
          dial.classList.toggle('open')
          expandBtn.textContent = dial.classList.contains('open')
            ? `▾ hide dialogue`
            : `▸ dialogue (${el.querySelectorAll('.line').length})`
        }
      })
    }

    while (feedEl.children.length > 200) feedEl.lastChild?.remove()
  })
}

export { switchTab }

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}
