/**
 * Typed loader and zero-copy bridge over the mocanvas WebAssembly engine.
 *
 * See docs/ARCHITECTURE.md → "Bridge ABI".
 */
import init, { Engine, initSync, version as wasmVersion, type InitInput, type SyncInitInput } from "../pkg/mocanvas.js"

export { Engine }

/** Command opcodes; must match `crates/mocanvas-wasm/src/lib.rs::op`. */
export const OP = {
  UPSERT_SHAPE: 1,
  REMOVE_SHAPE: 2,
  SET_GEOMETRY: 3,
  SET_STYLE: 4,
  CLEAR: 5,
  SET_TEXTURE: 6,
} as const

/** Path opcodes; must match `mocanvas-geo::PathCmd`. */
export const PATH_OP = {
  MOVE: 0,
  LINE: 1,
  QUAD: 2,
  CUBIC: 3,
  CLOSE: 4,
} as const

/** Shape flags; must match `mocanvas-scene`. */
export const FLAG = {
  HIDDEN: 1 << 0,
  LOCKED: 1 << 1,
  OVERLAY: 1 << 2,
  NO_FILL: 1 << 3,
  /** GPU-drawn and also reported to the DOM overlay (labels). */
  LABEL: 1 << 4,
  /** Descendants are clipped to this shape's page-space geometry AABB (frames). */
  CLIP: 1 << 5,
} as const

/** Hit-test filter bits. */
export const HIT_FILTER = {
  INCLUDE_LOCKED: 1,
  INCLUDE_HIDDEN: 2,
  HOLLOW_ONLY: 4,
} as const

export type Handle = number

export interface CameraState {
  /** Page-space offset. screen = (page + cam) * z */
  x: number
  y: number
  z: number
}

/** Floats per vertex in `FrameBuffers.vertices`: `x y u v r g b a`. */
export const VERTEX_FLOATS = 8
/** `u32` words per record in `FrameBuffers.batches`. */
export const BATCH_WORDS = 7
/** `u32` words per record in `FrameBuffers.overlay`. */
export const OVERLAY_WORDS = 10

/** Page-space clip rectangle `[minX, minY, maxX, maxY]`. */
export type ClipRect = [number, number, number, number]

export interface FrameBuffers {
  /**
   * Interleaved `x y u v r g b a` (8 floats) in page space; solid geometry has
   * `u = v = 0`. View into WASM memory; valid until the next engine call.
   */
  vertices: Float32Array
  indices: Uint32Array
  /**
   * `BATCH_WORDS` (7) words per batch: `firstIndex indexCount texture clipMinX
   * clipMinY clipMaxX clipMaxY`. The clip words are f32 bits in page space; all
   * four zero means unclipped. Texture 0 = solid color. A new batch starts
   * whenever the texture or the clip rect changes — use `readBatch`.
   */
  batches: Uint32Array
  /**
   * `OVERLAY_WORDS` (10) words per entry: `handle x y w h rot clipMinX clipMinY
   * clipMaxX clipMaxY` with floats as bits — use `readOverlay`.
   */
  overlay: Uint32Array
  drawn: number
  culled: number
  /**
   * Build counter, bumped only when the buffers are rebuilt. The vertex data is
   * page-space and the camera is a shader uniform, so a moving camera alone does
   * not change it: a backend that has already uploaded version `v` can skip the
   * upload for as long as this reads `v`.
   */
  version: number
  /** Whether the call that produced this frame rebuilt the buffers. */
  dirty: boolean
  /**
   * Shapes were deferred by the per-frame tessellation budget and are drawn as
   * flat placeholder quads meanwhile. Keep scheduling frames until this is false.
   */
  pending: boolean
}

export interface Batch {
  firstIndex: number
  indexCount: number
  /** Host texture id, 0 = solid color. */
  texture: number
  /** Page-space clip rect, or undefined when unclipped. */
  clip?: ClipRect
}

export interface OverlayEntry {
  handle: Handle
  x: number
  y: number
  w: number
  h: number
  rotation: number
  /** Page-space clip rect inherited from the nearest clipping ancestor, if any. */
  clip?: ClipRect
}

export interface StyleWords {
  /** 0xRRGGBBAA, alpha 0 = none */
  fill: number
  stroke: number
  strokeWidth: number
  dash: number
  opacity: number
  /**
   * Host texture id (0 or undefined = none). Not part of SET_STYLE; send it with
   * `CommandWriter.setTexture`. When set, the fill is drawn as one textured quad
   * over the shape's local bounds (uv 0..1), tinted white × opacity.
   */
  texture?: number
  /**
   * Per-shape random seed (0 or undefined = 0). Only `dash: 3` (hand-drawn) reads
   * it: it picks that shape's wobble, so the same seed always redraws the same
   * outline. Derive it from the shape's stable id, never from its handle or its
   * position in the scene, or a shape will change shape when it is re-added.
   */
  seed?: number
}

