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
- **Clean-room.** Written from scratch, never by reading tldraw's source — only
  its public documentation. See [Clean room](#clean-room).
- **Free unless you sell it.** Free for non-commercial use, non-profit
  organisations, and development and evaluation; shipping it commercially needs
  an agreement. See [License](#license).

## Why this exists

We built products on [tldraw](https://tldraw.dev), and it is a genuinely
excellent library — the API model here is shaped after it because we think they
got that design right. What we ran out of was headroom: our canvases grew past
the point where a DOM-and-SVG renderer kept up, and the work we needed off the
main thread had nowhere to go.

mocanvas is that same shape of API with a different engine underneath, built so
an existing tldraw app can come across rather than be rewritten.
[docs/MIGRATION.md](docs/MIGRATION.md) walks through the move;
`@mocanvas/compat` supplies the `TL`-prefixed spellings so imports can change
first and names later.

## Performance

Creating shapes, median milliseconds — lower is better:

| Scene | mocanvas | tldraw 5.4 | |
| :--- | ---: | ---: | ---: |
| 1,000 geo shapes | 17 ms | 44 ms | **2.6× faster** |
| 5,000 geo shapes | 43 ms | 131 ms | **3.1× faster** |
| 20,000 geo shapes | 145 ms | 387 ms | **2.7× faster** |
| 1,000 mixed | 29 ms | 70 ms | **2.4× faster** |
| 5,000 mixed | 80 ms | 191 ms | **2.4× faster** |
| 20,000 mixed | 234 ms | 609 ms | **2.6× faster** |

Dragging a selection, median milliseconds per frame:

| Scene | mocanvas | tldraw 5.4 | |
| :--- | ---: | ---: | ---: |
| 1,000 geo shapes | 9.2 ms | 16.7 ms | **1.8× faster** |
| 5,000 geo shapes | 58.3 ms | 108.3 ms | **1.9× faster** |
| 20,000 geo shapes | 233.3 ms | 541.6 ms | **2.3× faster** |
| 1,000 mixed | 16.6 ms | 16.8 ms | a tie, at the frame floor |
| 5,000 mixed | 66.6 ms | 116.4 ms | **1.8× faster** |
| 20,000 mixed | 280.9 ms | 608.4 ms | **2.2× faster** |

mocanvas scales: about 2.6× on building a scene at every size, and the
interaction gap widens as the scene grows — 1.8× at a thousand shapes, 2.3× at
twenty thousand.

**With their caveats.** Measured on an Apple M3 Pro, headless Chromium on the
Metal backend, default settings on both sides. Two things count against
mocanvas and are worth knowing: every shape here uses the hand-drawn stroke,
which is its most expensive path, and pan and zoom is left out entirely because
mocanvas sits at the harness's own frame floor in every case — it cannot be
measured, so it is not claimed. It is our own benchmark of our own library.

An earlier version of this table was measured under software rasterisation and
was wrong in both directions: it flattered mocanvas on creation (~3× where the
truth is ~2.6×) and reported a loss at a thousand shapes that turned out to be an
artefact of the CPU rasteriser rather than anything either library did.

[docs/BENCHMARK.md](docs/BENCHMARK.md) has the method, the full tables, the rest of the caveats, and a
rendering-fidelity comparison against tldraw at 99.2% interior IoU.

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

## Clean room

**mocanvas has never been built by reading tldraw's source.** Not the repository,
not a copy in `node_modules`, not a fork. The compatibility described above was
built against the public API reference and guides on tldraw.dev, sample `.tldr`
documents, and first-principles implementation — and it is *measured* against
that same reference, from an enumeration of the documented symbol names.

Names are not copyrightable expression (*Google v. Oracle*, 2021); the
implementation behind them is original work. The full policy, including
the single bounded exception for the private benchmark harness, is
[docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).

mocanvas is not affiliated with or endorsed by tldraw.

## Status

4.0.2. The API model is tldraw 5.4 — a different architecture from the 3.x model
1.x was shaped after, not a rename. Coming from 1.x, read
[docs/MIGRATION.md](docs/MIGRATION.md).

**Every symbol tldraw 5.4's reference documents exists under the same name** —
1,420 of 1,420 across the seven packages this project maps, held there by
`pnpm --filter bench api-coverage -- --reference`, which fails if one regresses.
Four documented packages are not implemented; see *What is not covered*.

Names are not behaviour, though. Across the symbols both sides share, 86.4% of
`@tldraw/editor`'s members are present: `Vec`, `Box` and `Mat` are complete,
`Editor` has 304 of 313 members, `ShapeUtil` 52 of 77.
[docs/COMPAT.md](docs/COMPAT.md) has the breakdown and names what is missing.

### What is not covered

Four packages the reference documents are not implemented. None of them is a
capability mocanvas cannot have; the reasons differ and are worth stating
separately.

| Package | Why not | |
| :--- | :--- | :--- |
| `@tldraw/mermaid` | Mermaid text to shapes on the canvas. Self-contained, nothing blocks it. | **Wanted** |
| `@tldraw/driver` | An imperative API over the editor for tests, automation and REPLs, built on public editor calls. Nothing blocks it either. | **Wanted** |
| `@tldraw/sync` / `@tldraw/sync-core` | A different multiplayer architecture, not a missing one — see below. | **By design** |

**On sync, precisely.** mocanvas *has* multiplayer: `@mocanvas/sync`, with its own
transport and a field-level CRDT. What it does not have is tldraw's sync API —
`useSync`, `TLSocketRoom`, `TLSyncClient` and the storage wrappers around them.
That is an architecture choice, not a service dependency: tldraw's sync server is
one you run yourself, on Node, Cloudflare Durable Objects, Bun or any WebSocket
server, and only `useSyncDemo` points at a host tldraw operates. So an app that
wants collaboration is served; an app that wants to keep its existing tldraw sync
*server* is not, and would have to move to `@mocanvas/sync`.

Genuinely tied to services tldraw runs, and therefore never coming: licensing and
watermark checks, `useSyncDemo`, the asset CDN defaults, and third-party embed
unfurling. Each has a seam to supply your own.

Beyond the packages, 45 symbols that the packages export but the reference does
not document are also absent — almost all `@tldraw/utils` helpers such as
`debounce`, `modulate` and `FileHelpers`. `import { debounce } from "tldraw"`
fails today. They are deliberately not written from guessed semantics.

Two known performance defects are written up in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-performance-defects): the
spatial index degenerates when many shapes share a bounding box, and snapping
rebuilds geometry the engine already holds. Both were found by measurement, both
have a described fix, neither is done.

[docs/BENCHMARK.md](docs/BENCHMARK.md) measures mocanvas against the library it is
shaped after, on the same workloads, and renders the same document in both.

## License

**Source-available, not open source.** Free to use for:

- personal, non-commercial projects;
- non-profit organisations;
- development, evaluation, testing and staging — including inside a for-profit
  company, so you can try it and build against it before committing;
- teaching and academic research.

**Shipping it in a commercial product, service or website needs a written
agreement with us.** That includes anything sold, anything that earns revenue
directly or through advertising, and internal tools running a for-profit
business.

To arrange one, or if you are unsure which side of the line you are on, write to
**mocanvas@symbio.agency** — we would rather answer the question than have you
guess.

The full terms are in `LICENSE`, at the repository root.
