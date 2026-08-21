/**
 * DOM sidebar: agent table + live feed. Driven by the same EngineConnection
 * the Phaser scene uses — no separate WebSocket.
 */
import type { EngineConnection, WorldInfo, StateMsg, FeedItem } from './connection.js'

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

  conn.onState((s: StateMsg) => {
    clockEl.textContent =
      String(s.hour).padStart(2, '0') + ':' + String(s.minute).padStart(2, '0')
    dateEl.textContent = new Date(s.time).toDateString() + ` · day ${s.day}`
    phaseEl.textContent =
      s.hour >= 23 || s.hour < 7
        ? 'night'
        : s.hour < 9
          ? 'morning'
          : s.hour < 18
            ? 'working hours'
            : 'evening'

    const c = s.cognition
    cogEl.textContent =
      `cognition ${c.done} done · ${c.pending} pending` +
      (c.dropped ? ` · ${c.dropped} dropped` : '') +
      ` · $${c.spentUsd.toFixed(3)}`

    tableEl.innerHTML =
      '<tr><th>who</th><th>doing</th><th>where</th><th style="text-align:right">money</th><th></th></tr>' +
      s.agents
        .map((a) => {
          const col = STATE_COLORS[a.state] ?? '#94a3b8'
          const loc = locMap.get(a.at)
          return (
            `<tr data-agent="${a.id}"><td><span class="dot" style="background:${col}"></span>${a.name}</td>` +
            `<td style="color:${col}">${a.state}</td>` +
            `<td style="color:var(--dim)">${loc?.name ?? a.at}</td>` +
            `<td class="num">${a.money}c</td>` +
            `<td class="num neg">${a.arrears > 0 ? '-' + a.arrears : ''}</td></tr>`
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
