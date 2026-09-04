import { atom, computed, transact, unsafe__withoutCapture, type Atom, type Computed } from "@mocanvas/state"
import {
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndicesAbove,
  indexKeyToZKey,
  sortByIndex,
  ZERO_INDEX_KEY,
  type IndexKey,
} from "@mocanvas/store"
import { EngineBridge, FLAG, type CameraState, type ClipRect, type FrameBuffers, type StyleWords } from "@mocanvas/wasm"
import { Box, Vec, type BoxLike, type Geometry2d, type VecLike } from "../geometry"
import {
  CameraRecordType,
  DOCUMENT_ID,
  DocumentRecordType,
  INSTANCE_ID,
  InstancePageStateRecordType,
  InstanceRecordType,
  isPageId,
  isShapeId,
  PageRecordType,
  ShapeRecordType,
  type Camera,
  type Document,
  type Instance,
  type InstancePageState,
  type Page,
  type PageId,
  type ParentId,
  type ShapeCreate,
  type ShapeId,
  type ShapePartial,
  type UnknownShape,
} from "../records/base"
import type { ShapeUtil, ShapeUtilConstructor } from "../shapes/ShapeUtil"
import type { BindingUtil, BindingUtilConstructor } from "../bindings/BindingUtil"
import {
  BindingRecordType,
  isBinding,
  type BindingCreate,
  type BindingId,
  type BindingPartial,
  type UnknownBinding,
} from "../records/binding"
import {
  AssetRecordType,
  type Asset,
  type AssetCreate,
  type AssetId,
  type AssetPartial,
  type ExternalAssetContent,
  type ExternalAssetHandler,
  type ExternalAssetType,
  type ExternalContent,
  type ExternalContentHandler,
  type ExternalContentType,
} from "../records/asset"
import { createRootState } from "../tools/RootState"
import type { StateNode, StateNodeConstructor } from "../tools/StateNode"
import type { RenderBackend } from "../render/backend"
import type { EditorRecord, EditorStore } from "./createStore"
import {
  EventEmitter,
  type EditorEvents,
  type EventInfo,
  type PointerEventInfo,
  type VecModel,
  type WheelEventInfo,
} from "./events"
import { HandleTable } from "./HandleTable"
import { bucketTextureResolution, TextureManager } from "./TextureManager"
import { createUserPreferences, type InstancePresence, type UserPreferences } from "../records/presence"
import { getStylePropsOf, SharedStyleMap, type StyleProp } from "../records/styleProp"
import { HistoryManager } from "./HistoryManager"
import { SnapManager } from "./SnapManager"

export interface EditorOptions {
  store: EditorStore
  shapeUtils: readonly ShapeUtilConstructor[]
  bindingUtils?: readonly BindingUtilConstructor[]
  tools: readonly StateNodeConstructor[]
  engine: EngineBridge
  /** Id of the tool to start in. Defaults to the first tool. */
  initialState?: string
  getContainer: () => HTMLElement
  options?: Partial<EditorConfig>
}

export interface EditorConfig {
  maxShapesPerPage: number
  dragDistanceSquared: number
  /** Hit-test tolerance in screen pixels. */
  hitTestMargin: number
  zoomMin: number
  zoomMax: number
  zoomSteps: number[]
  backgroundColor: [number, number, number, number]
  animationMediumMs: number
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  maxShapesPerPage: 4000,
  dragDistanceSquared: 16,
  hitTestMargin: 8,
  zoomMin: 0.05,
  zoomMax: 8,
  zoomSteps: [0.1, 0.25, 0.5, 1, 2, 4, 8],
  backgroundColor: [0.976, 0.98, 0.984, 1],
  animationMediumMs: 320,
}

export interface EditorInputs {
  originPagePoint: Vec
  originScreenPoint: Vec
  previousPagePoint: Vec
  previousScreenPoint: Vec
  currentPagePoint: Vec
  currentScreenPoint: Vec
  keys: Set<string>
  buttons: Set<number>
  isPen: boolean
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  accelKey: boolean
  isDragging: boolean
  isPointing: boolean
  isPinching: boolean
  isEditing: boolean
  isPanning: boolean
  pointerVelocity: Vec
}

export interface HitTestOptions {
  margin?: number
  hitInside?: boolean
  hitLocked?: boolean
  hitFrameInside?: boolean
  filter?: (shape: UnknownShape) => boolean
}

const RAD_PER_DEG = Math.PI / 180

/**
 * The editor: document access, selection, camera, tool dispatch, and the
 * bridge that mirrors the current page into the WASM engine.
 */
export class Editor extends EventEmitter<EditorEvents> {
  readonly store: EditorStore
  readonly engine: EngineBridge
  readonly history: HistoryManager<EditorRecord>
  readonly root: StateNode
  readonly shapeUtils: Readonly<Record<string, ShapeUtil>>
  readonly bindingUtils: Readonly<Record<string, BindingUtil>>
  readonly options: EditorConfig
  readonly inputs: EditorInputs
  readonly handles = new HandleTable()
  /** GPU textures referenced by shape styles (images, rasterized text). */
  readonly textures: TextureManager = new TextureManager({ onChange: (keys) => this.onTexturesChanged(keys) })
  readonly snaps: SnapManager
  readonly getContainer: () => HTMLElement
  readonly sideEffects: EditorStore["sideEffects"]

  private readonly kindIds = new Map<string, number>()
  private readonly _frameEpoch: Atom<number>
  private readonly _overlayShapeIds: Atom<readonly ShapeId[]>
  private readonly _overlayClips: Atom<readonly (ClipRect | undefined)[]>
  private readonly _isDisposed: Atom<boolean>
  private readonly _lastFrame: Atom<{ drawn: number; culled: number; ms: number }>
  private readonly disposables: (() => void)[] = []
  private syncedPageId: PageId | null = null
  /** Shapes whose last write to the engine threw; they are warned about once. */
  private readonly brokenShapeIds = new Set<ShapeId>()

  constructor(opts: EditorOptions) {
    super()
    this.store = opts.store
    this.engine = opts.engine
    this.getContainer = opts.getContainer
    this.options = { ...DEFAULT_EDITOR_CONFIG, ...opts.options }
    this.sideEffects = this.store.sideEffects
    this.snaps = new SnapManager(this)

    this._frameEpoch = atom("editor.frameEpoch", 0)
    this._overlayShapeIds = atom<readonly ShapeId[]>("editor.overlayShapeIds", [])
    this._overlayClips = atom<readonly (ClipRect | undefined)[]>("editor.overlayClips", [])
    this._isDisposed = atom("editor.isDisposed", false)
    this._lastFrame = atom("editor.lastFrame", { drawn: 0, culled: 0, ms: 0 })

    this.inputs = {
      originPagePoint: new Vec(),
      originScreenPoint: new Vec(),
      previousPagePoint: new Vec(),
      previousScreenPoint: new Vec(),
      currentPagePoint: new Vec(),
      currentScreenPoint: new Vec(),
      keys: new Set(),
      buttons: new Set(),
      isPen: false,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      accelKey: false,
      isDragging: false,
      isPointing: false,
      isPinching: false,
      isEditing: false,
      isPanning: false,
      pointerVelocity: new Vec(),
    }

    const utils: Record<string, ShapeUtil> = {}
    let kind = 1
    for (const U of opts.shapeUtils) {
      if (utils[U.type]) throw new Error(`Duplicate ShapeUtil for type "${U.type}"`)
      utils[U.type] = new U(this)
      this.kindIds.set(U.type, kind++)
    }
    this.shapeUtils = utils

    const bindingUtils: Record<string, BindingUtil> = {}
    for (const B of opts.bindingUtils ?? []) {
      if (bindingUtils[B.type]) throw new Error(`Duplicate BindingUtil for type "${B.type}"`)
      bindingUtils[B.type] = new B(this)
    }
    this.bindingUtils = bindingUtils

    this.ensureBaseRecords()
    this.registerBindingSideEffects()
    this.registerTextureSideEffects()

    this.history = new HistoryManager(this.store, () => this.emit("update"))

    const Root = createRootState(opts.tools, opts.initialState ?? opts.tools[0]?.id ?? "")
    this.root = new Root(this)
    this.root.enter({}, "initial")

    this.disposables.push(
      this.store.listen(
        (entry) => {
          this.syncChanges(entry.changes)
          this.emit("change", { source: entry.source })
        },
        { source: "all", scope: "document" },
      ),
      this.store.listen(
        () => {
          this.bumpFrame()
        },
        { source: "all", scope: "session" },
      ),
    )
    this.syncPage(this.getCurrentPageId())
  }

  // ---- lifecycle ----------------------------------------------------------

  dispose(): void {
    if (this._isDisposed.get()) return
    this._isDisposed.set(true)
    for (const d of this.disposables) d()
    this.textures.dispose()
    this.history.destroy()
    this.removeAllListeners()
  }

  getIsDisposed(): boolean {
    return this._isDisposed.get()
  }

  private ensureBaseRecords(): void {
    transact(() => {
      if (!this.store.has(DOCUMENT_ID)) {
        this.store.put([DocumentRecordType.create({ id: DOCUMENT_ID, name: this.store.props.defaultName })])
      }
      let pages = this.store.query.records("page").get()
      if (pages.length === 0) {
        const page = PageRecordType.create({ id: PageRecordType.createId(), name: "Page 1", index: ZERO_INDEX_KEY })
        this.store.put([page])
        pages = [page]
      }
      const sorted = sortByIndex(pages)
      const firstPage = sorted[0]!
      let instance = this.store.get(INSTANCE_ID) as Instance | undefined
      if (!instance || !this.store.has(instance.currentPageId)) {
        instance = InstanceRecordType.create({
          id: INSTANCE_ID,
          currentPageId: firstPage.id,
        })
        this.store.put([instance])
      }
      for (const p of sorted) this.ensurePageSessionRecords(p.id)
    })
  }

  private ensurePageSessionRecords(pageId: PageId): void {
    const camId = CameraRecordType.createId(pageId.slice("page:".length))
    if (!this.store.has(camId)) this.store.put([CameraRecordType.create({ id: camId })])
    const psId = InstancePageStateRecordType.createId(pageId.slice("page:".length))
    if (!this.store.has(psId)) this.store.put([InstancePageStateRecordType.create({ id: psId, pageId })])
  }

  // ---- reactivity helpers -------------------------------------------------

  /** Increments whenever the GPU frame must be redrawn. */
  getFrameEpoch(): number {
    return this._frameEpoch.get()
  }

  private bumpFrame(): void {
    this._frameEpoch.update((v) => v + 1)
  }

  /** Stats for the last rendered frame. */
  getLastFrameStats(): { drawn: number; culled: number; ms: number } {
    return this._lastFrame.get()
  }

  /** Shapes the DOM overlay must render this frame, in draw order. */
  getOverlayShapeIds(): readonly ShapeId[] {
    return this._overlayShapeIds.get()
  }

  /**
   * Page-space clip rects for the overlay shapes, parallel to
   * `getOverlayShapeIds()`; `undefined` where the shape is unclipped.
   */
  getOverlayClips(): readonly (ClipRect | undefined)[] {
    return this._overlayClips.get()
  }

  // ---- batching / history ------------------------------------------------

  run<T>(fn: () => T, opts: { history?: "record" | "ignore" | "record-preserveRedoStack" } = {}): T {
    return transact(() => {
      if (opts.history === "ignore") return this.history.ignore(fn)
      return fn()
    })
  }

  /** @deprecated use `run` */
  batch<T>(fn: () => T): T {
    return this.run(fn)
  }

  markHistoryStoppingPoint(name?: string): string {
    return this.history.mark(name)
  }

  /** Alias of `markHistoryStoppingPoint`. */
  mark(name?: string): string {
    return this.markHistoryStoppingPoint(name)
  }

  undo(): this {
    this.history.undo()
    return this
  }

  redo(): this {
    this.history.redo()
    return this
  }

  bail(): this {
    this.history.bail()
    return this
  }

  bailToMark(id: string): this {
    this.history.bailToMark(id)
    return this
  }

  squashToMark(id: string): this {
    this.history.squashToMark(id)
    return this
  }

  getCanUndo(): boolean {
    return this.history.getNumUndos() > 0
  }

  getCanRedo(): boolean {
    return this.history.getNumRedos() > 0
  }

