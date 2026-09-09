import type { RenderBackend, TextureOptions, TextureSource } from "../render/backend"

/** Produces the pixels for a texture. Rejecting marks the texture as failed. */
export type TextureLoader = () => Promise<TextureSource>

export type TextureState = "pending" | "ready" | "error"

export interface TextureInfo {
  /** Host texture id, `1`-based. `StyleWords.texture` references it. */
  readonly id: number
  /** Number of outstanding `acquire` calls. */
  readonly refs: number
  readonly state: TextureState
  /** Pixel size of the decoded source; `0` until it is ready. */
  readonly width: number
  readonly height: number
}

interface Entry {
  key: string
  id: number
  refs: number
  state: TextureState
  width: number
  height: number
  /** The decoded source, kept so a new backend can be re-uploaded to. */
  source: TextureSource | null
  opts: TextureOptions | undefined
}

export interface TextureManagerOptions {
  /**
   * Called (in a microtask) with the keys whose state just changed, so the host
   * can re-write the shapes holding them and redraw.
   */
  onChange?: (keys: readonly string[]) => void
}

/** Largest device-pixel scale a rasterized texture is rendered at. */
export const MAX_TEXTURE_RESOLUTION = 8
/** Largest zoom factor that still increases texture resolution. */
export const MAX_TEXTURE_ZOOM = 4
const MIN_TEXTURE_ZOOM = 0.25

/**
 * `dpr × min(MAX_TEXTURE_ZOOM, zoom)` snapped up to a power of two, so panning
 * and zooming only re-rasterize a texture when it crosses a bucket boundary.
 */
export function bucketTextureResolution(zoom: number, dpr = 1): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const clamped = Math.min(MAX_TEXTURE_ZOOM, Math.max(MIN_TEXTURE_ZOOM, z))
  const bucket = 2 ** Math.ceil(Math.log2(clamped))
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return Math.min(MAX_TEXTURE_RESOLUTION, Math.max(MIN_TEXTURE_ZOOM, d * bucket))
}

/**
 * Owns the host's GPU textures: allocates ids, refcounts them by key, loads
 * their pixels asynchronously and uploads them through the current
 * `RenderBackend`.
 *
 * `acquire` hands back the id straight away so a shape can be written to the
 * engine in the same tick; the texture only appears once the load resolves, so
 * callers keep a DOM fallback until `isReady(key)`. A key whose load rejected
 * resolves to `0` (no texture — the shape falls back to its plain fill).
 *
 * Callers that re-derive their textures on every write (a `ShapeUtil` in
 * `getRenderStyle`) should acquire inside `withOwner`, which reconciles the
 * keys an owner holds instead of piling up references.
 */
export class TextureManager {
  private readonly entries = new Map<string, Entry>()
  /** owner id → keys that owner currently holds a reference to. */
  private readonly ownerKeys = new Map<string, Set<string>>()
  /** key → owner ids, so the host can find the shapes to re-write. */
  private readonly keyOwners = new Map<string, Set<string>>()
  private backend: RenderBackend | null = null
  private nextId = 1
  private disposed = false
  private owner: string | null = null
  private touched: Set<string> | null = null

  constructor(private readonly options: TextureManagerOptions = {}) {}

  /** Number of live texture entries. */
  get size(): number {
    return this.entries.size
  }

  getBackend(): RenderBackend | null {
    return this.backend
  }

