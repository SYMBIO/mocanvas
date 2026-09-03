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
import { EngineBridge, FLAG, type CameraState, type FrameBuffers, type StyleWords } from "@mocanvas/wasm"
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
import { HistoryManager } from "./HistoryManager"

export interface EditorOptions {
  store: EditorStore
  shapeUtils: readonly ShapeUtilConstructor[]
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
  readonly options: EditorConfig
  readonly inputs: EditorInputs
  readonly handles = new HandleTable()
  readonly getContainer: () => HTMLElement
  readonly sideEffects: EditorStore["sideEffects"]

  private readonly kindIds = new Map<string, number>()
  private readonly _frameEpoch: Atom<number>
  private readonly _overlayShapeIds: Atom<readonly ShapeId[]>
  private readonly _isDisposed: Atom<boolean>
  private readonly _lastFrame: Atom<{ drawn: number; culled: number; ms: number }>
  private readonly disposables: (() => void)[] = []
  private syncedPageId: PageId | null = null

  constructor(opts: EditorOptions) {
    super()
    this.store = opts.store
    this.engine = opts.engine
    this.getContainer = opts.getContainer
    this.options = { ...DEFAULT_EDITOR_CONFIG, ...opts.options }
    this.sideEffects = this.store.sideEffects

    this._frameEpoch = atom("editor.frameEpoch", 0)
    this._overlayShapeIds = atom<readonly ShapeId[]>("editor.overlayShapeIds", [])
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

    this.ensureBaseRecords()

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

  getCurrentPageBounds(): Box | undefined {
    this.flushEngine()
    const b = this.engine.allBounds()
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
        const props = { ...util.getDefaultProps(), ...(partial.props ?? {}) }
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
          props,
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
      dirty = true
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

  private writeShapeToEngine(shape: UnknownShape, withGeometry: boolean): void {
    const util = this.shapeUtils[shape.type]
    const h = this.handles.handle(shape.id)
    const parent = isShapeId(shape.parentId) ? this.handles.handle(shape.parentId) : 0
    const [zlo, zhi] = indexKeyToZKey(shape.index)
    let flags = 0
    if (shape.isLocked) flags |= FLAG.LOCKED
    let style: StyleWords | null = null
    let geometry: Geometry2d | undefined
    if (util) {
      style = util.getRenderStyle(shape)
      if (style === null || util.needsOverlay(shape)) flags |= FLAG.OVERLAY
      else if (util.hasOverlayLabel(shape)) flags |= FLAG.LABEL
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
        this.engine.cmd.setStyle(h, { ...style, opacity: style.opacity * shape.opacity })
      }
    }
  }

  // ---- rendering ---------------------------------------------------------

  /** Build and draw one frame. Called by the canvas component inside rAF. */
  renderFrame(backend: RenderBackend): FrameBuffers {
    const t0 = performance.now()
    this.flushEngine()
    const cam = this.getCamera()
    const vp = this.getViewportScreenBounds()
    const camState: CameraState = { x: cam.x, y: cam.y, z: cam.z }
    const frame = this.engine.frame(camState, vp.w, vp.h)
    backend.draw(frame, camState, { background: this.options.backgroundColor })

    const overlay = EngineBridge.readOverlay(frame.overlay)
    const ids: ShapeId[] = []
    for (const o of overlay) {
      const id = this.handles.id(o.handle)
      if (id) ids.push(id as ShapeId)
    }
    unsafe__withoutCapture(() => {
      const prev = this._overlayShapeIds.get()
      if (prev.length !== ids.length || prev.some((id, i) => id !== ids[i])) this._overlayShapeIds.set(ids)
      const ms = performance.now() - t0
      this._lastFrame.set({ drawn: frame.drawn, culled: frame.culled, ms })
      this.emit("frame", { drawn: frame.drawn, culled: frame.culled, ms })
    })
    return frame
  }

  // ---- misc helpers ------------------------------------------------------

  /** Degrees → radians. */
  static degToRad(d: number): number {
    return d * RAD_PER_DEG
  }
}