  // ---- document / pages --------------------------------------------------

  getDocumentSettings(): Document {
    return this.store.get(DOCUMENT_ID) as Document
  }

  updateDocumentSettings(settings: Partial<Omit<Document, "id" | "typeName">>): this {
    this.store.put([{ ...this.getDocumentSettings(), ...settings }])
    return this
  }

  private readonly _pages: Computed<Page[]> = computed("editor.pages", () =>
    sortByIndex(this.store.query.records("page").get() as Page[]),
  )

  getPages(): Page[] {
    return this._pages.get()
  }

  getPage(id: PageId): Page | undefined {
    return this.store.get(id) as Page | undefined
  }

  getInstanceState(): Instance {
    return this.store.get(INSTANCE_ID) as Instance
  }

  updateInstanceState(partial: Partial<Omit<Instance, "id" | "typeName">>): this {
    this.run(
      () => {
        this.store.put([{ ...this.getInstanceState(), ...partial }])
      },
      { history: "ignore" },
    )
    return this
  }

  getCurrentPageId(): PageId {
    return this.getInstanceState().currentPageId
  }

  getCurrentPage(): Page {
    return this.getPage(this.getCurrentPageId())!
  }

  setCurrentPage(pageId: PageId): this {
    if (!this.store.has(pageId)) throw new Error(`Page ${pageId} does not exist`)
    if (pageId === this.getCurrentPageId()) return this
    this.run(
      () => {
        this.ensurePageSessionRecords(pageId)
        this.updateInstanceState({ currentPageId: pageId })
      },
      { history: "ignore" },
    )
    this.syncPage(pageId)
    return this
  }

  createPage(page: Partial<Omit<Page, "id" | "typeName" | "index">> & { id?: PageId } = {}): this {
    const pages = this.getPages()
    const index = getIndexAbove(pages.at(-1)?.index)
    const record = PageRecordType.create({
      id: page.id ?? PageRecordType.createId(),
      name: page.name ?? `Page ${pages.length + 1}`,
      index,
      meta: page.meta ?? {},
    })
    this.run(() => {
      this.store.put([record])
      this.ensurePageSessionRecords(record.id)
    })
    return this
  }

  deletePage(id: PageId): this {
    const pages = this.getPages()
    if (pages.length <= 1) return this
    this.run(() => {
      if (this.getCurrentPageId() === id) {
        const next = pages.find((p) => p.id !== id)!
        this.setCurrentPage(next.id)
      }
      const shapeIds = this.getPageShapeIds(id)
      this.store.remove([...shapeIds, id])
    })
    return this
  }

  renamePage(id: PageId, name: string): this {
    const page = this.getPage(id)
    if (page) this.store.put([{ ...page, name }])
    return this
  }

  getCurrentPageState(): InstancePageState {
    const id = InstancePageStateRecordType.createId(this.getCurrentPageId().slice("page:".length))
    return this.store.get(id) as InstancePageState
  }

  updateCurrentPageState(partial: Partial<Omit<InstancePageState, "id" | "typeName" | "pageId">>): this {
    this.run(
      () => {
        this.store.put([{ ...this.getCurrentPageState(), ...partial }])
      },
      { history: "ignore" },
    )
    return this
  }

  // ---- shapes: reading ---------------------------------------------------

  private readonly _allShapes: Computed<UnknownShape[]> = computed("editor.allShapes", () =>
    this.store.query.records("shape").get() as UnknownShape[],
  )

  private readonly _currentPageShapes: Computed<UnknownShape[]> = computed("editor.currentPageShapes", () => {
    const pageId = this.getCurrentPageId()
    return this._allShapes.get().filter((s) => this.getAncestorPageId(s) === pageId)
  })

  private readonly _currentPageShapeIds: Computed<Set<ShapeId>> = computed("editor.currentPageShapeIds", () => {
    return new Set(this._currentPageShapes.get().map((s) => s.id))
  })

  getShape<T extends UnknownShape = UnknownShape>(id: ShapeId | T): T | undefined {
    const shapeId = typeof id === "string" ? id : id.id
    return this.store.get(shapeId) as T | undefined
  }

  getShapeUtil<T extends UnknownShape>(shape: T | T["type"]): ShapeUtil<T> {
    const type = typeof shape === "string" ? shape : shape.type
    const util = this.shapeUtils[type]
    if (!util) throw new Error(`No ShapeUtil registered for type "${type}"`)
    return util as ShapeUtil<T>
  }

  hasShapeUtil(type: string): boolean {
    return type in this.shapeUtils
  }

  getCurrentPageShapes(): UnknownShape[] {
    return this._currentPageShapes.get()
  }

  getCurrentPageShapeIds(): Set<ShapeId> {
    return this._currentPageShapeIds.get()
  }

  getCurrentPageShapesSorted(): UnknownShape[] {
    const result: UnknownShape[] = []
    const visit = (parentId: ParentId): void => {
      for (const child of this.getSortedChildIdsForParent(parentId)) {
        const shape = this.getShape(child)
        if (!shape) continue
        result.push(shape)
        visit(shape.id)
      }
    }
    visit(this.getCurrentPageId())
    return result
  }

  getPageShapeIds(pageId: PageId): ShapeId[] {
    return this._allShapes
      .get()
      .filter((s) => this.getAncestorPageId(s) === pageId)
      .map((s) => s.id)
  }

  getAncestorPageId(shape: UnknownShape | ShapeId | undefined): PageId | undefined {
    let cur = typeof shape === "string" ? this.getShape(shape) : shape
    let guard = 0
    while (cur && guard++ < 1000) {
      if (isPageId(cur.parentId)) return cur.parentId
      cur = this.getShape(cur.parentId)
    }
    return undefined
  }

  getShapeParent(shape: UnknownShape | ShapeId): UnknownShape | undefined {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    if (!s || isPageId(s.parentId)) return undefined
    return this.getShape(s.parentId)
  }

  getSortedChildIdsForParent(parentId: ParentId): ShapeId[] {
    const children = this._allShapes.get().filter((s) => s.parentId === parentId)
    return sortByIndex(children).map((s) => s.id)
  }

  getHighestIndexForParent(parentId: ParentId): IndexKey {
    const children = this._allShapes.get().filter((s) => s.parentId === parentId)
    if (children.length === 0) return ZERO_INDEX_KEY
    return getIndexAbove(sortByIndex(children).at(-1)!.index)
  }

  getShapeGeometry<G extends Geometry2d = Geometry2d>(shape: UnknownShape | ShapeId): G {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    if (!s) throw new Error(`Shape not found`)
    return this.getShapeUtil(s).getGeometry(s) as G
  }

