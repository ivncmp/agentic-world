/**
 * Force-directed relationship graph rendered on a <canvas>.
 * Nodes = agents, edges = relationships colored by sentiment.
 */

type GraphNode = {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
}

type GraphEdge = {
  source: string
  target: string
  affection: number
  trust: number
  grievance: number
  encounters: number
}

type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

const ENGINE_URL = ''

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let data: GraphData | null = null
let animId = 0
let hovered: string | null = null
let dragging: string | null = null
let dragOffset = { x: 0, y: 0 }
let visible = false

function getColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    positive: v('--up') || '#4ade80',
    negative: v('--neg') || '#f87171',
    neutral: v('--dim') || '#6b7280',
    node: v('--accent') || '#38bdf8',
    nodeBorder: v('--delib') || '#0ea5e9',
    text: v('--fg') || '#e5e7eb',
    bg: v('--canvas-bg') || v('--bg') || '#0a0e17',
  }
}

/**
 * The relationship graph: a force layout over `/rel-graph`, drawn on canvas.
 */
export function initGraph(): void {
  canvas = document.getElementById('graph-canvas') as HTMLCanvasElement
  if (!canvas) return
  ctx = canvas.getContext('2d')

  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('mouseleave', onMouseUp)
  canvas.addEventListener('click', onClick)

  const observer = new MutationObserver(() => {
    const pane = document.getElementById('tab-graph')
    const nowVisible = pane?.classList.contains('active') ?? false
    if (nowVisible && !visible) {
      visible = true
      requestAnimationFrame(() => void refresh())
    } else if (!nowVisible && visible) {
      visible = false
      cancelAnimationFrame(animId)
    }
  })
  const tabContent = document.querySelector('.tab-content')
  if (tabContent)
    observer.observe(tabContent, { subtree: true, attributes: true, attributeFilter: ['class'] })
}

async function refresh(): Promise<void> {
  try {
    resize()
    const res = await fetch(ENGINE_URL + '/rel-graph')
    const raw = (await res.json()) as { nodes: { id: string; name: string }[]; edges: GraphEdge[] }
    if (!data || data.nodes.length !== raw.nodes.length) {
      const w = canvas?.clientWidth ?? 400
      const h = canvas?.clientHeight ?? 400
      const cx = w / 2
      const cy = h / 2
      data = {
        nodes: raw.nodes.map((n, i) => {
          const angle = (i / raw.nodes.length) * Math.PI * 2
          const r = Math.min(cx, cy) * 0.7
          return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 }
        }),
        edges: raw.edges,
      }
    } else {
      data.edges = raw.edges
      for (const n of raw.nodes) {
        const existing = data.nodes.find((x) => x.id === n.id)
        if (existing) existing.name = n.name
      }
    }
    simulate()
  } catch (e) {
    console.warn('[graph] fetch failed:', e)
  }
}

function simulate(): void {
  if (!data || !canvas || !ctx) return
  resize()

  let steps = 0
  const maxSteps = 200

  function step() {
    if (!data || !visible) return
    applyForces(data)
    draw(data)
    steps++
    if (steps < maxSteps || dragging) {
      animId = requestAnimationFrame(step)
    }
  }
  cancelAnimationFrame(animId)
  step()
}

function resize(): void {
  if (!canvas) return
  const pane = canvas.parentElement!
  const dpr = window.devicePixelRatio || 1
  const w = pane.clientWidth
  const h = pane.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  ctx?.scale(dpr, dpr)
}

