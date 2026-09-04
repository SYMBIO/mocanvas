# @mocanvas/wasm

The Rust/WebAssembly engine behind [mocanvas](https://github.com/SYMBIO/mocanvas)
and its TypeScript bridge. The engine owns the scene: it holds shape geometry,
maintains a spatial index, hit-tests, culls to the viewport, tessellates and
batches, and writes vertex/index/batch buffers into linear memory that the host
uploads to the GPU by pointer — no per-frame copying.

Most applications use `mocanvas` or `@mocanvas/editor` instead of this package
directly. No React, no other dependencies.

## Install

```bash
npm install @mocanvas/wasm
```

## Use

```ts
import { loadEngine } from "@mocanvas/wasm"

const bridge = await loadEngine()

// handle, kind, parent, z-lo, z-hi, flags, x, y, rotation, w, h
bridge.cmd.upsert(1, 0, 0, 0, 0, 0, 0, 0, 0, 200, 120)
bridge.cmd.setStyle(1, { fill: 0x4465e9ff, stroke: 0x000000ff, strokeWidth: 2, dash: 0, opacity: 1 })
bridge.cmd.flush()

const frame = bridge.frame({ x: 0, y: 0, z: 1 }, 800, 600)
console.log(frame.drawn, frame.batches.length / 7)
```

## Loading the `.wasm` file

With no argument, `loadEngine()` resolves the module as
`new URL("../pkg/mocanvas_bg.wasm", import.meta.url)`. Vite, webpack 5 and
Rollup all recognise that form: they emit the file as an asset and rewrite the
URL to point at it. The file is ~256 KB and is fetched separately; it is
deliberately not inlined as base64 into the JavaScript bundle.

Two cases need help:

- **Vite** pre-bundles dependencies with esbuild, which does not rewrite the
  URL. Exclude the package from the optimizer:

  ```ts
  // vite.config.ts
  export default defineConfig({ optimizeDeps: { exclude: ["@mocanvas/wasm"] } })
  ```

- **A bundler that does not understand `new URL(..., import.meta.url)`** needs
  the location passed in. Copy or serve
  `node_modules/@mocanvas/wasm/pkg/mocanvas_bg.wasm` and pass its URL — or a
  `Response`, or the compiled bytes:

  ```ts
  await loadEngine("/assets/mocanvas_bg.wasm")
  await loadEngine(fetch("/assets/mocanvas_bg.wasm"))
  ```

In Node there is no bundler and `fetch` does not read `file:` URLs, so
`loadEngine()` with no argument is a browser path only. Load the bytes
yourself instead:

```ts
import { readFileSync } from "node:fs"
import { loadEngineSync } from "@mocanvas/wasm"

const bridge = loadEngineSync(readFileSync("node_modules/@mocanvas/wasm/pkg/mocanvas_bg.wasm"))
```

The engine is a process-wide singleton: the first `loadEngine` call decides how
the module is loaded, and later calls reuse it.

ESM only.

## License

MIT
