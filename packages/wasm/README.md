# @mocanvas/wasm

The Rust/WebAssembly engine behind mocanvas
and its TypeScript bridge. The engine owns the scene: it holds shape geometry,
maintains a spatial index, hit-tests, culls to the viewport, tessellates and
batches, and writes vertex/index/batch buffers into linear memory that the host
uploads to the GPU by pointer — no per-frame copying.

Most applications use `@mocanvas/mocanvas` or `@mocanvas/editor` instead of this package
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

`loadEngine()` needs no configuration in any bundler.

With no argument it resolves the module as
`new URL("../pkg/mocanvas_bg.wasm", import.meta.url)` — Vite, webpack 5 and
Rollup all recognise that form and emit the file as an asset — then fetches it
and checks the first four bytes are the WebAssembly magic number. The file is
~256 KB and is fetched separately; it is deliberately not inlined into the
JavaScript bundle.

If those bytes are not a module, the URL is not usable: a dev server answering
every unknown path with `index.html`, a 404 page, a JSON error. Rather than let
a `CompileError: expected magic word 00 61 73 6d` escape, the loader falls back
to a base64 copy of the engine that ships in the package, pulled in with a
dynamic `import()` so it sits in its own chunk and is never downloaded on the
happy path. It logs one warning when it does.

### Avoiding the fallback

The one common way to end up on that path is Vite's dependency optimizer, which
pre-bundles with esbuild and rewrites `import.meta.url` without moving the
asset. Excluding the package skips the extra download:

```ts
// vite.config.ts — an optimisation, not a requirement
export default defineConfig({ optimizeDeps: { exclude: ["@mocanvas/wasm"] } })
```

`vite build` is unaffected either way: Rollup emits the `.wasm` as an asset and
the URL resolves.

### Pointing at the file yourself

A bundler that does not understand `new URL(..., import.meta.url)` at all, or a
setup that serves the asset from somewhere specific, can pass the location in.
Copy or serve `node_modules/@mocanvas/wasm/pkg/mocanvas_bg.wasm` and pass its
URL — or a `Response`, or the compiled bytes, or a `WebAssembly.Module`:

```ts
await loadEngine("/assets/mocanvas_bg.wasm")
await loadEngine(fetch("/assets/mocanvas_bg.wasm"))
```

An explicit input is taken at face value: it is handed straight to the glue,
with no validation and no fallback, so a wrong location surfaces as its own
error instead of being papered over.

### Node

In Node `fetch` does not read `file:` URLs, so `loadEngine()` with no argument
reaches the embedded copy (with the warning). For tests and scripts, load the
bytes yourself instead:

```ts
import { readFileSync } from "node:fs"
import { loadEngineSync } from "@mocanvas/wasm"

const bridge = loadEngineSync(readFileSync("node_modules/@mocanvas/wasm/pkg/mocanvas_bg.wasm"))
```

The engine is a process-wide singleton: the first `loadEngine` call decides how
the module is loaded, and later calls reuse it.

ESM only.

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

The full terms are in `LICENSE`, shipped in this package. Versions released
earlier under MIT stay available under MIT, on the terms they were released
with.
