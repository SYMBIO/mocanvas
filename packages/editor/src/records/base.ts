import type { IndexKey, RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import type { RegisteredShapeType, ShapePropsForType } from "./props"
import type { UserId } from "../user/userRecord"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface Document {
  readonly id: DocumentId
  readonly typeName: "document"
  gridSize: number
  name: string
  meta: JsonObject
}
export type DocumentId = RecordId<Document>
/** Whether `record` is the document record. Narrows to {@link Document}. */
export function isDocument(record: { typeName?: string } | null | undefined): record is Document {
  return record?.typeName === "document"
}
export const DocumentRecordType = createRecordType<Document>("document", { scope: "document" }).withDefaultProperties(
  () => ({ gridSize: 10, name: "", meta: {} }),
)
export const DOCUMENT_ID = DocumentRecordType.createId("document")

export interface Page {
  readonly id: PageId
  readonly typeName: "page"
  name: string
  index: IndexKey
  meta: JsonObject
}
export type PageId = RecordId<Page>
export const PageRecordType = createRecordType<Page>("page", { scope: "document" }).withDefaultProperties(() => ({
  meta: {},
}))
/** Whether `record` is a page record. Narrows to {@link Page}. */
export function isPage(record: { typeName?: string } | null | undefined): record is Page {
  return record?.typeName === "page"
}

export function isPageId(id: string): id is PageId {
  return id.startsWith("page:")
}

export interface Camera {
  readonly id: CameraId
  readonly typeName: "camera"
  x: number
  y: number
  z: number
  meta: JsonObject
}
export type CameraId = RecordId<Camera>
export const CameraRecordType = createRecordType<Camera>("camera", { scope: "session" }).withDefaultProperties(() => ({
  x: 0,
  y: 0,
  z: 1,
  meta: {},
}))

export interface Instance {
  readonly id: InstanceId
  readonly typeName: "instance"
  currentPageId: PageId
  /** The person whose camera we are mirroring, or `null`. See `Editor.startFollowingUser`. */
  followingUserId: UserId | null
  isFocusMode: boolean
  isDebugMode: boolean
  isToolLocked: boolean
  isGridMode: boolean
  isReadonly: boolean
  isFocused: boolean
  isPenMode: boolean
  isChangingStyle: boolean
  exportBackground: boolean
  screenBounds: { x: number; y: number; w: number; h: number }
  insets: boolean[]
  cursor: { type: string; rotation: number }
  scribbles: Scribble[]
  brush: { x: number; y: number; w: number; h: number } | null
  zoomBrush: { x: number; y: number; w: number; h: number } | null
  openMenus: string[]
  devicePixelRatio: number
  isCoarsePointer: boolean
  isHoveringCanvas: boolean | null
  stylesForNextShape: Record<string, unknown>
  duplicateProps: { shapeIds: string[]; offset: { x: number; y: number } } | null
  meta: JsonObject
}
export type InstanceId = RecordId<Instance>
export interface Scribble {
  id: string
  points: { x: number; y: number; z?: number }[]
  size: number
  color: string
  opacity: number
  state: "starting" | "paused" | "active" | "stopping"
  delay: number
  shrink: number
  taper: boolean
}
export const InstanceRecordType = createRecordType<Instance>("instance", { scope: "session" }).withDefaultProperties(
  () => ({
    followingUserId: null,
    isFocusMode: false,
    isDebugMode: false,
    isToolLocked: false,
    isGridMode: false,
    isReadonly: false,
    isFocused: false,
    isPenMode: false,
    isChangingStyle: false,
    exportBackground: true,
    screenBounds: { x: 0, y: 0, w: 1080, h: 720 },
    insets: [false, false, false, false],
    cursor: { type: "default", rotation: 0 },
    scribbles: [],
    brush: null,
    zoomBrush: null,
    openMenus: [],
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    isCoarsePointer: false,
    isHoveringCanvas: null,
    stylesForNextShape: {},
    duplicateProps: null,
    meta: {},
  }),
)
export const INSTANCE_ID = InstanceRecordType.createId("instance")

export interface InstancePageState {
  readonly id: InstancePageStateId
  readonly typeName: "instance_page_state"
  pageId: PageId
  selectedShapeIds: ShapeId[]
  hintingShapeIds: ShapeId[]
  erasingShapeIds: ShapeId[]
  hoveredShapeId: ShapeId | null
  editingShapeId: ShapeId | null
  croppingShapeId: ShapeId | null
  focusedGroupId: ShapeId | null
  meta: JsonObject
}
export type InstancePageStateId = RecordId<InstancePageState>
export const InstancePageStateRecordType = createRecordType<InstancePageState>("instance_page_state", {
  scope: "session",
}).withDefaultProperties(() => ({
  selectedShapeIds: [],
  hintingShapeIds: [],
  erasingShapeIds: [],
  hoveredShapeId: null,
  editingShapeId: null,
  croppingShapeId: null,
  focusedGroupId: null,
  meta: {},
}))

// ---- shapes ----------------------------------------------------------------

export interface BaseShape<Type extends string, Props extends object> {
  readonly id: ShapeId
  readonly typeName: "shape"
  type: Type
  x: number
  y: number
  rotation: number
  index: IndexKey
  parentId: ParentId
  isLocked: boolean
  opacity: number
  props: Props
  meta: JsonObject
}
export type UnknownShape = BaseShape<string, object>
/**
 * A shape record. Give it a type name and its props resolve through
 * {@link ShapePropsForType} — so `Shape<"format">` has the props the `format`
 * shape registered in `TLGlobalShapePropsMap`, while a bare `Shape` (or a type
 * nobody registered) keeps the open `object` props it always had.
 */
/**
 * One shape record, with its props resolved from {@link TLGlobalShapePropsMap}.
 *
 * With no argument this is the union of every REGISTERED shape type, and the
 * conditional distributes over that union — so `Shape` is discriminated and
 * `shape.type === "note"` narrows `shape.props` to the note's props.
 *
 * Registered types only, deliberately: an open `string` member would be
 * assignable from every literal and would survive the narrowing, defeating the
 * whole point. For a shape whose type is not known statically, use
 * {@link UnknownShape}. Until something registers a type — `@mocanvas/editor`
 * on its own ships no shapes — this falls back to `UnknownShape` so the
 * package is usable alone.
 */
export type Shape<Type extends string = RegisteredShapeType> = [RegisteredShapeType] extends [never]
  ? UnknownShape
  : Type extends string
    ? BaseShape<Type, ShapePropsForType<Type>>
    : never
export type ShapeId = RecordId<UnknownShape>
export type ParentId = PageId | ShapeId

export const ShapeRecordType = createRecordType<UnknownShape>("shape", { scope: "document" }).withDefaultProperties(
  () => ({ x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {} }),
)

export function createShapeId(id?: string): ShapeId {
  return ShapeRecordType.createId(id) as ShapeId
}
export function isShapeId(id: unknown): id is ShapeId {
  return typeof id === "string" && id.startsWith("shape:")
}
export function isShape(record: unknown): record is UnknownShape {
  return typeof record === "object" && record !== null && (record as { typeName?: string }).typeName === "shape"
}

export type ShapePartial<T extends UnknownShape = UnknownShape> = {
  id: ShapeId
  type: T["type"]
} & Partial<Omit<T, "id" | "type" | "props" | "meta">> & {
    props?: Partial<T["props"]>
    meta?: Partial<T["meta"]>
  }

/** A shape partial without a required id (id and index are assigned on create). */
export type ShapeCreate<T extends UnknownShape = UnknownShape> = Omit<ShapePartial<T>, "id"> & { id?: ShapeId }