  /** Local → parent transform components. */
  getShapeLocalTransform(shape: UnknownShape): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const c = Math.cos(shape.rotation)
    const s = Math.sin(shape.rotation)
    return { a: c, b: s, c: -s, d: c, e: shape.x, f: shape.y }
  }

  getShapeParentTransform(shape: UnknownShape): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const parent = this.getShapeParent(shape)
    return parent ? this.getShapePageTransform(parent) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  }

  getShapePageTransform(shape: UnknownShape | ShapeId): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    if (!s) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    const p = this.getShapeParentTransform(s)
    const l = this.getShapeLocalTransform(s)
    return {
      a: p.a * l.a + p.c * l.b,
      b: p.b * l.a + p.d * l.b,
      c: p.a * l.c + p.c * l.d,
      d: p.b * l.c + p.d * l.d,
      e: p.a * l.e + p.c * l.f + p.e,
      f: p.b * l.e + p.d * l.f + p.f,
    }
  }

  getShapePageBounds(shape: UnknownShape | ShapeId): Box | undefined {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    if (!s) return undefined
    const m = this.getShapePageTransform(s)
    const b = this.getShapeGeometry(s).bounds
    return Box.FromPoints(b.corners.map((c) => new Vec(m.a * c.x + m.c * c.y + m.e, m.b * c.x + m.d * c.y + m.f)))
  }

  getShapeGeometryBounds(shape: UnknownShape | ShapeId): Box | undefined {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    return s ? this.getShapeGeometry(s).bounds : undefined
  }

  /** Transform a page point into the shape's local space. */
  getPointInShapeSpace(shape: UnknownShape | ShapeId, point: VecLike): Vec {
    const m = this.getShapePageTransform(shape)
    const det = m.a * m.d - m.b * m.c
    if (Math.abs(det) < 1e-12) return new Vec(point.x, point.y)
    const inv = 1 / det
    const a = m.d * inv
    const b = -m.b * inv
    const c = -m.c * inv
    const d = m.a * inv
    const e = -(a * m.e + c * m.f)
    const f = -(b * m.e + d * m.f)
    return new Vec(a * point.x + c * point.y + e, b * point.x + d * point.y + f)
  }

  getPointInParentSpace(shape: UnknownShape | ShapeId, point: VecLike): Vec {
    const s = typeof shape === "string" ? this.getShape(shape) : shape
    if (!s) return new Vec(point.x, point.y)
    const parent = this.getShapeParent(s)
    return parent ? this.getPointInShapeSpace(parent, point) : new Vec(point.x, point.y)
  }

  getShapeParentAtPoint(_point: VecLike): UnknownShape | undefined {
    return undefined
  }

  // ---- engine-backed spatial queries -------------------------------------

  private hitFilterBits(opts: HitTestOptions): number {
    let bits = 0
    if (opts.hitLocked) bits |= 1
    return bits
  }

  getShapeAtPoint(point: VecLike, opts: HitTestOptions = {}): UnknownShape | undefined {
    this.flushEngine()
    const margin = (opts.margin ?? this.options.hitTestMargin) / this.getZoomLevel()
    const bits = this.hitFilterBits(opts) | (opts.hitInside ? 0 : 4)
    if (!opts.filter) {
      const h = this.engine.hitTest(point.x, point.y, margin, bits)
      const id = this.handles.id(h)
      return id ? this.getShape(id as ShapeId) : undefined
    }
    for (const shape of this.getShapesAtPoint(point, opts)) {
      if (opts.filter(shape)) return shape
    }
    return undefined
  }

  /** Shapes under a point, topmost first. */
  getShapesAtPoint(point: VecLike, opts: HitTestOptions = {}): UnknownShape[] {
    this.flushEngine()
    const margin = (opts.margin ?? this.options.hitTestMargin) / this.getZoomLevel()
    const handles = this.engine.queryBox(point.x - margin, point.y - margin, point.x + margin, point.y + margin, 0, this.hitFilterBits(opts))
    const out: UnknownShape[] = []
    for (let i = handles.length - 1; i >= 0; i--) {
      const id = this.handles.id(handles[i]!)
      const shape = id ? this.getShape(id as ShapeId) : undefined
      if (!shape) continue
      if (opts.filter && !opts.filter(shape)) continue
      const local = this.getPointInShapeSpace(shape, point)
      const geo = this.getShapeGeometry(shape)
      if (geo.hitTestPoint(local, margin, opts.hitInside ?? false)) out.push(shape)
    }
    return out
  }

  /** Shapes fully inside a page box, in draw order. */
  getShapesInsideBounds(box: BoxLike, opts: HitTestOptions = {}): UnknownShape[] {
    this.flushEngine()
    const handles = this.engine.queryBox(box.x, box.y, box.x + box.w, box.y + box.h, 1, this.hitFilterBits(opts))
    return this.handlesToShapes(handles, opts.filter)
  }

  /** Shapes whose outline touches a page box, in draw order. */
  getShapesIntersectingBounds(box: BoxLike, opts: HitTestOptions = {}): UnknownShape[] {
    this.flushEngine()
    const handles = this.engine.queryBox(box.x, box.y, box.x + box.w, box.y + box.h, 0, this.hitFilterBits(opts))
    return this.handlesToShapes(handles, opts.filter)
  }

  private handlesToShapes(handles: Uint32Array, filter?: (s: UnknownShape) => boolean): UnknownShape[] {
    const out: UnknownShape[] = []
    for (const h of handles) {
      const id = this.handles.id(h)
      const shape = id ? this.getShape(id as ShapeId) : undefined
      if (shape && (!filter || filter(shape))) out.push(shape)
    }
    return out
  }

  /**
   * Union of every shape's page bounds on the current page, or undefined when
   * the page is empty.
   *
   * Geometry, not ink: this is the union of `getShapePageBounds()` and excludes
   * the half-stroke pad the engine keeps for culling. The pad is per-shape, so
   * including it would both inflate the box and shift its centre whenever the
   * outermost shapes carry different stroke widths.
   */
  getCurrentPageBounds(): Box | undefined {
    this.flushEngine()
    const b = this.engine.allGeometryBounds()
    return b ? Box.FromMinMax(b[0], b[1], b[2], b[3]) : undefined
  }

  // ---- shapes: writing ---------------------------------------------------

  createShape<T extends UnknownShape>(partial: ShapeCreate<T>): this {
    return this.createShapes([partial])
  }

  createShapes<T extends UnknownShape>(partials: readonly ShapeCreate<T>[]): this {
    if (partials.length === 0) return this
    const currentPageId = this.getCurrentPageId()
    const count = this.getCurrentPageShapeIds().size
    if (count + partials.length > this.options.maxShapesPerPage) {
      this.emit("max-shapes", { name: this.getCurrentPage().name, pageId: currentPageId, count })
      // Still allow creation; the limit is advisory in mocanvas.
    }
    this.run(() => {
      const records: UnknownShape[] = []
      const indexCache = new Map<ParentId, IndexKey>()
      for (const partial of partials) {
        const util = this.getShapeUtil<T>(partial.type)
        const parentId = (partial.parentId ?? currentPageId) as ParentId
        let index = partial.index as IndexKey | undefined
        if (!index) {
          const prev = indexCache.get(parentId) ?? this.getHighestIndexForParent(parentId)
          index = indexCache.has(parentId) ? getIndexAbove(prev) : prev
          indexCache.set(parentId, index)
        }
        const props: Record<string, unknown> = { ...(util.getDefaultProps() as Record<string, unknown>) }
        // Styles remembered for the next shape, unless the caller sets them explicitly.
        const styles = this.getInstanceState().stylesForNextShape
        for (const [key, style] of this.getStylePropsForType(partial.type)) {
          if (style.id in styles) props[key] = styles[style.id]
        }
        // An explicitly `undefined` prop must not shadow the util's default,
        // or the new shape would reach the engine missing a prop it declares.
        for (const [key, value] of Object.entries(partial.props ?? {})) {
          if (value !== undefined) props[key] = value
        }
        let shape = ShapeRecordType.create({
          id: partial.id ?? ShapeRecordType.createId(),
          type: partial.type,
          x: partial.x ?? 0,
          y: partial.y ?? 0,
          rotation: partial.rotation ?? 0,
          index,
          parentId,
          isLocked: partial.isLocked ?? false,
          opacity: partial.opacity ?? 1,
          props: props as T["props"],
          meta: { ...(partial.meta ?? {}) },
        }) as T
        const next = util.onBeforeCreate?.(shape)
        if (next) shape = next
        records.push(shape)
      }
      this.store.put(records)
    })
    return this
  }

  updateShape<T extends UnknownShape>(partial: ShapePartial<T> | null | undefined): this {
    return partial ? this.updateShapes([partial]) : this
  }

  updateShapes<T extends UnknownShape>(partials: readonly (ShapePartial<T> | null | undefined)[]): this {
    this.run(() => {
      const records: UnknownShape[] = []
      for (const partial of partials) {
        if (!partial) continue
        const prev = this.getShape<T>(partial.id)
        if (!prev) continue
        const util = this.getShapeUtil<T>(prev)
        let next: T = {
          ...prev,
          ...partial,
          props: partial.props ? { ...prev.props, ...partial.props } : prev.props,
          meta: partial.meta ? { ...prev.meta, ...partial.meta } : prev.meta,
        } as T
        const adjusted = util.onBeforeUpdate?.(prev, next)
        if (adjusted) next = adjusted
        records.push(next)
      }
      if (records.length) this.store.put(records)
    })
    return this
  }

  deleteShape(id: ShapeId | UnknownShape): this {
    return this.deleteShapes([id])
  }

  deleteShapes(ids: readonly (ShapeId | UnknownShape)[]): this {
    const shapeIds = ids.map((s) => (typeof s === "string" ? s : s.id))
    if (shapeIds.length === 0) return this
    const toDelete = new Set<ShapeId>()
    const collect = (id: ShapeId): void => {
      if (toDelete.has(id)) return
      toDelete.add(id)
      for (const child of this.getSortedChildIdsForParent(id)) collect(child)
    }
    for (const id of shapeIds) {
      const shape = this.getShape(id)
      if (shape && !shape.isLocked) collect(id)
    }
    if (toDelete.size === 0) return this
    this.run(() => {
      const ps = this.getCurrentPageState()
      const selected = ps.selectedShapeIds.filter((id) => !toDelete.has(id))
      if (selected.length !== ps.selectedShapeIds.length) this.setSelectedShapes(selected)
      if (ps.hoveredShapeId && toDelete.has(ps.hoveredShapeId)) this.setHoveredShape(null)
      if (ps.editingShapeId && toDelete.has(ps.editingShapeId)) this.setEditingShape(null)
      this.store.remove([...toDelete])
    })
    return this
  }

  reparentShapes(ids: readonly ShapeId[], parentId: ParentId, insertIndex?: IndexKey): this {
    this.run(() => {
      let index = insertIndex ?? this.getHighestIndexForParent(parentId)
      const updates: ShapePartial[] = []
      const parentTransform =
        isShapeId(parentId) ? this.getShapePageTransform(parentId) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
      for (const id of ids) {
        const shape = this.getShape(id)
        if (!shape || shape.parentId === parentId) continue
        const pageXf = this.getShapePageTransform(shape)
        // page position of shape origin → new parent's local space
        const px = pageXf.e
        const py = pageXf.f
        const det = parentTransform.a * parentTransform.d - parentTransform.b * parentTransform.c
        const inv = 1 / (det || 1)
        const lx = (parentTransform.d * (px - parentTransform.e) - parentTransform.c * (py - parentTransform.f)) * inv
        const ly = (-parentTransform.b * (px - parentTransform.e) + parentTransform.a * (py - parentTransform.f)) * inv
        const parentRot = Math.atan2(parentTransform.b, parentTransform.a)
        const pageRot = Math.atan2(pageXf.b, pageXf.a)
        updates.push({ id, type: shape.type, parentId, index, x: lx, y: ly, rotation: pageRot - parentRot })
        index = getIndexAbove(index)
      }
      this.updateShapes(updates)
    })
    return this
  }

  // ---- bindings ----------------------------------------------------------

  private readonly _allBindings: Computed<UnknownBinding[]> = computed("editor.allBindings", () =>
    this.store.query.records("binding").get() as UnknownBinding[],
  )

  getBindingUtil<B extends UnknownBinding>(binding: B | B["type"]): BindingUtil<B> {
    const type = typeof binding === "string" ? binding : binding.type
    const util = this.bindingUtils[type]
    if (!util) throw new Error(`No BindingUtil registered for type "${type}"`)
    return util as BindingUtil<B>
  }

  hasBindingUtil(type: string): boolean {
    return type in this.bindingUtils
  }

  getBinding<B extends UnknownBinding = UnknownBinding>(id: BindingId): B | undefined {
    return this.store.get(id) as B | undefined
  }

  getBindingsFromShape<B extends UnknownBinding = UnknownBinding>(shape: UnknownShape | ShapeId, type?: B["type"]): B[] {
    const id = typeof shape === "string" ? shape : shape.id
    return this._allBindings.get().filter((b) => b.fromId === id && (!type || b.type === type)) as B[]
  }

  getBindingsToShape<B extends UnknownBinding = UnknownBinding>(shape: UnknownShape | ShapeId, type?: B["type"]): B[] {
    const id = typeof shape === "string" ? shape : shape.id
    return this._allBindings.get().filter((b) => b.toId === id && (!type || b.type === type)) as B[]
  }

  getBindingsInvolvingShape<B extends UnknownBinding = UnknownBinding>(shape: UnknownShape | ShapeId, type?: B["type"]): B[] {
    const id = typeof shape === "string" ? shape : shape.id
    return this._allBindings.get().filter((b) => (b.fromId === id || b.toId === id) && (!type || b.type === type)) as B[]
  }

  createBinding<B extends UnknownBinding>(partial: BindingCreate<B>): this {
    return this.createBindings([partial])
  }

  createBindings<B extends UnknownBinding>(partials: readonly BindingCreate<B>[]): this {
    if (partials.length === 0) return this
    this.run(() => {
      const records: UnknownBinding[] = []
      for (const partial of partials) {
        const util = this.getBindingUtil<B>(partial.type)
        if (!this.getShape(partial.fromId) || !this.getShape(partial.toId)) continue
        let binding = BindingRecordType.create({
          id: partial.id ?? BindingRecordType.createId(),
          type: partial.type,
          fromId: partial.fromId,
          toId: partial.toId,
          props: { ...util.getDefaultProps(), ...(partial.props ?? {}) },
          meta: { ...(partial.meta ?? {}) } as UnknownBinding["meta"],
        }) as B
        const next = util.onBeforeCreate?.({ binding })
        if (next) binding = next
        records.push(binding)
      }
      this.store.put(records)
    })
    return this
  }

  updateBinding<B extends UnknownBinding>(partial: BindingPartial<B>): this {
    return this.updateBindings([partial])
  }

  updateBindings<B extends UnknownBinding>(partials: readonly BindingPartial<B>[]): this {
    this.run(() => {
      const records: UnknownBinding[] = []
      for (const partial of partials) {
        const prev = this.getBinding<B>(partial.id)
        if (!prev) continue
        let next: B = {
          ...prev,
          ...partial,
          props: partial.props ? { ...prev.props, ...partial.props } : prev.props,
          meta: partial.meta ? { ...prev.meta, ...partial.meta } : prev.meta,
        } as B
        const adjusted = this.getBindingUtil<B>(prev).onBeforeChange?.({ bindingBefore: prev, bindingAfter: next })
        if (adjusted) next = adjusted
        records.push(next)
      }
      if (records.length) this.store.put(records)
    })
    return this
  }

  deleteBinding(id: BindingId | UnknownBinding, opts: { isolateShapes?: boolean } = {}): this {
    return this.deleteBindings([id], opts)
  }

  deleteBindings(ids: readonly (BindingId | UnknownBinding)[], opts: { isolateShapes?: boolean } = {}): this {
    const bindingIds = ids.map((b) => (typeof b === "string" ? b : b.id))
    if (bindingIds.length === 0) return this
    this.run(() => {
      if (opts.isolateShapes) {
        for (const id of bindingIds) {
          const binding = this.getBinding(id)
          if (!binding) continue
          const util = this.getBindingUtil(binding)
          util.onBeforeIsolateFromShape?.({ binding })
          util.onBeforeIsolateToShape?.({ binding })
        }
      }
      this.store.remove(bindingIds.filter((id) => this.store.has(id)))
    })
    return this
  }

  /** Store side effects that keep bindings consistent with their shapes. */
  private registerBindingSideEffects(): void {
    const se = this.store.sideEffects
    this.disposables.push(
      se.registerAfterCreateHandler("binding", (record) => {
        if (!isBinding(record) || !this.hasBindingUtil(record.type)) return
        this.getBindingUtil(record).onAfterCreate?.({ binding: record })
      }),
      se.registerAfterChangeHandler("binding", (prev, next) => {
        if (!isBinding(next) || !isBinding(prev) || !this.hasBindingUtil(next.type)) return
        this.getBindingUtil(next).onAfterChange?.({ bindingBefore: prev, bindingAfter: next })
      }),
      se.registerBeforeDeleteHandler("binding", (record) => {
        if (!isBinding(record) || !this.hasBindingUtil(record.type)) return
        this.getBindingUtil(record).onBeforeDelete?.({ binding: record })
      }),
      se.registerAfterDeleteHandler("binding", (record) => {
        if (!isBinding(record) || !this.hasBindingUtil(record.type)) return
        this.getBindingUtil(record).onAfterDelete?.({ binding: record })
      }),
      se.registerAfterChangeHandler("shape", (prev, next) => {
        if (prev.typeName !== "shape" || next.typeName !== "shape") return
        if (this._allBindings.get().length === 0) return
        for (const binding of this.getBindingsInvolvingShape(next.id)) {
          if (!this.hasBindingUtil(binding.type)) continue
          const util = this.getBindingUtil(binding)
          if (binding.fromId === next.id) util.onAfterChangeFromShape?.({ binding, shapeBefore: prev, shapeAfter: next, reason: "self" })
          if (binding.toId === next.id) util.onAfterChangeToShape?.({ binding, shapeBefore: prev, shapeAfter: next, reason: "self" })
        }
      }),
      se.registerBeforeDeleteHandler("shape", (record) => {
        if (record.typeName !== "shape") return
        const bindings = this.getBindingsInvolvingShape(record.id)
        if (bindings.length === 0) return
        for (const binding of bindings) {
          if (!this.hasBindingUtil(binding.type)) continue
          const util = this.getBindingUtil(binding)
          if (binding.fromId === record.id) util.onBeforeDeleteFromShape?.({ binding, shape: record })
          if (binding.toId === record.id) util.onBeforeDeleteToShape?.({ binding, shape: record })
        }
        this.store.remove(bindings.map((b) => b.id).filter((id) => this.store.has(id)))
      }),
    )
  }

  /** Duplicate shapes (and their descendants) with new ids, offset by `offset` in page space. Returns the new top-level ids. */
  duplicateShapes(ids: readonly ShapeId[] = this.getSelectedShapeIds(), offset: VecLike = { x: 20, y: 20 }): ShapeId[] {
    if (ids.length === 0) return []
    const idMap = new Map<ShapeId, ShapeId>()
    const collect = (id: ShapeId): void => {
      if (idMap.has(id)) return
      idMap.set(id, ShapeRecordType.createId() as ShapeId)
      for (const c of this.getSortedChildIdsForParent(id)) collect(c)
    }
    for (const id of ids) collect(id)
    const topLevel = new Set(ids)
    const creates: ShapeCreate[] = []
    // Preserve draw order.
    for (const shape of this.getCurrentPageShapesSorted()) {
      const newId = idMap.get(shape.id)
      if (!newId) continue
      const parentId = isShapeId(shape.parentId) && idMap.has(shape.parentId) ? idMap.get(shape.parentId)! : shape.parentId
      const isTop = topLevel.has(shape.id) || !idMap.has(shape.parentId as ShapeId)
      creates.push({
        ...shape,
        id: newId,
        parentId,
        x: shape.x + (isTop ? offset.x : 0),
        y: shape.y + (isTop ? offset.y : 0),
        index: undefined as unknown as IndexKey,
        props: { ...shape.props },
        meta: { ...shape.meta },
      })
    }
    this.run(() => {
      this.createShapes(creates)
      // Copy bindings between duplicated shapes.
      const bindingCreates: BindingCreate[] = []
      for (const b of this._allBindings.get()) {
        const from = idMap.get(b.fromId)
        const to = idMap.get(b.toId)
        if (from && to) bindingCreates.push({ type: b.type, fromId: from, toId: to, props: { ...b.props }, meta: { ...b.meta } })
      }
      if (bindingCreates.length) this.createBindings(bindingCreates)
    })
    return ids.map((id) => idMap.get(id)!)
  }

  /** Serializable content for the clipboard: shapes (with descendants) and bindings between them. */
  getContentFromCurrentPage(ids: readonly ShapeId[]): { shapes: UnknownShape[]; bindings: UnknownBinding[] } | undefined {
    if (ids.length === 0) return undefined
    const set = new Set<ShapeId>()
    const collect = (id: ShapeId): void => {
      if (set.has(id)) return
      set.add(id)
      for (const c of this.getSortedChildIdsForParent(id)) collect(c)
    }
    for (const id of ids) collect(id)
    const shapes = this.getCurrentPageShapesSorted().filter((s) => set.has(s.id))
    const bindings = this._allBindings.get().filter((b) => set.has(b.fromId) && set.has(b.toId))
    return { shapes, bindings }
  }

  /** Insert clipboard content at a page point (centered), with fresh ids. Returns the new ids. */
  putContentOntoCurrentPage(content: { shapes: UnknownShape[]; bindings?: UnknownBinding[] }, opts: { point?: VecLike; select?: boolean } = {}): ShapeId[] {
    const { shapes } = content
    if (shapes.length === 0) return []
    const idMap = new Map<ShapeId, ShapeId>()
    for (const s of shapes) idMap.set(s.id, ShapeRecordType.createId() as ShapeId)
    const pageId = this.getCurrentPageId()
    const tops = shapes.filter((s) => !idMap.has(s.parentId as ShapeId))
    let offset = new Vec(0, 0)
    if (opts.point) {
      // Center the content's top-level bounds on the point.
      const boxes = tops.map((s) => {
        const util = this.shapeUtils[s.type]
        const b = util ? util.getGeometry(s).bounds : new Box(0, 0, 0, 0)
        return new Box(s.x + b.x, s.y + b.y, b.w, b.h)
      })
      const common = Box.Common(boxes)
      offset = Vec.Sub(opts.point, common.center)
    }
    const creates: ShapeCreate[] = shapes.map((s) => {
      const isTop = !idMap.has(s.parentId as ShapeId)
      return {
        ...s,
        id: idMap.get(s.id)!,
        parentId: isTop ? pageId : idMap.get(s.parentId as ShapeId)!,
        x: s.x + (isTop ? offset.x : 0),
        y: s.y + (isTop ? offset.y : 0),
        index: undefined as unknown as IndexKey,
        props: { ...s.props },
        meta: { ...s.meta },
      }
    })
    this.run(() => {
      this.createShapes(creates.filter((c) => this.hasShapeUtil(c.type)))
      const bindingCreates: BindingCreate[] = []
      for (const b of content.bindings ?? []) {
        const from = idMap.get(b.fromId)
        const to = idMap.get(b.toId)
        if (from && to && this.hasBindingUtil(b.type)) bindingCreates.push({ type: b.type, fromId: from, toId: to, props: { ...b.props }, meta: { ...b.meta } })
      }
      if (bindingCreates.length) this.createBindings(bindingCreates)
      if (opts.select ?? true) this.setSelectedShapes(tops.map((s) => idMap.get(s.id)!))
    })
    return tops.map((s) => idMap.get(s.id)!)
  }

  // ---- styles ------------------------------------------------------------

  private readonly stylePropCache = new Map<string, Map<string, StyleProp<unknown>>>()

  /** Style props declared by the ShapeUtil for a type, keyed by prop name. */
  getStylePropsForType(type: string): Map<string, StyleProp<unknown>> {
    let m = this.stylePropCache.get(type)
    if (!m) {
      const ctor = this.shapeUtils[type]?.constructor as ShapeUtilConstructor | undefined
      m = getStylePropsOf(ctor?.props)
      this.stylePropCache.set(type, m)
    }
    return m
  }

  getStyleForNextShape<T>(style: StyleProp<T>): T {
    const v = this.getInstanceState().stylesForNextShape[style.id]
    return v === undefined ? style.defaultValue : (v as T)
  }

  setStyleForNextShapes<T>(style: StyleProp<T>, value: T): this {
    const styles = this.getInstanceState().stylesForNextShape
    if (styles[style.id] === value) return this
    return this.updateInstanceState({ stylesForNextShape: { ...styles, [style.id]: value } })
  }

  /** Set a style on every selected shape that declares it. */
  setStyleForSelectedShapes<T>(style: StyleProp<T>, value: T): this {
    const updates: ShapePartial[] = []
    for (const shape of this.getSelectedShapes()) {
      for (const [key, sp] of this.getStylePropsForType(shape.type)) {
        if (sp !== style) continue
        if ((shape.props as Record<string, unknown>)[key] === value) continue
        updates.push({ id: shape.id, type: shape.type, props: { [key]: value } })
      }
    }
    if (updates.length) this.updateShapes(updates)
    return this
  }

  /** Styles of the selection (or of the next shape when nothing is selected). */
  getSharedStyles(): SharedStyleMap {
    const map = new SharedStyleMap()
    const selected = this.getSelectedShapes()
    if (selected.length === 0) {
      const styles = this.getInstanceState().stylesForNextShape
      const seen = new Set<StyleProp<unknown>>()
      for (const type of Object.keys(this.shapeUtils)) {
        for (const sp of this.getStylePropsForType(type).values()) {
          if (seen.has(sp)) continue
          seen.add(sp)
          map.applyValue(sp, styles[sp.id] ?? sp.defaultValue)
        }
      }
      return map
    }
    for (const shape of selected) {
      for (const [key, sp] of this.getStylePropsForType(shape.type)) {
        map.applyValue(sp, (shape.props as Record<string, unknown>)[key])
      }
    }
    return map
  }

  // ---- bulk transforms ---------------------------------------------------

  /** Move shapes by a page-space offset. */
  nudgeShapes(ids: readonly ShapeId[], offset: VecLike): this {
    const updates: ShapePartial[] = []
    for (const id of ids) {
      const shape = this.getShape(id)
      if (!shape || shape.isLocked) continue
      const parent = this.getShapeParent(shape)
      let d = new Vec(offset.x, offset.y)
      if (parent) {
        const m = this.getShapePageTransform(parent)
        const det = m.a * m.d - m.b * m.c || 1
        d = new Vec((m.d * d.x - m.c * d.y) / det, (-m.b * d.x + m.a * d.y) / det)
      }
      updates.push({ id, type: shape.type, x: shape.x + d.x, y: shape.y + d.y })
    }
    return this.updateShapes(updates)
  }

  /** Rotate shapes by `delta` radians around the center of their common page bounds. */
  rotateShapesBy(ids: readonly ShapeId[], delta: number, center?: VecLike): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length === 0) return this
    const boxes = shapes.map((s) => this.getShapePageBounds(s)).filter((b): b is Box => !!b)
    const c = center ?? Box.Common(boxes).center
    const updates: ShapePartial[] = []
    for (const shape of shapes) {
      const m = this.getShapePageTransform(shape)
      const newPagePos = Vec.RotWith(new Vec(m.e, m.f), c, delta)
      const parentPoint = this.getPointInParentSpace(shape, newPagePos)
      updates.push({ id: shape.id, type: shape.type, x: parentPoint.x, y: parentPoint.y, rotation: shape.rotation + delta })
    }
    return this.updateShapes(updates)
  }

  /** Mirror shapes across the center of their common bounds. Positions flip; geometry is not mirrored. */
  flipShapes(ids: readonly ShapeId[], operation: "horizontal" | "vertical"): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length < 1) return this
    const boxes = shapes.map((s) => this.getShapePageBounds(s)!)
    const common = Box.Common(boxes)
    const updates: ShapePartial[] = []
    shapes.forEach((shape, i) => {
      const b = boxes[i]!
      const nb =
        operation === "horizontal"
          ? new Box(common.maxX - (b.maxX - common.x), b.y, b.w, b.h)
          : new Box(b.x, common.maxY - (b.maxY - common.y), b.w, b.h)
      const d = new Vec(nb.x - b.x, nb.y - b.y)
      const m = this.getShapePageTransform(shape)
      const parentPoint = this.getPointInParentSpace(shape, new Vec(m.e + d.x, m.f + d.y))
      updates.push({ id: shape.id, type: shape.type, x: parentPoint.x, y: parentPoint.y })
    })
    return this.updateShapes(updates)
  }

  /** Align shapes along an edge or center of their common bounds. */
  alignShapes(ids: readonly ShapeId[], operation: "left" | "center-horizontal" | "right" | "top" | "center-vertical" | "bottom"): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length < 2) return this
    const boxes = shapes.map((s) => this.getShapePageBounds(s)!)
    const common = Box.Common(boxes)
    const updates: ShapePartial[] = []
    shapes.forEach((shape, i) => {
      const b = boxes[i]!
      let d = new Vec()
      switch (operation) {
        case "left":
          d = new Vec(common.x - b.x, 0)
          break
        case "center-horizontal":
          d = new Vec(common.center.x - b.center.x, 0)
          break
        case "right":
          d = new Vec(common.maxX - b.maxX, 0)
          break
        case "top":
          d = new Vec(0, common.y - b.y)
          break
        case "center-vertical":
          d = new Vec(0, common.center.y - b.center.y)
          break
        case "bottom":
          d = new Vec(0, common.maxY - b.maxY)
          break
      }
      if (d.x === 0 && d.y === 0) return
      const m = this.getShapePageTransform(shape)
      const parentPoint = this.getPointInParentSpace(shape, new Vec(m.e + d.x, m.f + d.y))
      updates.push({ id: shape.id, type: shape.type, x: parentPoint.x, y: parentPoint.y })
    })
    return this.updateShapes(updates)
  }

  /** Space shapes evenly between the first and last along an axis. */
  distributeShapes(ids: readonly ShapeId[], operation: "horizontal" | "vertical"): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length < 3) return this
    const items = shapes.map((s) => ({ shape: s, b: this.getShapePageBounds(s)! }))
    const horizontal = operation === "horizontal"
    items.sort((a, b) => (horizontal ? a.b.center.x - b.b.center.x : a.b.center.y - b.b.center.y))
    const first = items[0]!
    const last = items.at(-1)!
    const span = horizontal ? last.b.x - (first.b.maxX) : last.b.y - first.b.maxY
    const inner = items.slice(1, -1)
    const totalInner = inner.reduce((acc, i) => acc + (horizontal ? i.b.w : i.b.h), 0)
    const gap = (span - totalInner) / (inner.length + 1)
    let cursor = horizontal ? first.b.maxX + gap : first.b.maxY + gap
    const updates: ShapePartial[] = []
    for (const it of inner) {
      const d = horizontal ? new Vec(cursor - it.b.x, 0) : new Vec(0, cursor - it.b.y)
      cursor += (horizontal ? it.b.w : it.b.h) + gap
      const m = this.getShapePageTransform(it.shape)
      const parentPoint = this.getPointInParentSpace(it.shape, new Vec(m.e + d.x, m.f + d.y))
      updates.push({ id: it.shape.id, type: it.shape.type, x: parentPoint.x, y: parentPoint.y })
    }
    return this.updateShapes(updates)
  }

  /** Stack shapes edge to edge with a fixed gap along an axis (order by current position). */
  stackShapes(ids: readonly ShapeId[], operation: "horizontal" | "vertical", gap = 16): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length < 2) return this
    const items = shapes.map((s) => ({ shape: s, b: this.getShapePageBounds(s)! }))
    const horizontal = operation === "horizontal"
    items.sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y))
    let cursor = horizontal ? items[0]!.b.maxX + gap : items[0]!.b.maxY + gap
    const updates: ShapePartial[] = []
    for (const it of items.slice(1)) {
      const d = horizontal ? new Vec(cursor - it.b.x, 0) : new Vec(0, cursor - it.b.y)
      cursor += (horizontal ? it.b.w : it.b.h) + gap
      const m = this.getShapePageTransform(it.shape)
      const parentPoint = this.getPointInParentSpace(it.shape, new Vec(m.e + d.x, m.f + d.y))
      updates.push({ id: it.shape.id, type: it.shape.type, x: parentPoint.x, y: parentPoint.y })
    }
    return this.updateShapes(updates)
  }

  /** Toggle the locked state of shapes. */
  toggleLock(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s)
    if (shapes.length === 0) return this
    const allLocked = shapes.every((s) => s.isLocked)
    return this.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, isLocked: !allLocked })))
  }

  // ---- groups ------------------------------------------------------------

  /** Wrap shapes in a new `group` shape (requires a registered "group" ShapeUtil). Returns the group id. */
  groupShapes(ids: readonly ShapeId[] = this.getSelectedShapeIds(), groupId: ShapeId = ShapeRecordType.createId() as ShapeId): ShapeId | undefined {
    if (!this.hasShapeUtil("group")) throw new Error("No ShapeUtil registered for type \"group\"")
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && !s.isLocked)
    if (shapes.length < 2) return undefined
    const parentId = shapes[0]!.parentId
    if (!shapes.every((s) => s.parentId === parentId)) return undefined
    const sorted = sortByIndex(shapes)
    const bounds = Box.Common(sorted.map((s) => this.getShapePageBounds(s)!))
    this.run(() => {
      this.createShape({ id: groupId, type: "group", parentId, x: bounds.x, y: bounds.y, index: getIndexAbove(sorted.at(-1)!.index) })
      this.reparentShapes(sorted.map((s) => s.id), groupId)
      this.setSelectedShapes([groupId])
    })
    return groupId
  }

  /** Dissolve groups, re-parenting their children to the group's parent. */
  ungroupShapes(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    const groups = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s && s.type === "group")
    if (groups.length === 0) return this
    this.run(() => {
      const released: ShapeId[] = []
      for (const g of groups) {
        const children = this.getSortedChildIdsForParent(g.id)
        this.reparentShapes(children, g.parentId, getIndexAbove(g.index))
        released.push(...children)
        this.store.remove([g.id])
      }
      this.setSelectedShapes(released)
    })
    return this
  }

  /** The outermost group containing a shape, or undefined. */
  getOutermostSelectableShape(shape: UnknownShape | ShapeId): UnknownShape | undefined {
    let cur = typeof shape === "string" ? this.getShape(shape) : shape
    if (!cur) return undefined
    let result = cur
    const focused = this.getCurrentPageState().focusedGroupId
    while (cur && isShapeId(cur.parentId)) {
      const parent: UnknownShape | undefined = this.getShape(cur.parentId)
      if (!parent || parent.id === focused) break
      if (parent.type === "group") result = parent
      cur = parent
    }
    return result
  }

  // ---- z-order -----------------------------------------------------------

  bringToFront(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    return this.reorder(ids, "toFront")
  }
  sendToBack(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    return this.reorder(ids, "toBack")
  }
  bringForward(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    return this.reorder(ids, "forward")
  }
  sendBackward(ids: readonly ShapeId[] = this.getSelectedShapeIds()): this {
    return this.reorder(ids, "backward")
  }

  private reorder(ids: readonly ShapeId[], op: "toFront" | "toBack" | "forward" | "backward"): this {
    if (ids.length === 0) return this
    const set = new Set(ids)
    const byParent = new Map<ParentId, UnknownShape[]>()
    for (const id of ids) {
      const s = this.getShape(id)
      if (!s) continue
      const arr = byParent.get(s.parentId) ?? []
      arr.push(s)
      byParent.set(s.parentId, arr)
    }
    const updates: ShapePartial[] = []
    for (const [parentId, moving] of byParent) {
      const siblings = sortByIndex(this._allShapes.get().filter((s) => s.parentId === parentId))
      const movingSorted = sortByIndex(moving)
      const others = siblings.filter((s) => !set.has(s.id))
      let indices: IndexKey[]
      switch (op) {
        case "toFront": {
          indices = getIndicesAbove(others.at(-1)?.index, movingSorted.length)
          break
        }
        case "toBack": {
          const first = others[0]?.index
          indices = []
          let cur = first
          for (let i = 0; i < movingSorted.length; i++) {
            cur = getIndexBelow(cur)
            indices.unshift(cur)
          }
          break
        }
        case "forward": {
          const topMovingIdx = siblings.findIndex((s) => s.id === movingSorted.at(-1)!.id)
          const above = siblings.slice(topMovingIdx + 1).find((s) => !set.has(s.id))
          if (!above) return this
          const aboveAbove = siblings[siblings.indexOf(above) + 1]
          indices = movingSorted.map(() => "" as IndexKey)
          let below = above.index
          for (let i = 0; i < movingSorted.length; i++) {
            const idx = getIndexBetween(below, aboveAbove?.index)
            indices[i] = idx
            below = idx
          }
          break
        }
        case "backward": {
          const bottomMovingIdx = siblings.findIndex((s) => s.id === movingSorted[0]!.id)
          const below = siblings
            .slice(0, bottomMovingIdx)
            .reverse()
            .find((s) => !set.has(s.id))
          if (!below) return this
          const belowBelow = siblings[siblings.indexOf(below) - 1]
          indices = movingSorted.map(() => "" as IndexKey)
          let above = below.index
          for (let i = movingSorted.length - 1; i >= 0; i--) {
            const idx = getIndexBetween(belowBelow?.index, above)
            indices[i] = idx
            above = idx
          }
          break
        }
      }
      movingSorted.forEach((s, i) => updates.push({ id: s.id, type: s.type, index: indices[i]! }))
    }
    this.updateShapes(updates)
    return this
  }

  // ---- selection ---------------------------------------------------------

  getSelectedShapeIds(): ShapeId[] {
    return this.getCurrentPageState().selectedShapeIds
  }

  getSelectedShapes(): UnknownShape[] {
    return this.getSelectedShapeIds().map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s)
  }

  getOnlySelectedShape(): UnknownShape | undefined {
    const ids = this.getSelectedShapeIds()
    return ids.length === 1 ? this.getShape(ids[0]!) : undefined
  }

  setSelectedShapes(ids: readonly (ShapeId | UnknownShape)[]): this {
    const next = ids.map((s) => (typeof s === "string" ? s : s.id))
    const prev = this.getSelectedShapeIds()
    if (prev.length === next.length && prev.every((id, i) => id === next[i])) return this
    this.updateCurrentPageState({ selectedShapeIds: next })
    return this
  }

  select(...ids: (ShapeId | UnknownShape)[]): this {
    return this.setSelectedShapes(ids)
  }

  selectAll(): this {
    return this.setSelectedShapes(this.getSortedChildIdsForParent(this.getCurrentPageId()).filter((id) => !this.getShape(id)?.isLocked))
  }

  selectNone(): this {
    return this.setSelectedShapes([])
  }

  isShapeOrAncestorLocked(shape: UnknownShape | ShapeId): boolean {
    let cur = typeof shape === "string" ? this.getShape(shape) : shape
    while (cur) {
      if (cur.isLocked) return true
      cur = this.getShapeParent(cur)
    }
    return false
  }

  private readonly _selectionPageBounds: Computed<Box | undefined> = computed("editor.selectionPageBounds", () => {
    const shapes = this.getSelectedShapes()
    if (shapes.length === 0) return undefined
    const boxes = shapes.map((s) => this.getShapePageBounds(s)).filter((b): b is Box => !!b)
    return boxes.length ? Box.Common(boxes) : undefined
  })

  getSelectionPageBounds(): Box | undefined {
    return this._selectionPageBounds.get()
  }

  getSelectionRotation(): number {
    const shapes = this.getSelectedShapes()
    if (shapes.length !== 1) return 0
    const m = this.getShapePageTransform(shapes[0]!)
    return Math.atan2(m.b, m.a)
  }

  getHoveredShapeId(): ShapeId | null {
    return this.getCurrentPageState().hoveredShapeId
  }

  getHoveredShape(): UnknownShape | undefined {
    const id = this.getHoveredShapeId()
    return id ? this.getShape(id) : undefined
  }

  setHoveredShape(id: ShapeId | UnknownShape | null): this {
    const next = id === null ? null : typeof id === "string" ? id : id.id
    if (this.getHoveredShapeId() === next) return this
    return this.updateCurrentPageState({ hoveredShapeId: next })
  }

  getEditingShapeId(): ShapeId | null {
    return this.getCurrentPageState().editingShapeId
  }

  getEditingShape(): UnknownShape | undefined {
    const id = this.getEditingShapeId()
    return id ? this.getShape(id) : undefined
  }

  setEditingShape(id: ShapeId | UnknownShape | null): this {
    const next = id === null ? null : typeof id === "string" ? id : id.id
    const prev = this.getEditingShapeId()
    if (prev === next) return this
    this.updateCurrentPageState({ editingShapeId: next })
    // Editing toggles overlay rendering for the shape.
    for (const sid of [prev, next]) {
      const shape = sid ? this.getShape(sid) : undefined
      if (shape) this.writeShapeToEngine(shape, true)
    }
    this.flushEngine()
    this.bumpFrame()
    if (prev) {
      const shape = this.getShape(prev)
      if (shape) this.getShapeUtil(shape).onEditEnd?.(shape)
    }
    return this
  }

  setErasingShapes(ids: readonly ShapeId[]): this {
    return this.updateCurrentPageState({ erasingShapeIds: [...ids] })
  }

  getErasingShapeIds(): ShapeId[] {
    return this.getCurrentPageState().erasingShapeIds
  }

  // ---- camera / viewport -------------------------------------------------

  private cameraId(): Camera["id"] {
    return CameraRecordType.createId(this.getCurrentPageId().slice("page:".length))
  }

  getCamera(): Camera {
    return this.store.get(this.cameraId()) as Camera
  }

  getZoomLevel(): number {
    return this.getCamera().z
  }

  setCamera(point: Partial<VecModel>, _opts: { animation?: { duration: number } } = {}): this {
    const cam = this.getCamera()
    const z = Math.min(this.options.zoomMax, Math.max(this.options.zoomMin, point.z ?? cam.z))
    const x = point.x ?? cam.x
    const y = point.y ?? cam.y
    if (cam.x === x && cam.y === y && cam.z === z) return this
    this.run(
      () => {
        this.store.put([{ ...cam, x, y, z }])
      },
      { history: "ignore" },
    )
    return this
  }

  getViewportScreenBounds(): Box {
    const b = this.getInstanceState().screenBounds
    return new Box(b.x, b.y, b.w, b.h)
  }

  getViewportScreenCenter(): Vec {
    const b = this.getViewportScreenBounds()
    return new Vec(b.w / 2, b.h / 2)
  }

  getViewportPageBounds(): Box {
    const { w, h } = this.getViewportScreenBounds()
    const { x, y, z } = this.getCamera()
    return new Box(-x, -y, w / z, h / z)
  }

  getViewportPageCenter(): Vec {
    return this.getViewportPageBounds().center
  }

  updateViewportScreenBounds(bounds: Box | BoxLike, center = false): this {
    const prev = this.getViewportScreenBounds()
    const next = Box.From(bounds)
    if (prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return this
    this.run(
      () => {
        this.updateInstanceState({ screenBounds: next.toJson() })
        if (center) {
          const cam = this.getCamera()
          this.setCamera({ x: cam.x + (next.w - prev.w) / 2 / cam.z, y: cam.y + (next.h - prev.h) / 2 / cam.z })
        }
      },
      { history: "ignore" },
    )
    return this
  }

  /** Screen (container-relative) → page. */
  screenToPage(point: VecLike): Vec {
    const { x, y, z } = this.getCamera()
    return new Vec(point.x / z - x, point.y / z - y)
  }

  /** Page → screen (container-relative). */
  pageToScreen(point: VecLike): Vec {
    const { x, y, z } = this.getCamera()
    return new Vec((point.x + x) * z, (point.y + y) * z)
  }

  /** Zoom keeping the given screen point fixed. */
  zoomToPointAt(screenPoint: VecLike, nextZoom: number): this {
    const cam = this.getCamera()
    const z = Math.min(this.options.zoomMax, Math.max(this.options.zoomMin, nextZoom))
    const px = screenPoint.x / cam.z - cam.x
    const py = screenPoint.y / cam.z - cam.y
    return this.setCamera({ x: screenPoint.x / z - px, y: screenPoint.y / z - py, z })
  }

  zoomIn(point: VecLike = this.getViewportScreenCenter()): this {
    const z = this.getZoomLevel()
    const next = this.options.zoomSteps.find((s) => s > z + 1e-6) ?? this.options.zoomMax
    return this.zoomToPointAt(point, next)
  }

  zoomOut(point: VecLike = this.getViewportScreenCenter()): this {
    const z = this.getZoomLevel()
    const next = [...this.options.zoomSteps].reverse().find((s) => s < z - 1e-6) ?? this.options.zoomMin
    return this.zoomToPointAt(point, next)
  }

  resetZoom(point: VecLike = this.getViewportScreenCenter()): this {
    return this.zoomToPointAt(point, 1)
  }

  zoomToBounds(bounds: BoxLike, opts: { inset?: number; targetZoom?: number } = {}): this {
    const vp = this.getViewportScreenBounds()
    const inset = opts.inset ?? Math.min(256, vp.w * 0.28)
    let z = Math.min((vp.w - inset) / bounds.w, (vp.h - inset) / bounds.h)
    if (opts.targetZoom !== undefined) z = Math.min(z, opts.targetZoom)
    z = Math.min(this.options.zoomMax, Math.max(this.options.zoomMin, z))
    return this.setCamera({
      x: -bounds.x + (vp.w / z - bounds.w) / 2,
      y: -bounds.y + (vp.h / z - bounds.h) / 2,
      z,
    })
  }

  zoomToFit(): this {
    const b = this.getCurrentPageBounds()
    return b && b.w > 0 && b.h > 0 ? this.zoomToBounds(b) : this
  }

  zoomToSelection(): this {
    const b = this.getSelectionPageBounds()
    return b && b.w > 0 && b.h > 0 ? this.zoomToBounds(b, { targetZoom: Math.max(1, this.getZoomLevel()) }) : this
  }

  centerOnPoint(point: VecLike): this {
    const vp = this.getViewportScreenBounds()
    const z = this.getZoomLevel()
    return this.setCamera({ x: -point.x + vp.w / 2 / z, y: -point.y + vp.h / 2 / z })
  }

  pan(offsetScreen: VecLike): this {
    const cam = this.getCamera()
    return this.setCamera({ x: cam.x + offsetScreen.x / cam.z, y: cam.y + offsetScreen.y / cam.z })
  }

  // ---- tools -------------------------------------------------------------

  getCurrentTool(): StateNode {
    return this.root.getCurrent()!
  }

  getCurrentToolId(): string {
    const tool = this.root.getCurrent()
    return tool?.id ?? ""
  }

  setCurrentTool(id: string, info: Record<string, unknown> = {}): this {
    if (this.getCurrentToolId() === id && !info["force"]) return this
    this.root.transition(id, info)
    return this
  }

  getPath(): string {
    return this.root.getPath()
  }

  isIn(path: string): boolean {
    const full = this.getPath()
    const target = path.startsWith("root.") ? path : `root.${path}`
    return full === target || full.startsWith(`${target}.`)
  }

  isInAny(...paths: string[]): boolean {
    return paths.some((p) => this.isIn(p))
  }

  getStateDescendant<T extends StateNode>(path: string): T | undefined {
    return this.root.getDescendant<T>(path.replace(/^root\./, ""))
  }

  cancel(): this {
    this.dispatch({ type: "cancel", name: "cancel", ...this.modifierState() })
    return this
  }

  complete(): this {
    this.dispatch({ type: "complete", name: "complete", ...this.modifierState() })
    return this
  }

  interrupt(): this {
    this.dispatch({ type: "interrupt", name: "interrupt", ...this.modifierState() })
    return this
  }

  private modifierState(): { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; accelKey: boolean } {
    const i = this.inputs
    return { shiftKey: i.shiftKey, altKey: i.altKey, ctrlKey: i.ctrlKey, metaKey: i.metaKey, accelKey: i.accelKey }
  }

  // ---- input dispatch ----------------------------------------------------

  /** Route an event to the tool tree, updating `inputs` first. */
  dispatch(info: EventInfo): this {
    if (this.getIsDisposed()) return this
    const inputs = this.inputs
    inputs.shiftKey = info.shiftKey
    inputs.altKey = info.altKey
    inputs.ctrlKey = info.ctrlKey
    inputs.metaKey = info.metaKey
    inputs.accelKey = info.accelKey

    switch (info.type) {
      case "pointer": {
        this.updatePointer(info)
        break
      }
      case "click": {
        const screen = new Vec(info.point.x, info.point.y)
        inputs.currentScreenPoint = screen
        inputs.currentPagePoint = this.screenToPage(screen)
        break
      }
      case "keyboard": {
        if (info.name === "key_down") inputs.keys.add(info.code)
        else if (info.name === "key_up") inputs.keys.delete(info.code)
        break
      }
      case "wheel": {
        this.handleWheel(info)
        // tools may still observe wheel
        break
      }
      default:
        break
    }

    this.root.handleEvent(info)
    this.emit("event", info)
    return this
  }

  private updatePointer(info: PointerEventInfo): void {
    const inputs = this.inputs
    const screen = new Vec(info.point.x, info.point.y)
    const page = this.screenToPage(screen)
    inputs.previousScreenPoint = inputs.currentScreenPoint
    inputs.previousPagePoint = inputs.currentPagePoint
    inputs.currentScreenPoint = screen
    inputs.currentPagePoint = page
    inputs.isPen = info.isPen

    switch (info.name) {
      case "pointer_down": {
        inputs.buttons.add(info.button)
        inputs.isPointing = true
        inputs.isDragging = false
        inputs.originScreenPoint = screen.clone()
        inputs.originPagePoint = page.clone()
        break
      }
      case "pointer_move": {
        if (inputs.isPointing && !inputs.isDragging) {
          const d2 = Vec.Dist2(inputs.originScreenPoint, screen)
          if (d2 > this.options.dragDistanceSquared * (info.isPen ? 0.25 : 1)) inputs.isDragging = true
        }
        break
      }
      case "pointer_up": {
        inputs.buttons.delete(info.button)
        inputs.isPointing = false
        inputs.isDragging = false
        break
      }
      default:
        break
    }
  }

  private handleWheel(info: WheelEventInfo): void {
    if (info.ctrlKey || info.metaKey) {
      // zoom about the pointer; delta.y in pixels → multiplicative factor
      const cam = this.getCamera()
      const factor = Math.exp(-info.delta.y * 0.0025)
      this.zoomToPointAt(info.point, cam.z * factor)
    } else {
      this.pan({ x: -info.delta.x, y: -info.delta.y })
    }
  }

  // ---- engine mirror -----------------------------------------------------

  private kindId(type: string): number {
    return this.kindIds.get(type) ?? 0
  }

  /** Apply pending engine commands. Cheap when nothing is pending. */
  flushEngine(): void {
    if (this.engine.cmd.pending > 0) this.engine.cmd.flush()
  }

  private syncChanges(changes: { added: Record<string, EditorRecord>; updated: Record<string, [EditorRecord, EditorRecord]>; removed: Record<string, EditorRecord> }): void {
    const pageId = this.getCurrentPageId()
    if (pageId !== this.syncedPageId) {
      this.syncPage(pageId)
      return
    }
    let dirty = false
    // Binding changes (e.g. undo of a binding alone) affect the geometry of their `from` shape.
    const rebind = new Set<ShapeId>()
    for (const rec of [...Object.values(changes.added), ...Object.values(changes.removed)]) {
      if (isBinding(rec)) rebind.add(rec.fromId)
    }
    for (const [, next] of Object.values(changes.updated)) {
      if (isBinding(next)) rebind.add(next.fromId)
    }
    for (const rec of Object.values(changes.removed)) {
      if (rec.typeName !== "shape") continue
      const h = this.handles.release(rec.id)
      if (h !== undefined) {
        this.engine.cmd.remove(h)
        dirty = true
      }
    }
    for (const rec of Object.values(changes.added)) {
      if (rec.typeName !== "shape") continue
      if (this.getAncestorPageId(rec) !== pageId) continue
      this.writeShapeToEngine(rec, true)
      dirty = true
    }
    for (const [prev, next] of Object.values(changes.updated)) {
      if (next.typeName !== "shape" || prev.typeName !== "shape") continue
      const onPage = this.getAncestorPageId(next) === pageId
      if (!onPage) {
        const h = this.handles.release(next.id)
        if (h !== undefined) {
          this.engine.cmd.remove(h)
          dirty = true
        }
        continue
      }
      const geometryChanged = prev.props !== next.props || prev.type !== next.type || prev.opacity !== next.opacity
      this.writeShapeToEngine(next, geometryChanged || this.handles.peek(next.id) === undefined)
      rebind.delete(next.id)
      dirty = true
    }
    // Groups derive their geometry from their children.
    const touched = [...Object.values(changes.added), ...Object.values(changes.removed), ...Object.values(changes.updated).map(([, n]) => n)]
    for (const rec of touched) {
      if (rec.typeName !== "shape") continue
      let parent: UnknownShape | undefined = isShapeId(rec.parentId) ? this.getShape(rec.parentId) : undefined
      while (parent && parent.type === "group") {
        rebind.add(parent.id)
        parent = isShapeId(parent.parentId) ? this.getShape(parent.parentId) : undefined
      }
    }
    for (const id of rebind) {
      const shape = this.getShape(id)
      if (shape && this.getAncestorPageId(shape) === pageId && !(id in changes.added)) {
        this.writeShapeToEngine(shape, true)
        dirty = true
      }
    }
    if (dirty) {
      this.flushEngine()
      this.bumpFrame()
    }
  }

  /** Clear the engine and upload every shape on `pageId`. */
  private syncPage(pageId: PageId): void {
    this.syncedPageId = pageId
    this.handles.clear()
    this.engine.cmd.clear()
    for (const shape of this.getCurrentPageShapesSorted()) {
      this.writeShapeToEngine(shape, true)
    }
    this.flushEngine()
    this.bumpFrame()
  }

  /**
   * Write one shape to the engine, isolating it from its siblings.
   *
   * A shape util can throw on a shape it does not fully understand (a prop a
   * file left out, a value it did not expect). That must cost that one shape,
   * never the rest of the page: the failure is logged once and the shape is
   * skipped, so a single bad record can no longer blank the canvas.
   */
  private writeShapeToEngine(shape: UnknownShape, withGeometry: boolean): void {
    try {
      this.writeShapeToEngineUnsafe(shape, withGeometry)
      this.brokenShapeIds.delete(shape.id)
    } catch (error) {
      if (!this.brokenShapeIds.has(shape.id)) {
        this.brokenShapeIds.add(shape.id)
        console.warn(`mocanvas: skipping shape ${shape.id} (${shape.type}); its shape util threw`, error)
      }
    }
  }

  private writeShapeToEngineUnsafe(shape: UnknownShape, withGeometry: boolean): void {
    const util = this.shapeUtils[shape.type]
    const h = this.handles.handle(shape.id)
    const parent = isShapeId(shape.parentId) ? this.handles.handle(shape.parentId) : 0
    const [zlo, zhi] = indexKeyToZKey(shape.index)
    let flags = 0
    if (shape.isLocked) flags |= FLAG.LOCKED
    let style: StyleWords | null = null
    let geometry: Geometry2d | undefined
    if (util) {
      // Texture references acquired while deriving the style are attributed to
      // this shape, so re-writing it neither leaks nor drops references.
      style = this.textures.withOwner(shape.id, () => util.getRenderStyle(shape))
      if (style === null || util.needsOverlay(shape)) flags |= FLAG.OVERLAY
      else if (util.hasOverlayLabel(shape)) flags |= FLAG.LABEL
      if (util.isClipShape(shape)) flags |= FLAG.CLIP
      geometry = util.getGeometry(shape)
      if (geometry.isClosed && !geometry.isFilled) flags |= FLAG.NO_FILL
    } else {
      flags |= FLAG.OVERLAY
    }
    const b = geometry?.bounds
    this.engine.cmd.upsert(h, this.kindId(shape.type), parent, zlo, zhi, flags, shape.x, shape.y, shape.rotation, b?.w ?? 0, b?.h ?? 0)
    if (withGeometry && geometry) {
      this.engine.cmd.setGeometry(h, geometry.toPathWords())
      if (style) {
        // The hand-drawn dash style picks a shape's wobble from this seed, so it is
        // hashed (FNV-1a) from the shape's own id rather than taken from its engine
        // handle: handles are recycled, and a shape that was deleted and restored
        // would otherwise come back looking like a different shape.
        let seed = 0x811c9dc5
        for (let k = 0; k < shape.id.length; k++) seed = Math.imul(seed ^ shape.id.charCodeAt(k), 0x01000193)
        this.engine.cmd.setStyle(h, { ...style, opacity: style.opacity * shape.opacity, seed: style.seed ?? seed >>> 0 })
        this.engine.cmd.setTexture(h, style.texture ?? 0)
      }
    }
  }

  // ---- rendering ---------------------------------------------------------

  /** Build and draw one frame. Called by the canvas component inside rAF. */
  renderFrame(backend: RenderBackend): FrameBuffers {
    const t0 = performance.now()
    this.textures.setBackend(backend)
    this.syncTextureResolution()
    this.flushEngine()
    const cam = this.getCamera()
    const vp = this.getViewportScreenBounds()
    const camState: CameraState = { x: cam.x, y: cam.y, z: cam.z }
    const frame = this.engine.frame(camState, vp.w, vp.h)
    backend.draw(frame, camState, { background: this.options.backgroundColor })

    const overlay = EngineBridge.readOverlay(frame.overlay)
    const ids: ShapeId[] = []
    const clips: (ClipRect | undefined)[] = []
    for (const o of overlay) {
      const id = this.handles.id(o.handle)
      if (id) {
        ids.push(id as ShapeId)
        clips.push(o.clip)
      }
    }
    unsafe__withoutCapture(() => {
      const prev = this._overlayShapeIds.get()
      if (prev.length !== ids.length || prev.some((id, i) => id !== ids[i])) this._overlayShapeIds.set(ids)
      if (!sameClips(this._overlayClips.get(), clips)) this._overlayClips.set(clips)
      const ms = performance.now() - t0
      this._lastFrame.set({ drawn: frame.drawn, culled: frame.culled, ms })
      this.emit("frame", { drawn: frame.drawn, culled: frame.culled, ms })
    })
    return frame
  }

  // ---- textures ----------------------------------------------------------

  /**
   * Device-pixel scale at which rasterized textures (text labels) should be
   * drawn: the device pixel ratio times the zoom, bucketed to powers of two.
   */
  getTextureResolution(): number {
    return bucketTextureResolution(this.getZoomLevel(), this.getInstanceState().devicePixelRatio)
  }

  private textureResolution = 0

  /** Re-derive texture-backed styles when the resolution bucket changes. */
  private syncTextureResolution(): void {
    const next = this.getTextureResolution()
    if (next === this.textureResolution) return
    this.textureResolution = next
    this.rewriteTextureOwners(this.textures.getAllOwners())
  }

  private registerTextureSideEffects(): void {
    this.disposables.push(
      this.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
        this.textures.releaseOwner(shape.id)
      }),
    )
  }

  /** A texture finished (or failed) loading: re-write its shapes and redraw. */
  private onTexturesChanged(keys: readonly string[]): void {
    const owners = new Set<string>()
    for (const key of keys) for (const owner of this.textures.getOwners(key)) owners.add(owner)
    this.rewriteTextureOwners(owners)
    this.bumpFrame()
  }

  private rewriteTextureOwners(owners: Iterable<string>): void {
    let dirty = false
    for (const owner of owners) {
      const shape = this.getShape(owner as ShapeId)
      if (!shape || this.getAncestorPageId(shape) !== this.syncedPageId) continue
      this.writeShapeToEngine(shape, true)
      dirty = true
    }
    if (dirty) this.flushEngine()
  }

  // ---- misc helpers ------------------------------------------------------

  /** Degrees → radians. */
  static degToRad(d: number): number {
    return d * RAD_PER_DEG
  }

  // ---- assets ------------------------------------------------------------

  private readonly _allAssets: Computed<Asset[]> = computed("editor.allAssets", () =>
    this.store.query.records("asset").get() as Asset[],
  )

  getAsset<A extends Asset = Asset>(id: AssetId | A): A | undefined {
    const assetId = typeof id === "string" ? id : id.id
    return this.store.get(assetId) as A | undefined
  }

  /** Every asset in the document (assets are not per page). */
  getAssets(): Asset[] {
    return this._allAssets.get()
  }

  createAsset<A extends Asset>(asset: AssetCreate<A>): this {
    return this.createAssets([asset])
  }

  createAssets<A extends Asset>(assets: readonly AssetCreate<A>[]): this {
    if (assets.length === 0) return this
    this.run(() => {
      const records: Asset[] = assets.map(
        (a) =>
          AssetRecordType.create({
            id: a.id ?? AssetRecordType.createId(),
            type: a.type,
            props: { ...a.props },
            meta: { ...(a.meta ?? {}) } as Asset["meta"],
          } as Asset) as Asset,
      )
      this.store.put(records)
    })
    return this
  }

  updateAsset<A extends Asset>(partial: AssetPartial<A>): this {
    return this.updateAssets([partial])
  }

  updateAssets<A extends Asset>(partials: readonly AssetPartial<A>[]): this {
    this.run(() => {
      const records: Asset[] = []
      for (const partial of partials) {
        const prev = this.getAsset<A>(partial.id)
        if (!prev) continue
        records.push({
          ...prev,
          props: partial.props ? { ...prev.props, ...partial.props } : prev.props,
          meta: partial.meta ? { ...prev.meta, ...partial.meta } : prev.meta,
        } as Asset)
      }
      if (records.length) this.store.put(records)
    })
    return this
  }

  deleteAsset(id: AssetId | Asset): this {
    return this.deleteAssets([id])
  }

  deleteAssets(ids: readonly (AssetId | Asset)[]): this {
    const assetIds = ids.map((a) => (typeof a === "string" ? a : a.id)).filter((id) => this.store.has(id))
    if (assetIds.length === 0) return this
    this.run(() => this.store.remove(assetIds))
    return this
  }

  // ---- external content --------------------------------------------------

  // Handlers are keyed by content type, so each entry only ever sees the member
  // of the union it registered for; they are stored under the widest handler type.
  private readonly externalContentHandlers = new Map<ExternalContentType, ExternalContentHandler>()
  private readonly externalAssetHandlers = new Map<ExternalAssetType, ExternalAssetHandler>()

  /**
   * Register the handler for one kind of dropped/pasted content. Replaces any
   * previous handler for that type; `null` removes it. Returns a function that
   * removes the handler again (only if it is still the registered one).
   */
  registerExternalContentHandler<T extends ExternalContentType>(type: T, handler: ExternalContentHandler<T> | null): () => void {
    const entry = handler as unknown as ExternalContentHandler | null
    if (entry) this.externalContentHandlers.set(type, entry)
    else this.externalContentHandlers.delete(type)
    return () => {
      if (entry && this.externalContentHandlers.get(type) === entry) this.externalContentHandlers.delete(type)
    }
  }

  /** Register how an asset record is produced from a file or url. Returns a function that removes it again. */
  registerExternalAssetHandler<T extends ExternalAssetType>(type: T, handler: ExternalAssetHandler<T> | null): () => void {
    const entry = handler as unknown as ExternalAssetHandler | null
    if (entry) this.externalAssetHandlers.set(type, entry)
    else this.externalAssetHandlers.delete(type)
    return () => {
      if (entry && this.externalAssetHandlers.get(type) === entry) this.externalAssetHandlers.delete(type)
    }
  }

  hasExternalContentHandler(type: ExternalContentType): boolean {
    return this.externalContentHandlers.has(type)
  }

  hasExternalAssetHandler(type: ExternalAssetType): boolean {
    return this.externalAssetHandlers.has(type)
  }

  /**
   * Handle content dropped or pasted onto the canvas by dispatching to the
   * registered handler for `info.type`. Resolves once the handler is done;
   * resolves immediately when no handler is registered.
   */
  async putExternalContent(info: ExternalContent): Promise<void> {
    const handler = this.externalContentHandlers.get(info.type)
    if (!handler) return
    await handler(info)
  }

  /**
   * Produce (but do not store) an asset record for a file or url through the
   * registered asset handler. `undefined` when there is no handler or the
   * handler declines the content.
   */
  async getAssetForExternalContent(info: ExternalAssetContent): Promise<Asset | undefined> {
    const handler = this.externalAssetHandlers.get(info.type)
    if (!handler) return undefined
    return await handler(info)
  }

  // ---- presence ----------------------------------------------------------
  // Everything below is about other people in the same document. It is kept in
  // one block so the collaboration layer (`@mocanvas/sync`) has a single seam.

  /**
   * The local person's identity: a random id for this session plus a name and
   * a colour that can be changed at any time. Session-only, never persisted.
   */
  readonly user: UserPreferences = createUserPreferences()

  /** Presence records of everyone else in the room, in arrival order. */
  getCollaborators(): InstancePresence[] {
    const me = this.user.getId()
    const records = this.store.query.records("instance_presence").get()
    return records.filter((p) => p.userId !== me)
  }

  /** The subset of `getCollaborators()` looking at the page we are on. */
  getCollaboratorsOnCurrentPage(): InstancePresence[] {
    const pageId = this.getCurrentPageId()
    return this.getCollaborators().filter((p) => p.currentPageId === pageId)
  }

  // ---- resizing ----------------------------------------------------------

  /**
   * Scale one shape by `scale` about a point, letting its `ShapeUtil.onResize`
   * produce the prop change — the same contract the select tool's resize state
   * uses. The shape's origin is moved by the same scale about `scaleOrigin`
   * (its page bounds center by default), measured in a frame rotated by
   * `scaleAxisRotation`.
   *
   * Locked shapes and shapes whose util says `canResize` is false are left
   * alone. `onResizeStart` / `onResizeEnd` bracket the change; the util is
   * told the resize came from the `bottom_right` handle.
   */
  resizeShape(id: ShapeId | UnknownShape, scale: VecLike, options: ResizeShapeOptions = {}): this {
    const shape = this.getShape(id)
    if (!shape || shape.isLocked) return this
    const util = this.getShapeUtil(shape)
    if (!util.canResize(shape)) return this
    if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return this

    const initialBounds = options.initialBounds ?? this.getShapeGeometryBounds(shape)?.toJson()
    if (!initialBounds) return this

    let scaleX = scale.x
    let scaleY = scale.y
    if (options.isAspectRatioLocked ?? util.isAspectRatioLocked(shape)) {
      const s = Math.max(Math.abs(scaleX), Math.abs(scaleY))
      scaleX = Math.sign(scaleX || 1) * s
      scaleY = Math.sign(scaleY || 1) * s
    }

    const m = this.getShapePageTransform(shape)
    const pagePos = new Vec(m.e, m.f)
    const origin = options.scaleOrigin ?? this.getShapePageBounds(shape)?.center ?? pagePos
    const axis = options.scaleAxisRotation ?? 0
    // Move the origin in the scale frame, then bring it back to page space.
    const inFrame = Vec.Rot(Vec.Sub(pagePos, origin), -axis)
    const scaled = new Vec(inFrame.x * scaleX, inFrame.y * scaleY)
    const newPoint = this.getPointInParentSpace(shape, Vec.Add(origin, Vec.Rot(scaled, axis)))

    this.run(() => {
      util.onResizeStart?.(shape)
      const change = util.onResize?.(shape, {
        newPoint,
        handle: "bottom_right",
        mode: options.mode ?? "scale_shape",
        scaleX,
        scaleY,
        initialBounds,
        initialShape: shape,
      })
      this.updateShapes([{ id: shape.id, type: shape.type, x: newPoint.x, y: newPoint.y, ...(change ?? {}) }])
      const current = this.getShape(shape.id)
      if (current) util.onResizeEnd?.(shape, current)
    })
    return this
  }

  /**
   * Scale several shapes by the same factor about one point — by default the
   * center of their common page bounds, so the group scales as a unit.
   */
  resizeShapes(
    ids: readonly (ShapeId | UnknownShape)[],
    scale: VecLike,
    options: Omit<ResizeShapeOptions, "initialBounds"> = {},
  ): this {
    const shapes = ids.map((id) => this.getShape(id)).filter((s): s is UnknownShape => !!s)
    if (shapes.length === 0) return this
    const boxes = shapes.map((s) => this.getShapePageBounds(s)).filter((b): b is Box => !!b)
    if (boxes.length === 0) return this
    const scaleOrigin = options.scaleOrigin ?? Box.Common(boxes).center
    this.run(() => {
      for (const shape of shapes) this.resizeShape(shape.id, scale, { ...options, scaleOrigin })
    })
    return this
  }

  /**
   * Resize shapes so each one spans the common bounds of all of them on one
   * axis. Every shape given contributes to the common bounds, but only the
   * unlocked, resizable ones are stretched.
   */
  stretchShapes(ids: readonly ShapeId[], operation: "horizontal" | "vertical"): this {
    const items: { shape: UnknownShape; b: Box }[] = []
    for (const id of ids) {
      const shape = this.getShape(id)
      if (!shape) continue
      const b = this.getShapePageBounds(shape)
      if (b) items.push({ shape, b })
    }
    if (items.length < 2) return this
    const common = Box.Common(items.map((it) => it.b))
    const horizontal = operation === "horizontal"
    this.run(() => {
      for (const { shape, b } of items) {
        if (shape.isLocked || !this.getShapeUtil(shape).canResize(shape)) continue
        const scale = horizontal
          ? { x: b.w === 0 ? 1 : common.w / b.w, y: 1 }
          : { x: 1, y: b.h === 0 ? 1 : common.h / b.h }
        this.resizeShape(shape.id, scale, { scaleOrigin: { x: b.x, y: b.y }, isAspectRatioLocked: false })
        // The scale happened about the old top-left corner; slide the shape so
        // its leading edge sits on the common bounds.
        const after = this.getShapePageBounds(shape.id)
        if (!after) continue
        const d = horizontal ? new Vec(common.x - after.x, 0) : new Vec(0, common.y - after.y)
        if (d.x !== 0 || d.y !== 0) this.nudgeShapes([shape.id], d)
      }
    })
    return this
  }

  // ---- export ------------------------------------------------------------
  // The implementations live in `mocanvas` (which depends on this package, not
  // the other way round), so they are installed through a registration seam.

  /**
   * Serialize shapes to an SVG string; `undefined` when there is nothing to
   * export. Defaults to the selection, or the whole page when nothing is
   * selected. Throws until an export implementation is registered.
   */
  getSvgString(ids?: readonly ShapeId[], opts?: EditorSvgExportOptions): EditorSvgExportResult | undefined {
    const impl = exportImplementation
    if (!impl) throw new Error(missingImplementation("getSvgString", "registerExportImplementation"))
    return impl.getSvgString(this, ids, opts)
  }

  /**
   * Render shapes to an image blob (`png` by default). Same shape selection
   * rules as `getSvgString`. Throws until an export implementation is
   * registered.
   */
  async toImage(ids?: readonly ShapeId[], opts?: EditorImageExportOptions): Promise<EditorImageExportResult> {
    const impl = exportImplementation
    if (!impl) throw new Error(missingImplementation("toImage", "registerExportImplementation"))
    return await impl.toImage(this, ids, opts)
  }

  // ---- text measurement --------------------------------------------------

  /**
   * Measures runs of text the way the editor renders them. Installed through
   * the same seam as the export functions; throws until something registers
   * one.
   */
  get textMeasure(): EditorTextMeasure {
    if (!textMeasureProvider) throw new Error(missingImplementation("textMeasure", "registerTextMeasureImplementation"))
    return textMeasureProvider(this)
  }

  // ---- menus -------------------------------------------------------------

  /** Which menus are open right now. Backed by the `instance` session record. */
  readonly menus: MenuManager = new MenuManager(this)
}

