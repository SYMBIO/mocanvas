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

## Packages

| Package            | What                                                        |
| ------------------ | ----------------------------------------------------------- |
| `mocanvas`         | `<Mocanvas />`, default shapes, tools, UI                    |
| `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry, `<Canvas />`   |
| `@mocanvas/store`  | records, `Store`, schema, migrations, `.tldr` IO             |
| `@mocanvas/state`  | signals                                                      |
| `@mocanvas/wasm`   | engine bindings                                              |

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

Phase 1 (vertical slice). See the phases list at the end of the architecture
document.