const scratchF32 = new Float32Array(1)
const scratchU32 = new Uint32Array(scratchF32.buffer)

/** Bit-cast a float to u32 without allocation. */
export function f32bits(v: number): number {
  scratchF32[0] = v
  return scratchU32[0]!
}

/** Bit-cast a u32 to float without allocation. */
export function bitsf32(v: number): number {
  scratchU32[0] = v
  return scratchF32[0]!
}

/** Four clip words (f32 bits) at `offset` → rect, or undefined when all zero (unclipped). */
export function readClip(words: Uint32Array, offset: number): ClipRect | undefined {
  const a = words[offset]!
  const b = words[offset + 1]!
  const c = words[offset + 2]!
  const d = words[offset + 3]!
  if ((a | b | c | d) === 0) return undefined
  return [bitsf32(a), bitsf32(b), bitsf32(c), bitsf32(d)]
}

/**
 * Writes commands straight into the engine's command buffer in WASM memory.
 * Call `flush()` once per store transaction.
 */
export class CommandWriter {
  private view: Uint32Array
  private cap: number
  private len = 0

  constructor(
    private readonly engine: Engine,
    private readonly memory: WebAssembly.Memory,
    initialWords = 1 << 14,
  ) {
    this.cap = initialWords
    const ptr = engine.cmd_ptr(this.cap)
    this.view = new Uint32Array(memory.buffer, ptr, this.cap)
  }

  /** Words queued but not yet applied. */
  get pending(): number {
    return this.len
  }

  private ensure(words: number): void {
    if (this.len + words <= this.cap && this.view.buffer === this.memory.buffer) return
    let cap = this.cap
    while (this.len + words > cap) cap *= 2
    this.cap = cap
    // The engine's Vec keeps existing content on resize; only the pointer may move.
    const ptr = this.engine.cmd_ptr(cap)
    this.view = new Uint32Array(this.memory.buffer, ptr, cap)
  }

  upsert(
    handle: Handle,
    kind: number,
    parent: Handle,
    zlo: number,
    zhi: number,
    flags: number,
    x: number,
    y: number,
    rotation: number,
    w: number,
    h: number,
  ): void {
    this.ensure(12)
    const v = this.view
    let i = this.len
    v[i++] = OP.UPSERT_SHAPE
    v[i++] = handle
    v[i++] = kind
    v[i++] = parent
    v[i++] = zlo
    v[i++] = zhi
    v[i++] = flags
    v[i++] = f32bits(x)
    v[i++] = f32bits(y)
    v[i++] = f32bits(rotation)
    v[i++] = f32bits(w)
    v[i++] = f32bits(h)
    this.len = i
  }

  remove(handle: Handle): void {
    this.ensure(2)
    this.view[this.len++] = OP.REMOVE_SHAPE
    this.view[this.len++] = handle
  }

  /** `pathWords` is the flat f32 path encoding (opcode, args...). */
  setGeometry(handle: Handle, pathWords: ArrayLike<number>): void {
    const n = pathWords.length
    this.ensure(3 + n)
    const v = this.view
    let i = this.len
    v[i++] = OP.SET_GEOMETRY
    v[i++] = handle
    v[i++] = n
    for (let k = 0; k < n; k++) v[i++] = f32bits(pathWords[k]!)
    this.len = i
  }

  setStyle(handle: Handle, s: StyleWords): void {
    this.ensure(8)
    const v = this.view
    let i = this.len
    v[i++] = OP.SET_STYLE
    v[i++] = handle
    v[i++] = s.fill >>> 0
    v[i++] = s.stroke >>> 0
    v[i++] = f32bits(s.strokeWidth)
    v[i++] = s.dash >>> 0
    v[i++] = f32bits(s.opacity)
    v[i++] = (s.seed ?? 0) >>> 0
    this.len = i
  }

  /** Set the fill texture of a shape (0 = solid fill). Independent of `setStyle`. */
  setTexture(handle: Handle, texture: number): void {
    this.ensure(3)
    const v = this.view
    let i = this.len
    v[i++] = OP.SET_TEXTURE
    v[i++] = handle
    v[i++] = texture >>> 0
    this.len = i
  }

  clear(): void {
    this.ensure(1)
    this.view[this.len++] = OP.CLEAR
  }

