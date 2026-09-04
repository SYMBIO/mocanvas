# mocanvas

An infinite-canvas SDK for the web with a familiar `Editor` / `ShapeUtil` /
`StateNode` API and a Rust + WebAssembly engine underneath.

- **Fast by construction.** Geometry, hit-testing, spatial indexing, culling
  and tessellation run in WebAssembly and write GPU buffers straight into linear
  memory. The renderer is WebGL2 today, WebGPU next, behind one interface.
- **Familiar API.** If you have used tldraw, you know the shape of this API:
  records with `shape:` / `page:` ids, `createShapes`, `updateShapes`,
  `select`, `zoomToFit`, `ShapeUtil`, `StateNode`, `.tldr` files. See
  [docs/COMPAT.md](docs/COMPAT.md).
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

Phases 1-4 are done: the Rust/WASM engine with textures, clipping and level of
detail; the document model with `.tldr` load and save; the editor with tools,
bindings, styles, snapping, groups and history; GPU-textured images and text;
WebGL2 and WebGPU backends; SVG and PNG export; collaboration; and the default
shapes, tools and UI.

`docs/BENCHMARK.md` measures mocanvas against the library it is shaped after on
the same workloads and renders the same document in both for comparison. The
open items are listed at the end of `docs/ARCHITECTURE.md`.
