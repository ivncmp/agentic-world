/**
 * Serves the 3D city viewer — an external visualisation of Saint Skill
 * using Kenney's city asset packs (commercial, suburban, industrial).
 *
 * Follows the same pattern as tools/render-characters: a browser does the
 * rendering via three.js loaded from node_modules (no network needed).
 *
 *   node tools/city-viewer/server.mjs
 *   # then open http://localhost:7800/
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, normalize } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const HERE = import.meta.dirname
const ASSETS = join(ROOT, 'src/viewer/public/assets/city')
const PORT = Number(process.env.PORT ?? 7800)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
}

async function sendFile(res, absolute) {
  const safe = normalize(absolute)
  if (!safe.startsWith(ROOT)) {
    res.writeHead(403).end('outside the repo')
    return
  }
  try {
    const body = await readFile(safe)
    const isHTML = extname(safe) === '.html'
    res.writeHead(200, {
      'Content-Type': TYPES[extname(safe)] ?? 'application/octet-stream',
      'Cache-Control': isHTML ? 'no-cache, no-store' : 'max-age=3600',
    })
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
  if (url.pathname.startsWith('/assets/')) {
    void sendFile(res, join(ASSETS, decodeURIComponent(url.pathname.slice('/assets/'.length))))
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log(`city viewer on http://localhost:${PORT}/`)
  console.log(`assets  <- ${ASSETS}`)
})
