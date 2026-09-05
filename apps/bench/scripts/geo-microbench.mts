/**
 * "Build N shape outlines and get them into the engine", old path vs new.
 *
 * Old: JavaScript builds a `Geometry2d`, flattens it to a word array and copies
 * that into WASM memory (`setGeometry`).
 * New: the parameters that describe the outline go over the wire and the path is
 * built in Rust (`setGeo` / `setSpline` / `setDraw`).
 *
 * Run from the repo root, after `pnpm build:wasm` (the release module — the dev
 * one is unoptimised and would flatter the JavaScript):
 *   node node_modules/.pnpm/vite-node@*\/node_modules/vite-node/vite-node.mjs \
 *     apps/bench/scripts/geo-microbench.mts
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { GEO_SHAPE_KINDS, type GeoShapeKind } from "@mocanvas/editor"
import { GEO_KIND, loadEngineSync } from "../../../packages/wasm/src/index"
import { getGeoGeometry } from "../../../packages/mocanvas/src/shapes/geo-helpers"
import { catmullRomToBezier } from "../../../packages/mocanvas/src/shapes/spline-helpers"
import { smoothPoints } from "../../../packages/mocanvas/src/shapes/draw-helpers"
import { CubicSpline2d, Polyline2d } from "@mocanvas/editor"

const N = Number(process.env["N"] ?? 20000)
const REPS = Number(process.env["REPS"] ?? 7)

const wasmPath = fileURLToPath(new URL("../../../packages/wasm/pkg/mocanvas_bg.wasm", import.meta.url))
const bridge = loadEngineSync(readFileSync(wasmPath))

/** A cheap deterministic sequence, so both paths see the same shapes. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

interface GeoCase {
  kind: GeoShapeKind
  kindIndex: number
  w: number
  h: number
}

function makeGeoCases(n: number): GeoCase[] {
  const rng = makeRng(12345)
  const out: GeoCase[] = []
  for (let i = 0; i < n; i++) {
    const kind = GEO_SHAPE_KINDS[i % GEO_SHAPE_KINDS.length]!
    out.push({ kind, kindIndex: GEO_KIND[kind]!, w: 20 + rng() * 400, h: 20 + rng() * 300 })
  }
  return out
}

/** Freehand strokes of a plausible length for a hand-drawn scribble. */
function makeStrokes(n: number, points: number): number[][] {
  const rng = makeRng(999)
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const pts: number[] = []
    let x = 0
    let y = 0
    for (let k = 0; k < points; k++) {
      x += rng() * 6 - 2
      y += rng() * 6 - 2
      pts.push(x, y)
    }
    out.push(pts)
  }
  return out
}

/**
 * Place the shapes on a grid rather than all at the origin. The engine keeps an
 * R-tree of page bounds, and 20 000 entries stacked on one point is a
 * degenerate tree that would dominate the measurement with an artefact.
 */
const GRID = Math.ceil(Math.sqrt(N))

function seed(n: number): void {
  bridge.cmd.clear()
  for (let h = 1; h <= n; h++) {
    const i = h - 1
    bridge.cmd.upsert(h, 1, 0, h, 0, 0, (i % GRID) * 500, Math.floor(i / GRID) * 500, 0, 100, 100)
  }
  bridge.cmd.flush()
}

interface Result {
  label: string
  /** Time in the host: building the outline and writing the command words. */
  host: number[]
  /** Time in `apply()`: decoding, building the path in Rust, reindexing. */
  engine: number[]
  words: number
}

function bench(label: string, n: number, body: (h: number) => void): Result {
  const host: number[] = []
  const engine: number[] = []
  let words = 0
  for (let r = 0; r < REPS; r++) {
    seed(n)
    const t0 = performance.now()
    for (let h = 1; h <= n; h++) body(h)
    words = bridge.cmd.pending
    const t1 = performance.now()
    bridge.cmd.flush()
    const t2 = performance.now()
    host.push(t1 - t0)
    engine.push(t2 - t1)
  }
  return { label, host, engine, words }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]!
}

const results: Result[] = []

// ---- geo -----------------------------------------------------------------
const geoCases = makeGeoCases(N)
results.push(
  bench("geo  old  JS geometry + setGeometry", N, (h) => {
    const c = geoCases[h - 1]!
    bridge.cmd.setGeometry(h, getGeoGeometry(c.kind, c.w, c.h, false).toPathWords())
  }),
)
results.push(
  bench("geo  new  setGeo (parametric)", N, (h) => {
    const c = geoCases[h - 1]!
    bridge.cmd.setGeo(h, c.kindIndex, c.w, c.h)
  }),
)

// ---- freehand ------------------------------------------------------------
const strokes = makeStrokes(N, 24)
results.push(
  bench("draw old  smoothPoints + Polyline2d + setGeometry", N, (h) => {
    const flat = strokes[h - 1]!
    const pts = []
    for (let k = 0; k < flat.length; k += 2) pts.push({ x: flat[k]!, y: flat[k + 1]! })
    bridge.cmd.setGeometry(h, new Polyline2d({ points: smoothPoints(pts) }).toPathWords())
  }),
)
results.push(
  bench("draw new  setDraw (parametric)", N, (h) => {
    bridge.cmd.setDraw(h, [{ points: strokes[h - 1]!, freehand: true }])
  }),
)

// ---- splines -------------------------------------------------------------
const splines = makeStrokes(N, 12)
results.push(
  bench("line old  catmullRomToBezier + CubicSpline2d + setGeometry", N, (h) => {
    const flat = splines[h - 1]!
    const pts = []
    for (let k = 0; k < flat.length; k += 2) pts.push({ x: flat[k]!, y: flat[k + 1]! })
    bridge.cmd.setGeometry(h, new CubicSpline2d({ segments: catmullRomToBezier(pts) }).toPathWords())
  }),
)
results.push(
  bench("line new  setSpline (parametric)", N, (h) => {
    bridge.cmd.setSpline(h, splines[h - 1]!)
  }),
)

const pad = Math.max(...results.map((r) => r.label.length))
console.log(`N = ${N} shapes, ${REPS} reps, median of each`)
console.log("host = JS outline build + command write; engine = apply() incl. path build and reindex\n")
for (let i = 0; i < results.length; i += 2) {
  const [before, after] = [results[i]!, results[i + 1]!]
  for (const r of [before, after]) {
    const total = median(r.host) + median(r.engine)
    console.log(
      `${r.label.padEnd(pad)}  host ${median(r.host).toFixed(1).padStart(7)} ms` +
        `   engine ${median(r.engine).toFixed(1).padStart(7)} ms` +
        `   total ${total.toFixed(1).padStart(7)} ms` +
        `   ${String(r.words).padStart(9)} words`,
    )
  }
  const hostGain = median(before.host) / median(after.host)
  const totalGain = (median(before.host) + median(before.engine)) / (median(after.host) + median(after.engine))
  console.log(
    `${"".padEnd(pad)}  host ${hostGain.toFixed(1)}x faster, total ${totalGain.toFixed(2)}x, ` +
      `${(before.words / after.words).toFixed(1)}x fewer words\n`,
  )
}
