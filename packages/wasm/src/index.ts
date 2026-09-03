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

export interface FrameBuffers {
  /** Interleaved x y r g b a in page space. View into WASM memory; valid until the next engine call. */
  vertices: Float32Array
  indices: Uint32Array
  /** (firstIndex, indexCount, texture) triples. */
  batches: Uint32Array
  /** (handle, x, y, w, h, rot) sextets with floats as bits — use `readOverlay`. */
  overlay: Uint32Array
  drawn: number
  culled: number
}

export interface OverlayEntry {
  handle: Handle
  x: number
  y: number
  w: number
  h: number
  rotation: number
}

export interface StyleWords {
  /** 0xRRGGBBAA, alpha 0 = none */
  fill: number
  stroke: number
  strokeWidth: number
  dash: number
  opacity: number
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
    this.ensure(7)
    const v = this.view
    let i = this.len
    v[i++] = OP.SET_STYLE
    v[i++] = handle
    v[i++] = s.fill >>> 0
    v[i++] = s.stroke >>> 0
    v[i++] = f32bits(s.strokeWidth)
    v[i++] = s.dash >>> 0
    v[i++] = f32bits(s.opacity)
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

  constructor(
    readonly engine: Engine,
    readonly memory: WebAssembly.Memory,
  ) {
    this.cmd = new CommandWriter(engine, memory)
  }

  get shapeCount(): number {
    return this.engine.shape_count()
  }

  get epoch(): number {
    return this.engine.epoch()
  }

  frame(cam: CameraState, viewportW: number, viewportH: number): FrameBuffers {
    const e = this.engine
    e.frame(cam.x, cam.y, cam.z, viewportW, viewportH)
    const buf = this.memory.buffer
    return {
      vertices: new Float32Array(buf, e.vertices_ptr(), e.vertices_len()),
      indices: new Uint32Array(buf, e.indices_ptr(), e.indices_len()),
      batches: new Uint32Array(buf, e.batches_ptr(), e.batches_len()),
      overlay: new Uint32Array(buf, e.overlay_ptr(), e.overlay_len()),
      drawn: e.drawn_count(),
      culled: e.culled_count(),
    }
  }

  /** Decode the overlay buffer of a frame. */
  static readOverlay(overlay: Uint32Array): OverlayEntry[] {
    const out: OverlayEntry[] = []
    for (let i = 0; i + 6 <= overlay.length; i += 6) {
      out.push({
        handle: overlay[i]!,
        x: bitsf32(overlay[i + 1]!),
        y: bitsf32(overlay[i + 2]!),
        w: bitsf32(overlay[i + 3]!),
        h: bitsf32(overlay[i + 4]!),
        rotation: bitsf32(overlay[i + 5]!),
      })
    }
    return out
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

  /** Page bounds `[minX, minY, maxX, maxY]` or null. */
  bounds(handle: Handle): [number, number, number, number] | null {
    return this.engine.bounds(handle) ? this.readBox() : null
  }

  unionBounds(handles: ArrayLike<number>): [number, number, number, number] | null {
    if (this.cmd.pending > 0) throw new Error("unionBounds called with unflushed commands")
    const n = handles.length
    const ptr = this.engine.cmd_ptr(Math.max(n, 1))
    new Uint32Array(this.memory.buffer, ptr, n).set(handles)
    return this.engine.union_bounds(n) ? this.readBox() : null
  }

  allBounds(): [number, number, number, number] | null {
    return this.engine.all_bounds() ? this.readBox() : null
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
 * Load the WASM module (once) and create an engine. In Vite/browsers the module
 * URL is resolved relative to this package; pass `input` to override.
 */
export async function loadEngine(input?: InitInput): Promise<EngineBridge> {
  if (!initPromise) {
    initPromise = init(input === undefined ? undefined : { module_or_path: input }).then((o) => o.memory)
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
