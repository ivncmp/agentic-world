/**
 * Agent detail panel — renders into the sidebar's Agent tab when an agent is
 * clicked in the roster or on the map. No longer a floating card.
 */
import type { EngineConnection, AgentDetail } from './connection.js'
import { avatarImg } from './avatar.js'
import { switchTab } from './sidebar.js'

const NEED_LABEL: Record<string, string> = {
  hunger: 'hunger', energy: 'energy', social: 'social',
  hygiene: 'hygiene', fun: 'fun',
}

let containerEl: HTMLElement | null = null
let openId: string | null = null

export function initAgentCard(conn: EngineConnection): void {
  containerEl = document.getElementById('agent-detail')

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openId) {
      closeCard()
      window.dispatchEvent(new CustomEvent('aw:fit'))
    }
  })

  window.addEventListener('aw:agent-click', (ev) => {
    const id = (ev as CustomEvent<{ id: string }>).detail.id
    void openCard(conn, id)
    window.dispatchEvent(new CustomEvent('aw:follow', { detail: { id } }))
  })
}

function closeCard(): void {
  openId = null
  if (containerEl) {
    containerEl.innerHTML = '<div class="agent-tab-empty">Click an agent to inspect</div>'
  }
  switchTab('town')
}

async function openCard(conn: EngineConnection, id: string): Promise<void> {
  if (containerEl == null) return
  if (openId === id) { closeCard(); return }
  openId = id
  containerEl.innerHTML = '<div class="agent-tab-empty">loading...</div>'
  try {
    const d = await conn.fetchAgent(id)
    if (openId !== id) return
    containerEl.innerHTML = render(d)
    containerEl.querySelector('[data-back]')?.addEventListener('click', () => closeCard())
  } catch (err) {
    containerEl.innerHTML = `<div class="agent-tab-empty">could not load: ${String(err)}</div>`
  }
}

function render(d: AgentDetail): string {
  return `
    <div class="agent-tab-back">
      <button data-back>←</button>
      <span class="agent-tab-title">${avatarImg(d.id, 18)} ${esc(d.name)}</span>
    </div>
    <div class="card-body">
      ${moneyBlock(d)}
      ${valuesBlock(d)}
      ${vicesBlock(d)}
      ${needsBlock(d)}
      ${goalsBlock(d)}
      ${relationshipsBlock(d)}
      ${diariesBlock(d)}
    </div>`
}

function moneyBlock(d: AgentDetail): string {
  const rows = [
    ['money', `${d.money}c`],
    ['housing', `${d.housing.kind} · ${d.housing.due}c` +
      (d.housing.arrears > 0 ? ` · <span class="bad">${d.housing.arrears}c owed</span>` : '')],
    ['job', d.job == null
      ? '<span class="bad">unemployed</span>'
      : `${esc(d.job.employer)} · ${d.job.wage}c/h · ${esc(d.job.shift)}`],
  ]
  return section('situation',
    `<table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`)
}

function valuesBlock(d: AgentDetail): string {
  const rows = d.values.map((v) => {
    const drifted = Math.abs(v.drift) >= 0.01
    return `<tr>
      <td>${esc(v.axis)}</td>
      <td class="bar">${bar(v.effective)}</td>
      <td class="num">${fmt(v.effective)}</td>
      <td class="num ${drifted ? (v.drift > 0 ? 'up' : 'down') : 'dim'}">${
        drifted ? (v.drift > 0 ? '+' : '') + fmt(v.drift) : '·'}</td>
    </tr>`
  })
  return section('values <span class="hint">effective · drift</span>',
    `<table class="values">${rows.join('')}</table>`)
}

function vicesBlock(d: AgentDetail): string {
  const rows = d.vices.map((v) =>
    `<tr><td>${esc(v.label)}</td><td class="bar">${meter(v.urge)}</td>
     <td class="num">${Math.round(v.urge * 100)}%</td></tr>`)
  return section('vices', `<table class="values">${rows.join('')}</table>`)
}

function needsBlock(d: AgentDetail): string {
  const rows = Object.entries(d.needs).map(([k, v]) =>
    `<tr><td>${esc(NEED_LABEL[k] ?? k)}</td><td class="bar">${meter(v)}</td>
     <td class="num">${Math.round(v * 100)}%</td></tr>`)
  return section('needs', `<table class="values">${rows.join('')}</table>`)
}

function goalsBlock(d: AgentDetail): string {
  if (d.goals.length === 0 && d.constraints.length === 0) return ''
  const goals = d.goals
    .map((g) => `<li>${esc(g.kind)}${g.targetId ? ` → ${esc(g.targetId)}` : ''}
      <span class="dim">${Math.round(g.priority * 100)}%</span></li>`)
    .join('')
  const cons = d.constraints
    .map((c) => `<li class="constraint">${esc(c)}</li>`).join('')
  return section('goals', `<ul class="goals">${goals}${cons}</ul>`)
}

function relationshipsBlock(d: AgentDetail): string {
  if (d.relationships.length === 0) {
    return section('relationships', '<div class="dim">nobody yet</div>')
  }
  const rows = d.relationships.map((r) => `
    <tr>
      <td>${avatarImg(r.id)}${esc(r.name)}</td>
      <td class="num ${tone(r.affection)}">${fmt(r.affection)}</td>
      <td class="num ${tone(r.trust)}">${fmt(r.trust)}</td>
      <td class="num ${r.debt !== 0 ? 'warn' : 'dim'}">${r.debt !== 0 ? `${Math.round(r.debt)}c` : '·'}</td>
      <td class="num ${r.grievance > 0.05 ? 'bad' : 'dim'}">${r.grievance > 0.05 ? fmt(r.grievance) : '·'}</td>
    </tr>`)
  return section('relationships',
    `<table class="rels"><tr class="th"><th></th><th>aff</th><th>trust</th><th>debt</th><th>griev</th></tr>${rows.join('')}</table>`)
}

function diariesBlock(d: AgentDetail): string {
  if (d.diaries.length === 0) {
    return section('diary', '<div class="dim">no nights reflected on yet</div>')
  }
  const entries = d.diaries.map((e) =>
    `<div class="diary"><div class="diary-day">day ${e.day}</div><p>${esc(e.text)}</p></div>`)
  return section('diary', entries.join(''))
}

const section = (title: string, body: string): string =>
  `<section><h3>${title}</h3>${body}</section>`

const fmt = (n: number): string => n.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.')

const tone = (n: number): string => (n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'dim')

function bar(v: number): string {
  const pct = Math.min(50, Math.abs(v) * 50)
  const side = v >= 0 ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%`
  return `<span class="track"><span class="fill ${v >= 0 ? 'pos' : 'neg'}" style="${side}"></span></span>`
}

function meter(v: number): string {
  const pct = Math.max(0, Math.min(1, v)) * 100
  return `<span class="track"><span class="fill pos" style="left:0;width:${pct}%"></span></span>`
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}
