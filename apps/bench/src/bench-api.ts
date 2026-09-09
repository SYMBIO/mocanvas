/**
 * Shared benchmark contract. Both pages (`?lib=mocanvas`, `?lib=tldraw`) install
 * an object with this shape on `window.bench`; `scripts/bench.mjs` drives it.
 *
 * Everything that decides *what* is created or measured lives here so both
 * libraries get byte-identical workloads: same grid, same props, same camera
 * path, same hit-test sample points.
 */

export type Lib = "mocanvas" | "tldraw"
export type Kind = "geo" | "draw" | "mixed"

export interface Vec {
  x: number
  y: number
}
export interface BoxLike {
  x: number
  y: number
  w: number
  h: number
}
export interface CameraLike {
  x: number
  y: number
  z: number
}

export interface CreateResult {
  /** Wall time of the `createShapes` call (inside one transaction). */
  ms: number
  /** Time from the start of the call until the second animation frame after it (first paint settled). */
  firstFrameMs: number
  count: number
}

export interface FrameRunResult {
  frames: number
  avgMs: number
  p50: number
  p95: number
  maxMs: number
  fps: number
  totalMs: number
  /** Long tasks (>50 ms) observed during the run, when `PerformanceObserver` supports them. */
  longTasks: number
  longTaskMs: number
  /** Camera zoom used for the "fit" phase; lets the driver detect clamping differences. */
  zoomFit?: number
}

export interface HitTestResult {
  samples: number
  avgUs: number
  hits: number
}

export interface LoadResult {
  ok: boolean
  error?: string
  records: number
  shapes: number
  warnings: string[]
}

/** A shape's axis-aligned bounding box in *screen* (viewport) pixels, after `fitCamera()`. */
export interface ShapeBox {
  id: string
  type: string
  /** `props.geo` for geo shapes, so the report can say "hexagon" rather than "geo". */
  geo?: string
  x: number
  y: number
  w: number
  h: number
}

export interface GpuInfo {
  renderer: string
  vendor: string
  webgl2: boolean
}

export interface BenchApi {
  lib: Lib
  isReady(): boolean
  create(n: number, kind?: Kind): Promise<CreateResult>
  clear(): Promise<void>
  panZoomRun(frames?: number): Promise<FrameRunResult>
  selectAllDragRun(frames?: number): Promise<FrameRunResult>
  hitTestRun(samples?: number): Promise<HitTestResult>
  memoryMB(): Promise<number>
  loadTldr(json: unknown): Promise<LoadResult>
  screenshotReady(): Promise<boolean>
  fitCamera(): CameraLike | null
  shapeCount(): number
  /**
   * Every shape on the page as a screen-space box, using the *current* camera.
   * The rendering comparison uses these to cut per-shape regions out of the two
   * screenshots. Both pages compute it the same way — page bounds through the
   * shared `screen = (page + camera) * z` mapping — so neither library gets to
   * define the regions differently.
   */
  shapeBoxes(): ShapeBox[]
  gpuInfo(): GpuInfo
  /** tldraw page only: build the rendering-comparison fixture and return it as a `.tldr` document. */
  makeFixture?(): Promise<unknown>
  /**
   * tldraw page only: down-convert a `.tldr` document to the older plain-props
   * representation — `props.richText` → `props.text`, and encoded draw
   * `segments[].path` → `segments[].points`.
   *
   * Both conversions use tldraw's own public helpers
   * (`renderPlaintextFromRichText`, `getPointsFromDrawSegment`). This exists so
   * the rendering comparison can report two numbers: how mocanvas does on a
   * raw tldraw file, and how close it gets once those two known format gaps are
   * shimmed. It is a bench-side convenience, not part of mocanvas.
   */
  downconvert?(json: unknown): Promise<unknown>
  /**
   * Encode legacy `{ points }` draw segments into the `{ path }` form the record
   * validators want, using whichever library this page is running.
   *
   * Exposed because it is the one place the gallery cannot be written once and
   * run on both: tldraw 5 rejects a draw shape whose segments carry `points`,
   * while mocanvas still accepts the legacy shape. Each page passes its own
   * `compressLegacySegments`, so the gallery code itself stays identical.
   */
  compressSegments?(segments: unknown[]): unknown[]
}

declare global {
  interface Window {
    bench?: BenchApi
  }
}

// ---------------------------------------------------------------------------
// Workload specification
// ---------------------------------------------------------------------------

export const COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
] as const
export type SpecColor = (typeof COLORS)[number]

export const GEOS = ["rectangle", "ellipse", "triangle", "diamond", "hexagon", "star"] as const
export type SpecGeo = (typeof GEOS)[number]
export type SpecFill = "none" | "semi" | "solid"

/** Grid cell size in page units. */
export const CELL = 140
/** Points per freehand stroke. */
export const DRAW_POINTS = 40