  /** Apply queued commands. Returns the number of commands applied. Throws on a malformed stream. */
  flush(): number {
    if (this.len === 0) return 0
    const n = this.engine.apply(this.len)
    this.len = 0
    const err = this.engine.take_error()
    if (err) throw new Error(`mocanvas engine: ${err}`)
    return n
  }
}

/** High-level wrapper: owns the engine, the command writer, and typed views. */
export class EngineBridge {
  readonly cmd: CommandWriter
  /**
   * Shapes the engine may tessellate in one `frame()` call; the rest are drawn as
   * level-of-detail quads and picked up by later frames, which keeps a viewport
   * full of never-seen shapes from stalling on one frame. Read from the engine so
   * `mocanvas_render::DEFAULT_TESS_BUDGET` stays the single source of truth.
   */
  tessBudget: number
  private lastFrame: FrameBuffers | null = null

  constructor(
    readonly engine: Engine,
    readonly memory: WebAssembly.Memory,
  ) {
    this.cmd = new CommandWriter(engine, memory)
    this.tessBudget = Engine.default_tess_budget()
  }

  get shapeCount(): number {
    return this.engine.shape_count()
  }

  get epoch(): number {
    return this.engine.epoch()
  }

  /**
   * Build (or reuse) the frame for a camera. `tessBudget` overrides
   * {@link EngineBridge.tessBudget} for this call; pass `0` for no cap, which is
   * what tests want when they need one deterministic frame.
   *
   * When the engine reports the buffers unchanged the previous `FrameBuffers`
   * object is returned as-is, views included, so `frame.version` is a stable
   * identity a backend can compare against what it last uploaded.
   */
  frame(cam: CameraState, viewportW: number, viewportH: number, tessBudget: number = this.tessBudget): FrameBuffers {
    const e = this.engine
    e.frame(cam.x, cam.y, cam.z, viewportW, viewportH, tessBudget)
    const buf = this.memory.buffer
    const version = e.frame_version()
    const last = this.lastFrame
    // Reuse the views when nothing was rebuilt — unless WASM memory grew, which
    // detaches every existing view over it.
    if (last && !e.frame_dirty() && last.version === version && last.vertices.buffer === buf) {
      last.dirty = false
      last.pending = e.frame_pending()
      return last
    }
    const frame: FrameBuffers = {
      vertices: new Float32Array(buf, e.vertices_ptr(), e.vertices_len()),
      indices: new Uint32Array(buf, e.indices_ptr(), e.indices_len()),
      batches: new Uint32Array(buf, e.batches_ptr(), e.batches_len()),
      overlay: new Uint32Array(buf, e.overlay_ptr(), e.overlay_len()),
      drawn: e.drawn_count(),
      culled: e.culled_count(),
      version,
      dirty: e.frame_dirty(),
      pending: e.frame_pending(),
    }
    this.lastFrame = frame
    return frame
  }

  /** Decode the overlay buffer of a frame. */
  static readOverlay(overlay: Uint32Array): OverlayEntry[] {
    const out: OverlayEntry[] = []
    for (let i = 0; i + OVERLAY_WORDS <= overlay.length; i += OVERLAY_WORDS) {
      const entry: OverlayEntry = {
        handle: overlay[i]!,
        x: bitsf32(overlay[i + 1]!),
        y: bitsf32(overlay[i + 2]!),
        w: bitsf32(overlay[i + 3]!),
        h: bitsf32(overlay[i + 4]!),
        rotation: bitsf32(overlay[i + 5]!),
      }
      const clip = readClip(overlay, i + 6)
      if (clip) entry.clip = clip
      out.push(entry)
    }
    return out
  }

  /** Decode one batch record starting at word `offset` (a multiple of `BATCH_WORDS`). */
  static readBatch(batches: Uint32Array, offset: number): Batch {
    const b: Batch = { firstIndex: batches[offset]!, indexCount: batches[offset + 1]!, texture: batches[offset + 2]! }
    const clip = readClip(batches, offset + 3)
    if (clip) b.clip = clip
    return b
  }

  /** Decode the batch buffer of a frame. */
  static readBatches(batches: Uint32Array): Batch[] {
    const out: Batch[] = []
    for (let i = 0; i + BATCH_WORDS <= batches.length; i += BATCH_WORDS) out.push(EngineBridge.readBatch(batches, i))
    return out
  }