function sameClips(a: readonly (ClipRect | undefined)[], b: readonly (ClipRect | undefined)[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (!x || !y) return false
    if (x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2] || x[3] !== y[3]) return false
  }
  return true
}

// ---- resize options ---------------------------------------------------------

export interface ResizeShapeOptions {
  /** Shape-local bounds the scale is measured against. Defaults to the shape's geometry bounds. */
  initialBounds?: { x: number; y: number; w: number; h: number }
  /** Page point that stays put. Defaults to the center of the shape's page bounds. */
  scaleOrigin?: VecLike
  /** Rotation (radians) of the frame the scale axes are measured in. Defaults to 0. */
  scaleAxisRotation?: number
  /** Force (or forbid) a uniform scale. Defaults to the util's `isAspectRatioLocked`. */
  isAspectRatioLocked?: boolean
  /** Handed to `onResize`. Defaults to `"scale_shape"`. */
  mode?: "scale_shape" | "resize_bounds"
}

// ---- registration seams -----------------------------------------------------
// SVG/image export and text measurement are implemented in `mocanvas`, which
// depends on this package. They are installed here at import time so the
// `Editor` methods can stay where callers expect them without inverting the
// dependency.

export interface EditorSvgExportOptions {
  /** Page units added around the shapes' bounds. */
  padding?: number
  /** Paint a full-size background rectangle. */
  background?: boolean
  /** Multiplier applied to the output `width`/`height`. */
  scale?: number
  /** Use the dark background colour. */
  darkMode?: boolean
}