export type ShapeSpec =
  | { kind: "geo"; x: number; y: number; rotation: number; geo: SpecGeo; w: number; h: number; color: SpecColor; fill: SpecFill }
  | { kind: "draw"; x: number; y: number; color: SpecColor; points: Vec[] }
  | { kind: "arrow"; x: number; y: number; color: SpecColor; start: Vec; end: Vec; bend: number }
  | { kind: "note"; x: number; y: number; color: SpecColor; text: string }
  | { kind: "text"; x: number; y: number; color: SpecColor; text: string }

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function gridPos(i: number, n: number): Vec {
  const cols = Math.ceil(Math.sqrt(n))
  return { x: (i % cols) * CELL, y: Math.floor(i / cols) * CELL }
}

/** 'mixed' = 60% geo, 25% draw, 10% arrows, 5% notes/text (alternating). */
function mixedSlot(i: number): ShapeSpec["kind"] {
  const r = i % 20
  if (r < 12) return "geo"
  if (r < 17) return "draw"
  if (r < 19) return "arrow"
  return Math.floor(i / 20) % 2 === 0 ? "note" : "text"
}

export function strokePoints(i: number): Vec[] {
  const rnd = lcg(i * 7919 + 13)
  const pts: Vec[] = []
  for (let k = 0; k < DRAW_POINTS; k++) {
    const t = k / (DRAW_POINTS - 1)
    const x = t * 100
    const y = 50 + 30 * Math.sin(t * Math.PI * 4 + i) + (rnd() - 0.5) * 6
    pts.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
  }
  return pts
}

export function buildSpecs(n: number, kind: Kind): ShapeSpec[] {
  const out: ShapeSpec[] = []
  for (let i = 0; i < n; i++) {
    const pos = gridPos(i, n)
    const color = COLORS[i % COLORS.length]!
    const slot: ShapeSpec["kind"] = kind === "geo" ? "geo" : kind === "draw" ? "draw" : mixedSlot(i)
    switch (slot) {
      case "geo":
        out.push({
          kind: "geo",
          x: pos.x,
          y: pos.y,
          rotation: ((i * 37) % 360) * (Math.PI / 180) * (i % 3 === 0 ? 1 : 0),
          geo: GEOS[i % GEOS.length]!,
          w: 60 + (i % 5) * 12,
          h: 60 + (i % 7) * 8,
          color,
          fill: i % 4 === 0 ? "solid" : i % 4 === 1 ? "semi" : "none",
        })
        break
      case "draw":
        out.push({ kind: "draw", x: pos.x + 20, y: pos.y + 20, color, points: strokePoints(i) })
        break
      case "arrow":
        out.push({
          kind: "arrow",
          x: pos.x + 20,
          y: pos.y + 20,
          color,
          start: { x: 0, y: 0 },
          end: { x: 100, y: 60 + (i % 3) * 10 },
          bend: i % 2 ? 30 : 0,
        })
        break
      case "note":
        out.push({ kind: "note", x: pos.x, y: pos.y, color, text: `Note ${i}` })
        break
      case "text":
        out.push({ kind: "text", x: pos.x, y: pos.y + 40, color, text: `Text ${i}` })
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Camera path (shared by both pages)
// ---------------------------------------------------------------------------

/** Camera such that `pagePoint` sits at the viewport centre at zoom `z` (screen = (page + cam) * z). */
export function cameraAt(pagePoint: Vec, z: number, vp: BoxLike): CameraLike {
  return { x: -pagePoint.x + vp.w / (2 * z), y: -pagePoint.y + vp.h / (2 * z), z }
}

/** Page-space box → screen-space box under `cam`, the inverse of `cameraAt`'s mapping. */
export function pageBoxToScreen(b: BoxLike, cam: CameraLike): BoxLike {
  return { x: (b.x + cam.x) * cam.z, y: (b.y + cam.y) * cam.z, w: b.w * cam.z, h: b.h * cam.z }
}

/** Zoom-to-fit with a fixed 64px inset; identical framing in both libraries. */
export function fitCameraFor(b: BoxLike, vp: BoxLike, zoomMin = 0.05, zoomMax = 8): CameraLike {
  const inset = 64
  let z = Math.min((vp.w - inset) / Math.max(1, b.w), (vp.h - inset) / Math.max(1, b.h))
  z = Math.min(zoomMax, Math.max(zoomMin, z))
  return cameraAt({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, z, vp)
}

/**
 * The pan/zoom choreography: t in [0,1].
 * Phase 1: zoom in from fit to 4x fit around the centre.
 * Phase 2: pan a horizontal sweep across the middle 50% of the content at 4x.
 * Phase 3: zoom back out to fit.
 */
export function panZoomCamera(t: number, b: BoxLike, vp: BoxLike, fit: CameraLike): CameraLike {
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const zHi = Math.min(8, fit.z * 4)
  if (t < 1 / 3) {
    const u = t * 3
    return cameraAt(center, fit.z + (zHi - fit.z) * u, vp)
  }
  if (t < 2 / 3) {
    const u = (t - 1 / 3) * 3
    return cameraAt({ x: b.x + b.w * (0.25 + 0.5 * u), y: center.y }, zHi, vp)
  }
  const u = (t - 2 / 3) * 3
  return cameraAt(center, zHi + (fit.z - zHi) * u, vp)
}

/** Deterministic sample points inside `b` for hit-testing. */
export function samplePoints(b: BoxLike, n: number): Vec[] {
  const rnd = lcg(0xc0ffee)
  const pts: Vec[] = []
  for (let i = 0; i < n; i++) pts.push({ x: b.x + rnd() * b.w, y: b.y + rnd() * b.h })
  return pts
}

/** Per-frame offset for the select-all drag: sweep right, then back. */
export function dragOffset(i: number, frames: number): Vec {
  const d = 6
  return { x: i < frames / 2 ? d : -d, y: 0 }
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

export async function settleFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame()
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]!
}

export function summarize(deltas: number[], longTasks: number, longTaskMs: number): FrameRunResult {
  const sorted = [...deltas].sort((a, b) => a - b)
  const totalMs = deltas.reduce((a, b) => a + b, 0)
  const avgMs = deltas.length ? totalMs / deltas.length : 0
  return {
    frames: deltas.length,
    avgMs,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maxMs: sorted.length ? sorted[sorted.length - 1]! : 0,
    fps: avgMs > 0 ? 1000 / avgMs : 0,
    totalMs,
    longTasks,
    longTaskMs,
  }
}

/**
 * Run `step` once per animation frame and record frame-to-frame rAF deltas.
 * `step(i, t)` receives the frame index and normalised progress t in [0,1].
 */
export async function runFrames(frames: number, step: (i: number, t: number) => void): Promise<FrameRunResult> {
  const deltas: number[] = []
  let longTasks = 0
  let longTaskMs = 0
  let observer: PerformanceObserver | null = null
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++
        longTaskMs += e.duration
      }
    })
    observer.observe({ type: "longtask", buffered: false })
  } catch {
    observer = null
  }
  await nextFrame()
  let prev = await nextFrame()
  for (let i = 0; i < frames; i++) {
    step(i, frames > 1 ? i / (frames - 1) : 0)
    const t = await nextFrame()
    deltas.push(t - prev)
    prev = t
  }
  // Give the observer a tick to flush pending entries.
  await new Promise((r) => setTimeout(r, 0))
  observer?.disconnect()
  return summarize(deltas, longTasks, longTaskMs)
}

