# The viewer

Three.js over Kenney GLB packs. `src/viewer/` splits three ways:

| Folder | Holds |
|---|---|
| `scene/` | The 3D scene — one module per concern, `index.ts` orchestrates |
| `core/` | Engine connection, the stable hash, character mapping |
| `ui/` | DOM panels: sidebar, agent card, venue card, relationship graph |

## The viewer is a spectator with no authority

Everything it draws comes from `GET /world` once, plus the `/live` WebSocket
each tick. It never writes, and it never decides anything the engine would have
to agree with later.

## The city must look the same everywhere

Only the **venues** come from the engine. Which building model stands on a
filler tile, its rotation, which tree, which lamp — all of that is chosen
client-side by `hash(gx, gy, salt)` from `core/hash.ts`.

That keeps a 25×25 city out of the world payload while staying identical across
reloads, across browsers, and across two people watching the same world.

**So the viewer contains no `Math.random`.** Reach for the hash instead; a
random model choice would make two spectators disagree about what their town
looks like.

## Scene modules

| Module | Responsibility |
|---|---|
| `grid.ts` | Tile geometry and the spatial predicates everything else asks about a tile — street, water, bridge, which block |
| `assets.ts` | The GLB catalogue and the loader that normalises each pack to the tile |
| `ground.ts` | One flat tile per cell, plus the per-tile facts the tooltip needs |
| `roads.ts` | Road piece and rotation derived from a tile's four neighbours; bridges |
| `buildings.ts` | Venues from the engine, then filler buildings and props by block role |
| `agents.ts` | Rigged character per agent, walk routing, animation, off-screen portraits |
| `lighting.ts` | Sun arc, colour and sky, driven by the in-game hour |
| `labels.ts` | The DOM overlays and their four rules |
| `picking.ts` | Hover resolution and the tooltip |
| `camera.ts` | Orbit controls, fit-to-agents, glide-to-tile, follow-an-agent |
| `highlight.ts` | Hover tint, cached per source material |

Each is a set of functions taking the state they need. `index.ts` owns the
renderer, the camera and the render loop, and delegates everything else.

## Picking is against meshes, not tiles

Hover and click raycast the full model volume, not the ground plane. A
ground-tile hit test looks correct until you point at the top of a tower, which
projects nowhere near its own tile.

Hover tints every mesh in the hit object using a cache keyed by **source
material** — GLB clones share their materials, so the tinted variants are built
once and reused. Tinting per instance would multiply the material count by the
number of buildings in the city.

## Label rules

In `updateVenueLabels` / `updateAgentLabels`:

1. A venue with nobody inside shows no label.
2. A venue with occupants shows its name and who is inside, with an arrow
   pointing at the building.
3. Hovering any building hides every venue label and shows that building's
   tooltip instead — one thing labelled at a time.
4. An agent visible in the street always carries their name. Indoors, the mesh
   and the label hide together.

## One character, one face

`core/characters-data.ts` owns `characterIdFor(agentId)`, and every consumer
resolves through it. Sidebar portraits are rendered off-screen at load time from
the same GLBs the scene walks around.

This was a real bug: the DOM avatars used 2D sprite sheets with their own hash,
so the face in the list was not the body in the street. **If you add a third
place that shows an agent's face, resolve it through `characterIdFor` too.**

## Time of day is the engine's, not the clock's

`applySkyForHour` takes the in-game hour from each state message and drives sun
position, colour, intensity, sky, fog and exposure. The sun rises at 6, peaks at
13 and sets at 20, so shadows sweep across the city as the day runs; below the
horizon the same light becomes the moon.

**Night stays a readable moonlit blue on purpose.** This is a spectator view,
and a realistic night is one where you cannot see the drama.

## Assets

Kenney CC0 packs under `src/viewer/public/assets/`:

- `city/` — commercial, suburban, industrial, roads
- `people/` — 18 rigged characters

**Only the GLB format is used.** The FBX and OBJ directories, previews and the
city packs' standalone textures are gitignored — re-download them from
kenney.nl if you need them.

**One exception, and it matters:** `people/Models/GLB format/Textures/*.png` is
*not* ignored. The character GLBs reference those PNGs externally rather than
embedding them, so deleting them makes every agent render as an untextured white
blob. That happened once.

## Running it

Vite serves the viewer, proxying `/world`, `/state` and `/live` to the engine on
`:7070`.

```bash
pnpm viewer         # dev server with hot reload
pnpm viewer:build   # production bundle into dist/viewer
```

Under Docker, `docker-compose.override.yml` already runs the dev server with
`src/` bind-mounted, so viewer edits reload without rebuilding the image.