export interface EditorSvgExportResult {
  svg: string
  /** Output size in CSS pixels (bounds × scale). */
  width: number
  height: number
}

export interface EditorImageExportOptions extends EditorSvgExportOptions {
  /** Output format. Implementations default to `"png"`. */
  format?: "svg" | "png" | "jpeg" | "webp"
  /** Encoder quality for lossy formats (0..1). */
  quality?: number
  /** Device pixel ratio multiplier for raster output. */
  pixelRatio?: number
}

export interface EditorImageExportResult {
  blob: Blob
  width: number
  height: number
}

export interface EditorExportImplementation {
  getSvgString(
    editor: Editor,
    ids?: readonly ShapeId[],
    opts?: EditorSvgExportOptions,
  ): EditorSvgExportResult | undefined
  toImage(editor: Editor, ids?: readonly ShapeId[], opts?: EditorImageExportOptions): Promise<EditorImageExportResult>
}

let exportImplementation: EditorExportImplementation | null = null

/**
 * Install the implementation behind `Editor.getSvgString` and `Editor.toImage`.
 * `mocanvas` calls this at import time; pass `null` to remove it. Returns a
 * function that removes the implementation again (only if it is still the
 * registered one).
 */
export function registerExportImplementation(impl: EditorExportImplementation | null): () => void {
  exportImplementation = impl
  return () => {
    if (exportImplementation === impl) exportImplementation = null
  }
}