/** Used JS heap in MB (Chromium `performance.memory`; -1 elsewhere). Forces GC when exposed via `--js-flags=--expose-gc`. */
export async function memoryMB(): Promise<number> {
  const w = window as unknown as { gc?: () => void }
  if (typeof w.gc === "function") {
    w.gc()
    await new Promise((r) => setTimeout(r, 50))
    w.gc()
  }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : -1
}

export function gpuInfo(): GpuInfo {
  const canvas = document.createElement("canvas")
  const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null
  if (!gl) return { renderer: "unavailable", vendor: "unavailable", webgl2: false }
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null
  const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR))
  gl.getExtension("WEBGL_lose_context")?.loseContext()
  return { renderer, vendor, webgl2: true }
}

/** Run `fn` while capturing console warnings/errors and uncaught errors into `sink`. */
export async function captureProblems<T>(sink: string[], fn: () => Promise<T> | T): Promise<T> {
  const origWarn = console.warn
  const origError = console.error
  const onError = (e: ErrorEvent) => sink.push(`uncaught: ${e.message}`)
  const onRejection = (e: PromiseRejectionEvent) => sink.push(`unhandled rejection: ${String(e.reason)}`)
  console.warn = (...args: unknown[]) => {
    sink.push(`warn: ${args.map(String).join(" ")}`)
    origWarn.apply(console, args)
  }
  console.error = (...args: unknown[]) => {
    sink.push(`error: ${args.map(String).join(" ")}`)
    origError.apply(console, args)
  }
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  try {
    return await fn()
  } finally {
    console.warn = origWarn
    console.error = origError
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}

export interface TldrFileLike {
  tldrawFileFormatVersion: number
  schema: unknown
  records: Array<Record<string, unknown> & { id: string; typeName: string }>
}

export function parseTldrJson(json: unknown): TldrFileLike {
  const data = (typeof json === "string" ? JSON.parse(json) : json) as TldrFileLike
  if (!data || !Array.isArray(data.records)) throw new Error("not a .tldr document")
  return data
}

/** Dedupe repeated warnings, keeping counts. */
export function foldWarnings(list: string[]): string[] {
  const counts = new Map<string, number>()
  for (const w of list) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts].map(([w, c]) => (c > 1 ? `${w} (x${c})` : w))
}
