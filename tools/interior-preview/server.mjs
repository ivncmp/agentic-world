/**
 * Serves the interior-preview tool — standalone Three.js rooms for every
 * venue kind in agentic-world. Run from the repo root:
 *
 *   node tools/interior-preview/server.mjs
 *   # then open http://localhost:7798/
 */
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve, normalize } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const HERE = import.meta.dirname
const PORT = Number(process.env.PORT ?? 7798)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
}

async function sendFile(res, absolute) {
  const safe = normalize(absolute)
  if (!safe.startsWith(ROOT)) {
    res.writeHead(403).end('outside the repo')
    return
  }
  try {
    const body = await readFile(safe)
    res.writeHead(200, { 'Content-Type': TYPES[extname(safe)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/' || url.pathname === '/index.html') {
    void sendFile(res, join(HERE, 'index.html'))
    return
  }
  if (url.pathname.startsWith('/three/')) {
    void sendFile(res, join(ROOT, 'node_modules/three', url.pathname.slice('/three/'.length)))
    return
  }
  if (url.pathname.startsWith('/furniture/')) {
    const file = decodeURIComponent(url.pathname.slice('/furniture/'.length))
    void sendFile(res, join(ROOT, 'src/viewer/public/assets/furniture/Models/GLTF format', file))
    return
  }
  if (url.pathname === '/rooms') {
    void (async () => {
      try {
        const files = (await readdir(join(HERE, 'rooms'))).filter(f => f.endsWith('.json')).sort()
        const rooms = []
        for (const f of files) {
          rooms.push(JSON.parse(await readFile(join(HERE, 'rooms', f), 'utf8')))
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(rooms))
      } catch (e) {
        res.writeHead(500).end(String(e))
      }
    })()
    return
  }
  if (url.pathname.startsWith('/rooms/')) {
    void sendFile(res, join(HERE, decodeURIComponent(url.pathname)))
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log(`interior preview on http://localhost:${PORT}/`)
})
