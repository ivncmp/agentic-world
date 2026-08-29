# src/viewer/

Three.js over Kenney GLB packs. Served by Vite, proxying to the engine on
`:7070`.

| Path | Holds |
|---|---|
| `main.ts` | Boot: fetch the world, build the scene, wire the panels |
| `core/` | `connection.ts` (engine + WebSocket), `characters-data.ts`, `hash.ts` |
| `scene/` | The 3D scene — one module per concern, `index.ts` orchestrates |
| `ui/` | DOM panels: sidebar, agent card, venue card, relationship graph, avatars |
| `public/assets/` | The Kenney packs |

Full guide: [documentation/viewer.md](../../documentation/viewer.md).

## Two rules that are not style

**The viewer is a spectator with no authority.** Everything it draws comes from
`GET /world` once, plus the `/live` WebSocket each tick. It never writes, and it
never decides anything the engine would have to agree with later.

**No `Math.random`, anywhere.** Only venues come from the engine; which building
model stands on a filler tile, its rotation, which tree, which lamp are all
chosen client-side by `hash(gx, gy, salt)`. That keeps a 25×25 city out of the
world payload while staying identical across reloads, browsers and spectators. A
random choice would make two people disagree about what their town looks like.

## scene/

| Module | Responsibility |
|---|---|
| `index.ts` | Renderer, camera, render loop. Delegates everything else |
| `grid.ts` | Tile geometry and the spatial predicates — street, water, bridge, block |
| `assets.ts` | The GLB catalogue and the loader that normalises each pack to the tile |
| `ground.ts` | One flat tile per cell, plus the facts the tooltip needs |
| `roads.ts` | Road piece and rotation from a tile's four neighbours; bridges |
| `buildings.ts` | Venues from the engine, then filler buildings and props by block role |
| `agents.ts` | Rigged character per agent, walk routing, animation, portraits |
| `lighting.ts` | Sun arc, colour and sky, driven by the in-game hour |
| `labels.ts` | The DOM overlays and their four rules |
| `picking.ts` | Hover resolution and the tooltip |
| `camera.ts` | Orbit controls, fit-to-agents, glide-to-tile, follow |
| `highlight.ts` | Hover tint, cached per source material |

Each exports functions taking the state they need, so `index.ts` stays an
orchestrator rather than a god object.

## Things that have already bitten

- **Picking raycasts meshes, not tiles.** A ground-tile hit test looks right
  until you point at the top of a tower, which projects nowhere near its own
  tile.
- **Hover tint is cached by source material.** GLB clones share materials, so the
  tinted variants are built once. Per instance would multiply the material count
  by every building in the city.
- **One character, one face.** `characterIdFor` in `core/characters-data.ts` is
  the single source. Sidebar portraits are rendered off-screen at load from the
  same GLBs the scene walks around. Before that, DOM avatars used sprite sheets
  with their own hash and the face in the list was not the body in the street.
  If you add a third place that shows a face, resolve it through
  `characterIdFor`.
- **The people pack's textures are external.** The character GLBs reference
  `people/Models/GLB format/Textures/*.png` rather than embedding them. Delete
  those PNGs and every agent renders as an untextured white shape.
