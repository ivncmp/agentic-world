/**
 * Bakes Kenney's rigged Mini Characters into isometric sprite sheets.
 *
 * The models are glTF with real skeletal animation, and the viewer is 2D — so
 * somebody has to turn one into the other. Doing it here, once, keeps the
 * runtime free of a 3D dependency and keeps the output in version control
 * where an open-source adopter gets it without a toolchain.
 *
 * A browser does the rendering because it is the one WebGL runtime everybody
 * already has. This server hands it the page, three.js and the models, then
 * writes back whatever it posts.
 *
 *   node tools/render-characters/server.mjs
 *   # then open http://localhost:7799/ and let it run
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, resolve, normalize } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const HERE = import.meta.dirname
const OUT = join(ROOT, 'src/viewer/public/assets/characters')
const PORT = Number(process.env.PORT ?? 7799)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
}

/** Serves one file, refusing anything that climbs out of the repo. */
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

  if (req.method === 'POST' && url.pathname === '/save') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const { name, png, meta } = JSON.parse(Buffer.concat(chunks).toString())
      await mkdir(OUT, { recursive: true })
      await writeFile(join(OUT, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'))
      if (meta != null) {
        await writeFile(join(OUT, `${name}.json`), JSON.stringify(meta, null, 2))
      }
      console.log(`wrote ${name}.png`)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
    })
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    void sendFile(res, join(HERE, 'index.html'))
    return
  }
  // three.js straight out of node_modules, so the bake needs no network.
  if (url.pathname.startsWith('/three/')) {
    void sendFile(res, join(ROOT, 'node_modules/three', url.pathname.slice('/three/'.length)))
    return
  }
  if (url.pathname.startsWith('/models/')) {
    void sendFile(res, join(HERE, decodeURIComponent(url.pathname)))
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log(`character baker on http://localhost:${PORT}/`)
  console.log(`output -> ${OUT}`)
})
