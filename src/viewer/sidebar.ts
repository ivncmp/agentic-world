/**
 * DOM sidebar: agent table + live feed. Driven by the same EngineConnection
 * the Phaser scene uses — no separate WebSocket.
 */
import type { EngineConnection, WorldInfo, StateMsg, FeedItem } from './connection.js'
import { avatarImg, addToCache } from './avatar.js'

const STATE_COLORS: Record<string, string> = {
  sleep: '#60a5fa', work: '#4ade80', travel: '#fbbf24', scene: '#e879f9',
  steal: '#f87171', indulge_vice: '#fb923c', socialize: '#a78bfa',
  eat: '#facc15', relax: '#34d399', idle: '#94a3b8', exercise: '#38bdf8',
  seek_job: '#fb7185', browse: '#a78bfa', wash: '#67e8f9',
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

  // Delegated: the table is re-rendered every tick, so per-row handlers would
  // be rebound 288 times a game day.
  tableEl.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest('[data-agent]')
    const id = row?.getAttribute('data-agent')
    if (id != null) {
      window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id } }))
    }
  })

  conn.onConnection((connected) => {
    connEl.textContent = connected ? 'live' : 'reconnecting...'
    connEl.className = connected ? 'conn on' : 'conn off'
  })

  // Interpolate the clock second-by-second between ticks so it doesn't jump
  // 5 minutes at a time. Each tick = 5 game-minutes arriving every ~TICK_MS
  // real milliseconds. We lerp from the last-known game time to the next one.
  const GAME_MINUTES_PER_TICK = 5
  let lastTickEpoch = 0   // game epoch ms at last tick
  let lastTickReal = 0    // performance.now() when we received it
  let tickIntervalMs = 2000 // estimated real ms between ticks (adapts)

  function displayTime(gameMs: number) {
    const d = new Date(gameMs)
    const h = d.getUTCHours()
    const m = d.getUTCMinutes()
    clockEl.textContent =
      String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
    const icon =
      h >= 22 || h < 6 ? '🌙'
        : h < 8 ? '🌅'
          : h < 18 ? '☀️'
            : h < 20 ? '🌅'
              : '🌙'
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

  const knownAgents = new Set<string>()

  conn.onState((s: StateMsg) => {
    for (const a of s.agents) {
      if (!knownAgents.has(a.id)) {
        knownAgents.add(a.id)
        void addToCache(a.id)
      }
    }
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
    cogEl.innerHTML =
      `<span class="cog-calls">${c.done} calls</span>` +
      (c.pending ? ` · <span class="cog-pending">${c.pending} pending</span>` : '') +
      (c.dropped ? ` · <span class="cog-dropped">${c.dropped} dropped</span>` : '') +
      ` · <span class="cog-tokens">${tk(c.inputTokens)} in / ${tk(c.outputTokens)} out</span>` +
      ` · <span class="cog-cost">$${c.spentUsd.toFixed(3)}</span>`

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

  conn.onFeed((item: FeedItem) => {
    const t = new Date(item.time)
    const when = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
    const d = item.detail
    let html = `<div class="when">${when}</div>`

    if (item.kind === 'scene' && d?.dialogue) {
      html +=
        `<div class="head">${item.text}</div>` +
        d.dialogue.map((x) => `<div class="line"><b>${x.speaker}:</b> ${x.line}</div>`).join('') +
        (d.outcome ? `<div class="outcome">${d.outcome}</div>` : '') +
        (d.transfer
          ? `<div class="xfer">${d.transfer.amount}c · ${d.transfer.from} → ${d.transfer.to}</div>`
          : '')
    } else if (item.kind === 'diary' && d?.text) {
      html +=
        `<div class="head">${item.text}</div><div class="line">${d.text}</div>` +
        (d.drift && Object.keys(d.drift).length
          ? `<div class="xfer">changed: ${Object.entries(d.drift)
              .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
              .join(', ')}</div>`
          : '')
    } else {
      html += `<div class="plain">${item.text}</div>`
    }

    const el = document.createElement('div')
    el.className = 'ev ' + item.kind
    el.innerHTML = html
    feedEl.prepend(el)
    while (feedEl.children.length > 120) feedEl.lastChild?.remove()
  })
}