  /**
   * Reference the texture for `key`, starting `load` the first time. Returns
   * the host texture id, or `0` when the key previously failed to load.
   */
  acquire(key: string, load: TextureLoader, opts?: TextureOptions): number {
    if (this.disposed) return 0
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { key, id: this.nextId++, refs: 0, state: "pending", width: 0, height: 0, source: null, opts }
      this.entries.set(key, entry)
      this.load(entry, load)
    }
    const owner = this.owner
    if (owner === null) {
      entry.refs++
    } else {
      let held = this.ownerKeys.get(owner)
      if (!held) {
        held = new Set()
        this.ownerKeys.set(owner, held)
      }
      ;(this.touched ??= new Set()).add(key)
      if (!held.has(key)) {
        held.add(key)
        this.addOwner(key, owner)
        entry.refs++
      }
    }
    return entry.state === "error" ? 0 : entry.id
  }

  /** Drop one reference. The texture is deleted when the last one goes. */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.refs--
    if (entry.refs > 0) return
    this.entries.delete(key)
    this.keyOwners.delete(key)
    this.destroy(entry)
  }

  /** Whether the texture for `key` is uploaded and safe to draw. */
  isReady(key: string): boolean {
    return this.entries.get(key)?.state === "ready"
  }

  getState(key: string): TextureState | undefined {
    return this.entries.get(key)?.state
  }

  /** Current id for `key`: `0` when unknown or failed. */
  getId(key: string): number {
    const entry = this.entries.get(key)
    if (!entry || entry.state === "error") return 0
    return entry.id
  }

  getInfo(key: string): TextureInfo | undefined {
    const e = this.entries.get(key)
    return e && { id: e.id, refs: e.refs, state: e.state, width: e.width, height: e.height }
  }

  /** Owners (shape ids) currently holding `key`. */
  getOwners(key: string): readonly string[] {
    const owners = this.keyOwners.get(key)
    return owners ? [...owners] : []
  }

  /** Every owner holding at least one texture. */
  getAllOwners(): readonly string[] {
    return [...this.ownerKeys.keys()]
  }

  /**
   * Run `fn` with every `acquire` inside it attributed to `owner`. Keys the
   * owner held before but did not acquire again are released, so re-deriving a
   * shape's style neither leaks references nor keeps a stale texture alive.
   */
  withOwner<T>(owner: string, fn: () => T): T {
    if (this.disposed) return fn()
    const prevOwner = this.owner
    const prevTouched = this.touched
    this.owner = owner
    this.touched = null
    try {
      return fn()
    } finally {
      // The callback may have populated it; TS narrows the field from the assignment above.
      const touched = this.touched as Set<string> | null
      const held = this.ownerKeys.get(owner)
      if (held) {
        for (const key of [...held]) {
          if (touched?.has(key)) continue
          held.delete(key)
          this.removeOwner(key, owner)
          this.release(key)
        }
        if (held.size === 0) this.ownerKeys.delete(owner)
      }
      this.owner = prevOwner
      this.touched = prevTouched
    }
  }

  /** Release every key an owner holds (the shape was deleted). */
  releaseOwner(owner: string): void {
    const held = this.ownerKeys.get(owner)
    if (!held) return
    this.ownerKeys.delete(owner)
    for (const key of held) {
      this.removeOwner(key, owner)
      this.release(key)
    }
  }

  /**
   * Point the manager at the backend that owns the GPU textures. Everything
   * already decoded is uploaded again; anything still loading uploads when it
   * resolves. The previous backend keeps (and frees) its own GL objects.
   */
  setBackend(backend: RenderBackend | null): void {
    if (this.disposed || this.backend === backend) return
    this.backend = backend
    if (!backend) return
    for (const entry of this.entries.values()) {
      if (entry.state === "ready" && entry.source) this.upload(entry)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) this.destroy(entry)
    this.entries.clear()
    this.ownerKeys.clear()
    this.keyOwners.clear()
    this.backend = null
  }

  private addOwner(key: string, owner: string): void {
    let owners = this.keyOwners.get(key)
    if (!owners) {
      owners = new Set()
      this.keyOwners.set(key, owners)
    }
    owners.add(owner)
  }

  private removeOwner(key: string, owner: string): void {
    const owners = this.keyOwners.get(key)
    if (!owners) return
    owners.delete(owner)
    if (owners.size === 0) this.keyOwners.delete(key)
  }

  private load(entry: Entry, load: TextureLoader): void {
    let promise: Promise<TextureSource>
    try {
      promise = load()
    } catch (err) {
      promise = Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
    void promise.then(
      (source) => {
        if (this.disposed || this.entries.get(entry.key) !== entry) {
          closeSource(source)
          return
        }
        const [w, h] = sourceSize(source)
        entry.source = source
        entry.width = w
        entry.height = h
        entry.state = "ready"
        this.upload(entry)
        this.options.onChange?.([entry.key])
      },
      () => {
        if (this.disposed || this.entries.get(entry.key) !== entry) return
        entry.state = "error"
        this.options.onChange?.([entry.key])
      },
    )
  }

  private upload(entry: Entry): void {
    if (!this.backend || !entry.source) return
    try {
      this.backend.uploadTexture(entry.id, entry.source, entry.opts)
    } catch {
      // The backend would not take this source. Left "ready" the entry keeps a
      // texture id that was never filled, and an unfilled texture samples as
      // opaque black — so the shape drew a black box and nothing anywhere said
      // why. Marking it failed hands out id `0` instead, which is the white
      // 1×1, and lets a shape that watches its texture state show whatever it
      // shows for an asset it could not load.
      //
      // Only the source is condemned, not the backend: a lost or disposed
      // context throws too, and `setBackend` re-uploads everything still ready
      // when a new one arrives.
      entry.state = "error"
      this.options.onChange?.([entry.key])
    }
  }

  private destroy(entry: Entry): void {
    if (this.backend) {
      try {
        this.backend.deleteTexture(entry.id)
      } catch {
        // ignore: the backend may already be disposed
      }
    }
    closeSource(entry.source)
    entry.source = null
  }
}

function closeSource(source: TextureSource | null): void {
  if (source && typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close()
}

function sourceSize(source: TextureSource): [number, number] {
  const s = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number }
  return [s.naturalWidth || s.videoWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.height || 0]
}
