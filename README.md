# mocanvas

An infinite-canvas SDK for the web with a familiar `Editor` / `ShapeUtil` /
`StateNode` API and a Rust + WebAssembly engine underneath.

- **Fast by construction.** Geometry, hit-testing, spatial indexing, culling
  and tessellation run in WebAssembly and write GPU buffers straight into linear
  memory. The renderer is WebGL2 today, WebGPU next, behind one interface.
- **Familiar API.** If you have used tldraw, you know the shape of this API:
  records with `shape:` / `page:` ids, `createShapes`, `updateShapes`,
  `select`, `zoomToFit`, `ShapeUtil`, `StateNode`, `.tldr` files. The target is
  **tldraw 5.4**; [docs/COMPAT.md](docs/COMPAT.md) says exactly how much of it
  exists, what is deliberately excluded, and where behaviour differs on purpose.
- **Clean-room, MIT.** Written from scratch. See [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).

## Install

```bash
npm install @mocanvas/mocanvas react react-dom
```

```tsx
import { Mocanvas } from "@mocanvas/mocanvas"

export const App = () => (
  <div style={{ position: "absolute", inset: 0 }}>
    <Mocanvas />
  </div>
)
```

Every package is **ESM only** — there is no CommonJS build. The engine locates
its `.wasm` asset with `import.meta.url`, which has no CommonJS equivalent;
Vite, webpack 5, Next, Astro, Remix and Rollup all consume the packages as-is.
See [packages/wasm/README.md](packages/wasm/README.md) for what to do in a
bundler that does not understand `new URL(..., import.meta.url)`.

## Packages

| Package            | What                                                        |
| ------------------ | ----------------------------------------------------------- |
| `@mocanvas/mocanvas`         | `<Mocanvas />`, default shapes, tools, UI                    |
| `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry, `<Canvas />`   |
| `@mocanvas/store`  | records, `Store`, schema, migrations, `.tldr` IO             |
| `@mocanvas/state`  | signals                                                      |
| `@mocanvas/wasm`   | engine bindings                                              |
| `@mocanvas/sync`   | multiplayer: record diffs, presence, cursors                 |
| `@mocanvas/compat` | `TL`-prefixed aliases for a tldraw migration                  |

Rust crates live in `crates/`: `mocanvas-geo`, `mocanvas-scene`,
`mocanvas-render`, `mocanvas-wasm`.

## Develop

Requirements: Node 20+, pnpm 10, Rust stable with the `wasm32-unknown-unknown`
target, `wasm-pack`.

```bash
pnpm install
pnpm build:wasm:dev   # or build:wasm for the optimized build
pnpm dev              # playground on http://localhost:5180
```

Apps and tests in this repository resolve the packages from `src`; `pnpm build`
compiles the wasm and then every package to `dist` in dependency order, which
is what is published.

Tests:

```bash
pnpm test             # vitest across packages
pnpm test:rust        # cargo test
pnpm typecheck
```

## Guides

- [docs/MIGRATION.md](docs/MIGRATION.md) — moving an existing tldraw app over.
- [docs/CUSTOM_SHAPES.md](docs/CUSTOM_SHAPES.md) — writing a custom shape and
  its tool from scratch.

## Architecture

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Short version: the
TypeScript store owns the document; every committed change is mirrored to the
engine as a compact command stream; the engine culls, tessellates and batches;
the canvas uploads buffers by pointer and draws one call per batch. Shapes that
render as React components go to a DOM overlay positioned in page space.

## Status

3.0.0. The API model is tldraw 5.4 — a different architecture from the 3.x model
1.x was shaped after, not a rename. Coming from 1.x, read
[docs/MIGRATION.md](docs/MIGRATION.md).

**93.5% of tldraw 5.4's exported API surface** exists under the same name (1,389
of 1,485 symbols, counted by `pnpm --filter bench api-coverage`). Of the 96 that
do not, 49 are `TL*` spellings of types mocanvas already exports unprefixed and
47 are genuinely absent, mostly `@tldraw/utils` helpers.

Reach is not depth: across the symbols both sides share, 85.7% of
`@tldraw/editor`'s members are present. `Vec`, `Box` and `Mat` are complete,
`Editor` has 304 of 313 members, `ShapeUtil` 52 of 77.
[docs/COMPAT.md](docs/COMPAT.md) has the breakdown and names what is missing.

What is missing is concentrated rather than spread thin: the canvas overlay
painters, the `AssetUtil` subclasses, `PathBuilder` and the stroke helpers, the
highlight shape and laser tool, and some per-shape schema variables.
[docs/COMPAT.md](docs/COMPAT.md) breaks it down, and lists what is excluded on
purpose — the client halves of services tldraw operates, which we would have to
operate too.

Two known performance defects are written up in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-performance-defects): the
spatial index degenerates when many shapes share a bounding box, and snapping
rebuilds geometry the engine already holds. Both were found by measurement, both
have a described fix, neither is done.

[docs/BENCHMARK.md](docs/BENCHMARK.md) measures mocanvas against the library it is
shaped after, on the same workloads, and renders the same document in both.