/** The registered export implementation, or `null` when nothing has registered one. */
export function getExportImplementation(): EditorExportImplementation | null {
  return exportImplementation
}

export interface EditorTextMeasureOptions {
  fontFamily: string
  fontSize: number
  fontWeight?: string | number
  /** Unitless line height (multiplier of the font size). */
  lineHeight: number
  /** Wrap width in CSS px, including `padding`. Omit for a single unwrapped run per paragraph. */
  maxWidth?: number
  /** Padding applied on every side; included in the returned `w`/`h`. */
  padding?: number
}

export interface EditorTextMeasurement {
  w: number
  h: number
  lineCount: number
}

export interface EditorTextMeasure {
  measureText(text: string, opts: EditorTextMeasureOptions): EditorTextMeasurement
}

export type EditorTextMeasureProvider = (editor: Editor) => EditorTextMeasure

let textMeasureProvider: EditorTextMeasureProvider | null = null

/**
 * Install the measurer behind `Editor.textMeasure`. `mocanvas` calls this at
 * import time; pass `null` to remove it. Returns a function that removes the
 * provider again (only if it is still the registered one).
 */
export function registerTextMeasureImplementation(provider: EditorTextMeasureProvider | null): () => void {
  textMeasureProvider = provider
  return () => {
    if (textMeasureProvider === provider) textMeasureProvider = null
  }
}