function applyForces(g: GraphData): void {
  const w = canvas?.clientWidth ?? 400
  const h = canvas?.clientHeight ?? 400
  const cx = w / 2
  const cy = h / 2
  const REPULSION = 30000
  const ATTRACTION = 0.003
  const CENTERING = 0.005
  const DAMPING = 0.85
  const NODE_R = 22

  for (const node of g.nodes) {
    if (node.id === dragging) continue
    let fx = 0,
      fy = 0

    // Repulsion from every other node
    for (const other of g.nodes) {
      if (other.id === node.id) continue
      const dx = node.x - other.x
      const dy = node.y - other.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const force = REPULSION / (dist * dist)
      fx += (dx / dist) * force
      fy += (dy / dist) * force
    }

    // Attraction along edges
    for (const edge of g.edges) {
      let other: GraphNode | undefined
      if (edge.source === node.id) other = g.nodes.find((n) => n.id === edge.target)
      else if (edge.target === node.id) other = g.nodes.find((n) => n.id === edge.source)
      if (!other) continue
      const dx = other.x - node.x
      const dy = other.y - node.y
      const strength = ATTRACTION * (1 + Math.abs(edge.affection) + edge.grievance)
      fx += dx * strength
      fy += dy * strength
    }

    // Centering force
    fx += (cx - node.x) * CENTERING
    fy += (cy - node.y) * CENTERING

    node.vx = (node.vx + fx) * DAMPING
    node.vy = (node.vy + fy) * DAMPING
    node.x += node.vx
    node.y += node.vy

    // Bounds
    node.x = Math.max(NODE_R, Math.min(w - NODE_R, node.x))
    node.y = Math.max(NODE_R, Math.min(h - NODE_R, node.y))
  }
}

function draw(g: GraphData): void {
  if (!ctx || !canvas) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const colors = getColors()

  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)

  // Draw edges
  for (const edge of g.edges) {
    const src = g.nodes.find((n) => n.id === edge.source)
    const tgt = g.nodes.find((n) => n.id === edge.target)
    if (!src || !tgt) continue

    const isHovered = hovered === edge.source || hovered === edge.target
    const sentiment = edge.affection + edge.trust * 0.5 - edge.grievance
    const color = sentiment > 0.1 ? colors.positive : sentiment < -0.1 ? colors.negative : colors.neutral
    const strength = Math.min(4, 0.5 + Math.abs(sentiment) * 3 + edge.encounters * 0.02)

    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(tgt.x, tgt.y)
    ctx.strokeStyle = color
    ctx.lineWidth = strength
    ctx.globalAlpha = isHovered || !hovered ? (isHovered ? 1 : 0.7) : 0.15
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Draw nodes
  const NODE_R = 22
  for (const node of g.nodes) {
    const isHovered = hovered === node.id
    const isConnected =
      hovered != null &&
      g.edges.some(
        (e) =>
          (e.source === hovered && e.target === node.id) || (e.target === hovered && e.source === node.id),
      )
    const dimmed = hovered != null && !isHovered && !isConnected

    ctx.globalAlpha = dimmed ? 0.3 : 1

    // Circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, isHovered ? NODE_R + 3 : NODE_R, 0, Math.PI * 2)
    ctx.fillStyle = colors.node
    ctx.fill()
    ctx.strokeStyle = colors.nodeBorder
    ctx.lineWidth = isHovered ? 3 : 2
    ctx.stroke()

    // Initials
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${isHovered ? 11 : 10}px Inter, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const initials = node.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
    ctx.fillText(initials, node.x, node.y)

    // Name below
    ctx.fillStyle = colors.text
    ctx.font = `${isHovered ? 12 : 11}px Inter, system-ui, sans-serif`
    ctx.fillText(node.name.split(' ')[0] ?? node.name, node.x, node.y + NODE_R + 12)

    ctx.globalAlpha = 1
  }

  // Legend
  ctx.font = '10px Inter, system-ui, sans-serif'
  ctx.textAlign = 'left'
  const legendY = h - 14
  ctx.fillStyle = colors.positive
  ctx.fillRect(8, legendY - 4, 12, 3)
  ctx.fillStyle = colors.text
  ctx.fillText('positive', 24, legendY)
  ctx.fillStyle = colors.negative
  ctx.fillRect(78, legendY - 4, 12, 3)
  ctx.fillStyle = colors.text
  ctx.fillText('negative', 94, legendY)
  ctx.fillStyle = colors.neutral
  ctx.fillRect(152, legendY - 4, 12, 3)
  ctx.fillStyle = colors.text
  ctx.fillText('neutral', 168, legendY)

  // Tooltip for hovered node
  if (hovered) {
    const node = g.nodes.find((n) => n.id === hovered)
    if (node) {
      const related = g.edges
        .filter((e) => e.source === hovered || e.target === hovered)
        .map((e) => {
          const otherId = e.source === hovered ? e.target : e.source
          const other = g.nodes.find((n) => n.id === otherId)
          return { name: other?.name ?? otherId, aff: e.affection, trust: e.trust, griev: e.grievance }
        })
        .sort((a, b) => Math.abs(b.aff) + Math.abs(b.trust) - Math.abs(a.aff) - Math.abs(a.trust))

      if (related.length > 0) {
        const pad = 12
        const lineH = 18
        const tipW = 180
        const tipH = pad + 18 + related.length * lineH + pad
        let tx = node.x + NODE_R + 10
        let ty = node.y - tipH / 2
        if (tx + tipW > w) tx = node.x - NODE_R - 10 - tipW
        if (ty < 4) ty = 4
        if (ty + tipH > h - 4) ty = h - 4 - tipH

        ctx.fillStyle = colors.bg
        ctx.globalAlpha = 0.92
        ctx.beginPath()
        ctx.roundRect(tx, ty, tipW, tipH, 6)
        ctx.fill()
        ctx.strokeStyle = colors.neutral
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = 1

        ctx.fillStyle = colors.text
        ctx.font = 'bold 11px Inter, system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(node.name, tx + pad, ty + pad + 12)

        for (let i = 0; i < related.length; i++) {
          const r = related[i]!
          const ry = ty + pad + 18 + i * lineH
          const sentiment = r.aff + r.trust * 0.5 - r.griev
          ctx.fillStyle =
            sentiment > 0.1 ? colors.positive : sentiment < -0.1 ? colors.negative : colors.neutral
          ctx.font = '11px Inter, system-ui, sans-serif'
          const firstName = r.name.split(' ')[0] ?? r.name
          ctx.fillText(`${firstName}  ${r.aff >= 0 ? '+' : ''}${r.aff.toFixed(2)}`, tx + pad, ry + 12)
        }
      }
    }
  }
}

