# mocanvas

An infinite-canvas SDK for the web: a React component with default shapes,
tools and UI, on top of a Rust + WebAssembly engine that does geometry,
hit-testing, culling and tessellation and writes GPU buffers straight into
linear memory.

## Why this exists

We built products on [tldraw](https://tldraw.dev), and it is a genuinely
excellent library — the API model in this package is shaped after it because we
think they got that design right. What we ran out of was headroom: our canvases
grew past the point where a DOM-and-SVG renderer kept up, and the work we needed
to move off the main thread had nowhere to go.

So mocanvas is that same shape of API with a different engine underneath, and it
is built so you can come across without rewriting your app:

- **The API is the one you know.** `Editor`, `ShapeUtil`, `StateNode`, records
  with `shape:` / `page:` ids, `createShapes`, `zoomToFit`, `.tldr` files.
- **Every symbol tldraw's reference documents exists here under the same name.**
  1,420 of 1,420 — see *Compatibility with tldraw* below for what that does and
  does not promise.
- **`@mocanvas/compat` gives you the `TL`-prefixed spellings**, so a migration
  can change import paths first and rename later. `MIGRATION.md`, shipped in
  this package, walks through it.

## Performance

The engine is the point. Geometry, hit-testing, spatial indexing, culling and
tessellation run in WebAssembly and write GPU vertex buffers straight into
linear memory; the renderer is WebGL2 today and WebGPU behind the same
interface next.

Creating shapes, median milliseconds — lower is better:

| Scene | mocanvas | tldraw 5.4 | |
| :--- | ---: | ---: | ---: |
| 1,000 geo shapes | 17 ms | 44 ms | **2.6× faster** |
| 5,000 geo shapes | 43 ms | 131 ms | **3.1× faster** |
| 20,000 geo shapes | 145 ms | 387 ms | **2.7× faster** |
| 1,000 mixed | 29 ms | 70 ms | **2.4× faster** |
| 5,000 mixed | 80 ms | 191 ms | **2.4× faster** |
| 20,000 mixed | 234 ms | 609 ms | **2.6× faster** |

Interaction at scale, dragging a selection, median milliseconds per frame:

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

`BENCHMARK.md`, shipped in this package, has the method, the full tables, the rest of the caveats, and a
rendering-fidelity comparison against tldraw at 99.2% interior IoU.

## Compatibility with tldraw

The API is shaped after **tldraw 5.4**, and every symbol its public reference
documents exists here under the same name — 1,420 of 1,420, across `tldraw`,
`@tldraw/editor`, `@tldraw/tlschema`, `@tldraw/store`, `@tldraw/state`,
`@tldraw/state-react` and `@tldraw/validate`. `@mocanvas/compat` carries the
`TL`-prefixed spellings so an existing codebase can switch imports first and
rename later.

Names are not behaviour, and the honest number is lower: across the symbols both
libraries share, 86.4% of `@tldraw/editor`'s members are present. `Vec`, `Box`
and `Mat` are complete; `Editor` has 304 of its 313 members and `ShapeUtil` 52 of
77, the gap there being mostly the `can*` predicates.

Four documented packages are not implemented. `@tldraw/mermaid` and
`@tldraw/driver` are wanted and unbuilt. `@tldraw/sync` and `@tldraw/sync-core`
are a deliberate difference: mocanvas has multiplayer — `@mocanvas/sync`, with
its own transport and a field-level CRDT — but not tldraw's sync protocol, so an
app keeping its existing tldraw sync *server* would have to move. Licensing and
watermark checks, `useSyncDemo` and the asset CDN defaults are tied to services
tldraw runs and are not coming; each has a seam to supply your own.

`COMPAT.md` in this package has the measured breakdown and names what is missing.

## Guides, shipped in this package

`COMPAT.md` for what exists of the tldraw API, `MIGRATION.md` for moving an app
across, `CUSTOM_SHAPES.md` for writing a shape util and its tool, `BENCHMARK.md`
for the performance and fidelity method, `ARCHITECTURE.md` for how the engine
works, and `CLEAN_ROOM.md` for how this library was built.

## Install

```bash
npm install @mocanvas/mocanvas react react-dom
```

`react` and `react-dom` (>= 18) are peer dependencies.

## Use

```tsx
import { createRoot } from "react-dom/client"
import { Mocanvas, createShapeId, type Editor } from "@mocanvas/mocanvas"

function App() {
  function onMount(editor: Editor) {
    editor.createShapes([
      {
        id: createShapeId(),
        type: "geo",
        x: 100,
        y: 100,
        props: { geo: "rectangle", w: 200, h: 120, color: "blue", fill: "semi" },
      },
    ])
    editor.zoomToFit()
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Mocanvas onMount={onMount} />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
```

`<Mocanvas />` fills its container, so give the container a size. The default
UI stylesheet is imported by the package itself — no extra CSS import.

## ESM only

The package ships ES modules and no CommonJS build. It locates its `.wasm`
asset with `import.meta.url`, which has no CommonJS equivalent. Vite, webpack
5, Next, Astro, Remix and Rollup all consume it as-is; `require("mocanvas")`
does not work.

## The WebAssembly engine

The engine lives in `@mocanvas/wasm` and is loaded on mount. **No bundler
configuration is required.** It resolves as
`new URL("../pkg/mocanvas_bg.wasm", import.meta.url)`, which bundlers
recognise — they emit the file as an asset and rewrite the URL — then fetches
it and verifies it really is WebAssembly. The file is ~256 KB and is fetched
separately; it is deliberately not inlined into the JavaScript bundle.

When that URL does not answer with WebAssembly (a dev server's HTML fallback, a
404 page), the loader uses a base64 copy that ships in the package instead of
failing, logs one warning, and the canvas renders. The copy is behind a dynamic
`import()`, so it is its own chunk and is never downloaded otherwise.

Two optional notes:

- **Vite's dependency optimizer** pre-bundles with esbuild and rewrites that
  URL without moving the asset, which is the one common way to land on the
  fallback in `vite dev`. Excluding the package skips the extra download:

  ```ts
  // vite.config.ts — an optimisation, not a requirement
  export default defineConfig({ optimizeDeps: { exclude: ["@mocanvas/wasm"] } })
  ```

  `vite build` is unaffected either way.

- **To serve the asset from a location of your own**, load the engine before
  rendering:

  ```ts
  import { loadEngine } from "@mocanvas/wasm"
  await loadEngine("/assets/mocanvas_bg.wasm") // URL, Response or bytes
  ```

  An explicit input is used as given, with no fallback. The engine is a
  singleton, so a later `<Mocanvas />` reuses it.

## Packages

| Package            | What                                                       |
| ------------------ | ---------------------------------------------------------- |
| `@mocanvas/mocanvas`         | `<Mocanvas />`, default shapes, tools, UI                   |
| `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry, `<Canvas />`  |
| `@mocanvas/store`  | records, `Store`, schema, migrations, `.tldr` IO            |
| `@mocanvas/state`  | signals                                                     |
| `@mocanvas/wasm`   | engine bindings                                             |
| `@mocanvas/sync`   | multiplayer: record diffs, presence, cursors                |
| `@mocanvas/compat` | `TL`-prefixed aliases for a tldraw migration                |

## Clean room

**mocanvas has never been built by reading tldraw's source** — not the
repository, not a copy in `node_modules`, not a fork. It is written from first
principles against the public API reference and guides on tldraw.dev and sample
`.tldr` documents, and its compatibility is *measured* against that same
reference. Names are not copyrightable expression (*Google v. Oracle*, 2021);
the implementation behind them is our own original work. `CLEAN_ROOM.md` in
this package is the full policy.

mocanvas is not affiliated with or endorsed by tldraw.

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

The full terms are in `LICENSE`, shipped in this package.