/** The registered text measure provider, or `null` when nothing has registered one. */
export function getTextMeasureProvider(): EditorTextMeasureProvider | null {
  return textMeasureProvider
}

function missingImplementation(member: string, register: string): string {
  return (
    `Editor.${member} has no implementation registered. Importing \`mocanvas\` installs it — ` +
    `import { Mocanvas } from "@mocanvas/mocanvas" (or "@mocanvas/mocanvas" for its side effect) anywhere in your app. ` +
    `To install your own, call ${register}(...) from "@mocanvas/editor".`
  )
}

// ---- menus ------------------------------------------------------------------

/**
 * The set of menus that are open, kept in the `instance` session record so it
 * survives tool changes, is visible to anything reading the store, and is
 * reactive: reading `getOpenMenus()` inside a signal re-runs it on every change.
 *
 * Ids are opaque strings owned by the UI; nothing here interprets them.
 */
export class MenuManager {
  constructor(private readonly editor: Editor) {}

  /** The open menu ids, in the order they were opened. */
  getOpenMenus(): string[] {
    return [...this.editor.getInstanceState().openMenus]
  }

  isMenuOpen(id: string): boolean {
    return this.editor.getInstanceState().openMenus.includes(id)
  }

  /** Mark a menu as open. Opening an already-open menu changes nothing. */
  addOpenMenu(id: string): this {
    const open = this.editor.getInstanceState().openMenus
    if (open.includes(id)) return this
    this.editor.updateInstanceState({ openMenus: [...open, id] })
    return this
  }

  /** Mark a menu as closed. Closing a menu that is not open changes nothing. */
  removeOpenMenu(id: string): this {
    const open = this.editor.getInstanceState().openMenus
    if (!open.includes(id)) return this
    this.editor.updateInstanceState({ openMenus: open.filter((menu) => menu !== id) })
    return this
  }

  /** Close every open menu. */
  clearOpenMenus(): this {
    if (this.editor.getInstanceState().openMenus.length === 0) return this
    this.editor.updateInstanceState({ openMenus: [] })
    return this
  }
}
