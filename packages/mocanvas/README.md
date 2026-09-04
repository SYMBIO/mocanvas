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
npm install mocanvas react react-dom
```

`react` and `react-dom` (>= 18) are peer dependencies.

## Use

```tsx
import { createRoot } from "react-dom/client"
import { Mocanvas, createShapeId, type Editor } from "mocanvas"

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

The engine lives in `@mocanvas/wasm` and is loaded on mount. By default it
resolves as `new URL("../pkg/mocanvas_bg.wasm", import.meta.url)`, which
bundlers recognise: they emit the file as an asset and rewrite the URL.

Two notes:

- **Vite** pre-bundles dependencies with esbuild, which does not rewrite that
  URL. Exclude the package from the optimizer:

  ```ts
  // vite.config.ts
  export default defineConfig({ optimizeDeps: { exclude: ["@mocanvas/wasm"] } })
  ```

- **A bundler that does not understand `new URL(..., import.meta.url)`** needs
  the location passed in. Serve `node_modules/@mocanvas/wasm/pkg/mocanvas_bg.wasm`
  yourself and load the engine before rendering:

  ```ts
  import { loadEngine } from "@mocanvas/wasm"
  await loadEngine("/assets/mocanvas_bg.wasm") // URL, Response or bytes
  ```

  The engine is a singleton, so a later `<Mocanvas />` reuses it.

The `.wasm` file is ~256 KB and is fetched separately; it is deliberately not
inlined as base64 into the JavaScript bundle.

## Packages

| Package            | What                                                       |
| ------------------ | ---------------------------------------------------------- |
| `mocanvas`         | `<Mocanvas />`, default shapes, tools, UI                   |
| `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry, `<Canvas />`  |
| `@mocanvas/store`  | records, `Store`, schema, migrations, `.tldr` IO            |
| `@mocanvas/state`  | signals                                                     |
| `@mocanvas/wasm`   | engine bindings                                             |
| `@mocanvas/sync`   | multiplayer: record diffs, presence, cursors                |
| `@mocanvas/compat` | `TL`-prefixed aliases for a tldraw migration                |

## License

MIT