  /**
   * Grow the box each frame is built for by `pad` (a fraction of the viewport size)
   * on every side, so a camera panning inside that margin reuses the buffers instead
   * of rebuilding and re-uploading them.
   *
   * Zero by default: the pad submits `(1 + 2 * pad)²` more geometry on every frame in
   * exchange for skipping the upload on some of them, which only pays when the host's
   * upload is expensive relative to its per-triangle cost. It is on a hardware GPU;
   * it is emphatically not under software rasterisation.
   */
  setViewportPad(pad: number): void {
    this.engine.set_viewport_pad(pad)
  }

  /** The current viewport pad. */
  get viewportPad(): number {
    return this.engine.viewport_pad()
  }

  hitTest(pageX: number, pageY: number, tolerance: number, filter = 0): Handle {
    return this.engine.hit_test(pageX, pageY, tolerance, filter)
  }

  /** Handles in draw order. `mode` 0 = intersects, 1 = contains. Returns a copy. */
  queryBox(minX: number, minY: number, maxX: number, maxY: number, mode: 0 | 1 = 0, filter = 0): Uint32Array {
    const n = this.engine.query_box(minX, minY, maxX, maxY, mode, filter)
    return new Uint32Array(this.memory.buffer, this.engine.handles_ptr(), n).slice()
  }

  private readBox(): [number, number, number, number] {
    const f = new Float32Array(this.memory.buffer, this.engine.f32_ptr(), 4)
    return [f[0]!, f[1]!, f[2]!, f[3]!]
  }

  /**
   * Ink page bounds `[minX, minY, maxX, maxY]` or null: the shape's outline
   * expanded by half its stroke width. This is what the spatial index, the
   * viewport cull and clipping run on. For a user-facing measurement of where
   * the shape *is*, use {@link geometryBounds}.
   */
  bounds(handle: Handle): [number, number, number, number] | null {
    return this.engine.bounds(handle) ? this.readBox() : null
  }

  /** Geometry page bounds `[minX, minY, maxX, maxY]` or null: `bounds` without the stroke pad. */
  geometryBounds(handle: Handle): [number, number, number, number] | null {
    return this.engine.geometry_bounds(handle) ? this.readBox() : null
  }

  unionBounds(handles: ArrayLike<number>): [number, number, number, number] | null {
    if (this.cmd.pending > 0) throw new Error("unionBounds called with unflushed commands")
    const n = handles.length
    const ptr = this.engine.cmd_ptr(Math.max(n, 1))
    new Uint32Array(this.memory.buffer, ptr, n).set(handles)
    return this.engine.union_bounds(n) ? this.readBox() : null
  }

  /** Union of every shape's ink bounds, or null when the scene is empty. */
  allBounds(): [number, number, number, number] | null {
    return this.engine.all_bounds() ? this.readBox() : null
  }

  /** Union of every shape's geometry bounds, or null when the scene is empty. */
  allGeometryBounds(): [number, number, number, number] | null {
    return this.engine.all_geometry_bounds() ? this.readBox() : null
  }

  /** Page transform `[a b c d e f]` or null. */
  pageTransform(handle: Handle): [number, number, number, number, number, number] | null {
    if (!this.engine.page_transform(handle)) return null
    const f = new Float32Array(this.memory.buffer, this.engine.f32_ptr(), 6)
    return [f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!]
  }

  dispose(): void {
    this.engine.free()
  }
}

let initPromise: Promise<WebAssembly.Memory> | null = null

/**
 * Load the WASM module (once) and create an engine.
 *
 * With no argument the module is resolved as
 * `new URL("../pkg/mocanvas_bg.wasm", import.meta.url)`, which Vite, webpack 5
 * and Rollup all recognise: they emit the `.wasm` file as an asset and rewrite
 * the URL to point at it. The same relative path is correct from `src/` during
 * development and from `dist/` in the published package.
 *
 * Bundlers that do not understand `new URL(..., import.meta.url)` need the
 * location passed in: `loadEngine("/assets/mocanvas_bg.wasm")`, a `URL`, a
 * `Response`, or the compiled bytes. See the package README.
 */
export async function loadEngine(input?: InitInput): Promise<EngineBridge> {
  if (!initPromise) {
    const module_or_path = input ?? new URL("../pkg/mocanvas_bg.wasm", import.meta.url)
    initPromise = init({ module_or_path }).then((o) => o.memory)
  }
  const memory = await initPromise
  return new EngineBridge(new Engine(), memory)
}

/** Synchronous variant for tests / Node: pass the compiled bytes. */
export function loadEngineSync(bytes: SyncInitInput): EngineBridge {
  const out = initSync({ module: bytes })
  initPromise = Promise.resolve(out.memory)
  return new EngineBridge(new Engine(), out.memory)
}

export function engineVersion(): string {
  return wasmVersion()
}
