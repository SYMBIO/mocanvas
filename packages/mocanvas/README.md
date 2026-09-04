# mocanvas

An infinite-canvas SDK for the web: a React component with default shapes,
tools and UI, on top of a Rust + WebAssembly engine that does geometry,
hit-testing, culling and tessellation and writes GPU buffers straight into
linear memory.

- Repository, docs and issues: <https://github.com/SYMBIO/mocanvas>
- Benchmarks against the library it is shaped after:
  [docs/BENCHMARK.md](https://github.com/SYMBIO/mocanvas/blob/main/docs/BENCHMARK.md)
- Coming from tldraw:
  [docs/MIGRATION.md](https://github.com/SYMBIO/mocanvas/blob/main/docs/MIGRATION.md)

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

## License

MIT
