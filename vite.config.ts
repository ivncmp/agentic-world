import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const root = import.meta.dirname
const engine = process.env.ENGINE_URL ?? 'http://localhost:7070'

export default defineConfig({
  root: 'src/viewer',
  publicDir: resolve(root, 'src/viewer/public'),
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: resolve(root, 'dist/viewer'),
    emptyOutDir: true,
  },
  server: {
    port: 8080,
    // Anchored regexes, not bare prefixes: a plain '/world' rule also swallows
    // '/world-scene.ts' and proxies the module request to the engine.
    proxy: {
      '^/world$': engine,
      '^/agent(\\?.*)?$': engine,
      '^/state$': engine,
      '^/health$': engine,
      '^/live$': { target: engine, ws: true },
    },
  },
})