function nodeAt(x: number, y: number): GraphNode | undefined {
  if (!data) return undefined
  const NODE_R = 22
  for (const node of data.nodes) {
    const dx = x - node.x
    const dy = y - node.y
    if (dx * dx + dy * dy <= (NODE_R + 4) * (NODE_R + 4)) return node
  }
  return undefined
}

function canvasCoords(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect()
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
}

function onMouseMove(ev: MouseEvent): void {
  const pos = canvasCoords(ev)
  if (dragging && data) {
    const node = data.nodes.find((n) => n.id === dragging)
    if (node) {
      node.x = pos.x - dragOffset.x
      node.y = pos.y - dragOffset.y
      node.vx = 0
      node.vy = 0
      if (data) draw(data)
    }
    return
  }
  const node = nodeAt(pos.x, pos.y)
  const newHovered = node?.id ?? null
  if (newHovered !== hovered) {
    hovered = newHovered
    if (canvas) canvas.style.cursor = hovered ? 'pointer' : 'default'
    if (data) draw(data)
  }
}

function onMouseDown(ev: MouseEvent): void {
  const pos = canvasCoords(ev)
  const node = nodeAt(pos.x, pos.y)
  if (node) {
    dragging = node.id
    dragOffset = { x: pos.x - node.x, y: pos.y - node.y }
    ev.preventDefault()
  }
}

function onMouseUp(): void {
  dragging = null
}

function onClick(ev: MouseEvent): void {
  const pos = canvasCoords(ev)
  const node = nodeAt(pos.x, pos.y)
  if (node) {
    window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: node.id } }))
  }
}
