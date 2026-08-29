# tools/

Standalone browser tools for working on the world's *look*. None of them are
part of the simulation, none run in Docker, and nothing in `src/` imports them.

They all follow the same shape: a tiny `node:http` server hands the browser an
HTML page plus Three.js and the GLBs straight from the repo, and the browser
does the rendering. No build step, no network, no bundler — run the server and
open the page.

Run each from the repository root:

| Tool | Command | Port |
|---|---|---|
| [City viewer](#city-viewer) | `node tools/city-viewer/server.mjs` | 7800 |
| [Interior preview](#interior-preview) | `node tools/interior-preview/server.mjs` | 7798 |
| [Character baker](#character-baker) | `node tools/render-characters/server.mjs` | 7799 |

---

## City viewer

Renders the city from the Kenney commercial, suburban and industrial packs,
outside the engine. Useful when you are working on city generation or block
layout and want to see a plan without booting Postgres, Redis and dbrain — and
without waiting for a world to tick.

It is a *sibling* of the real viewer, not a copy of it: it makes its own
choices about what to place where. Treat what you see as a sketch of a layout,
not as what `src/viewer` will draw for the same city.

## Interior preview

Standalone Three.js rooms for each venue kind, built from the furniture pack.
Where the city viewer is about the plan from above, this is about what a bar or
an office looks like from inside.

The main viewer does not draw interiors yet — agents indoors are hidden, and
their venue label speaks for them. This tool is where that work gets designed
before any of it reaches `src/viewer`.

## Character baker

Renders the rigged Kenney characters and writes PNG sprite sheets to
`tools/render-characters/models/`.

**Nothing consumes its output any more.** It was written when the viewer was a
2D isometric renderer that needed sprites baked ahead of time. The viewer is now
Three.js and loads the same rigged GLBs directly; sidebar portraits are rendered
off-screen at load time by `renderPortraits` in `src/viewer/scene/agents.ts`,
from the very same models.

It is kept because it is still the quickest way to *look at* the character
models — every character, every animation, every angle, on one page — and
because the rendering code is a working reference for driving these GLBs. Just
do not expect its output to appear in the game.

If you want a baked-sprite pipeline back, this is the starting point. If you
want to know which face belongs to which agent, read `characterIdFor` in
`src/viewer/core/characters-data.ts` instead.

---

## Assets

All three read the Kenney CC0 packs under `src/viewer/public/assets/`. Only the
**GLB** format is in the repository; the FBX, OBJ, preview and city-texture
directories are gitignored and can be re-downloaded from
[kenney.nl](https://kenney.nl).

One exception worth remembering: `people/Models/GLB format/Textures/*.png` **is**
tracked. The character GLBs reference those PNGs externally instead of embedding
them, so without them every character renders as an untextured white shape.
