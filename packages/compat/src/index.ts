/**
 * Migration aliases. Projects moving from a `TL`-prefixed API can switch their
 * imports to `@mocanvas/compat` first and rename at their own pace.
 *
 * Every alias here is a pure re-export; there is no runtime code.
 */
export * from "@mocanvas/mocanvas"

import type {
  ArrowBinding,
  ArrowShape,
  Camera,
  CameraId,
  ClickEventInfo,
  Document,
  DrawShape,
  EditorRecord,
  EditorStore,
  EditorStoreSnapshot,
  EventInfo,
  FrameShape,
  GeoShape,
  GroupShape,
  Instance,
  InstancePageState,
  KeyboardEventInfo,
  LineShape,
  NoteShape,
  Page,
  PageId,
  ParentId,
  PointerEventInfo,
  Shape,
  ShapeCreate,
  ShapeHandle,
  ShapeId,
  ShapePartial,
  ShapeUtilConstructor,
  StateNodeConstructor,
  TextShape,
  UnknownBinding,
  UnknownShape,
  WheelEventInfo,
  BindingId,
  BindingUtilConstructor,
  SelectionHandle,
  ResizeInfo,
  DefaultColorStyle as DefaultColorStyleValue,
  DefaultDashStyle as DefaultDashStyleValue,
  DefaultFillStyle as DefaultFillStyleValue,
  DefaultFontStyle as DefaultFontStyleValue,
  DefaultSizeStyle as DefaultSizeStyleValue,
  DefaultHorizontalAlignStyle as DefaultHorizontalAlignStyleValue,
  DefaultVerticalAlignStyle as DefaultVerticalAlignStyleValue,
  GeoShapeKind,
} from "@mocanvas/mocanvas"
import type {
  Asset,
  AssetId,
  AssetStore,
  BaseBinding,
  BaseShape,
  Binding,
  CurrentUser,
  EmbedDefinition,
  InstancePresence,
  InstancePresenceId,
  User,
  UserPreferencesState,
  UserStore,
} from "@mocanvas/mocanvas"
import { Mocanvas, createSchema, createStore, Canvas, Editor, useCurrentUser } from "@mocanvas/mocanvas"

// ---- records ----------------------------------------------------------------
export type TLRecord = EditorRecord
export type TLStore = EditorStore
export type TLStoreSnapshot = EditorStoreSnapshot
// `never` as the default so a bare `TLShape` is `Shape` itself — the union of
// registered types. Spelling the default `string` collapsed it to one
// non-union type and `shape.type === "note"` narrowed nothing.
export type TLShape<Type extends string = never> = [Type] extends [never] ? Shape : Shape<Type>
export type TLUnknownShape = UnknownShape
export type TLShapeId = ShapeId
export type TLParentId = ParentId
export type TLShapePartial<T extends UnknownShape = UnknownShape> = ShapePartial<T>
export type TLShapeCreate<T extends UnknownShape = UnknownShape> = ShapeCreate<T>
export type TLPage = Page
export type TLPageId = PageId
export type TLDocument = Document
export type TLCamera = Camera
export type TLCameraId = CameraId
export type TLInstance = Instance
export type TLInstancePageState = InstancePageState
export type TLBinding<Type extends string = never> = [Type] extends [never] ? Binding : Binding<Type>
export type TLBindingId = BindingId
export type TLArrowBinding = ArrowBinding

// ---- default shapes ---------------------------------------------------------
export type TLGeoShape = GeoShape
export type TLDrawShape = DrawShape
export type TLLineShape = LineShape
export type TLArrowShape = ArrowShape
export type TLTextShape = TextShape
export type TLNoteShape = NoteShape
export type TLFrameShape = FrameShape
export type TLGroupShape = GroupShape
export type TLGeoShapeGeoStyle = GeoShapeKind

// ---- styles (value types) ---------------------------------------------------
export type TLDefaultColorStyle = DefaultColorStyleValue
export type TLDefaultDashStyle = DefaultDashStyleValue
export type TLDefaultFillStyle = DefaultFillStyleValue
export type TLDefaultFontStyle = DefaultFontStyleValue
export type TLDefaultSizeStyle = DefaultSizeStyleValue
export type TLDefaultHorizontalAlignStyle = DefaultHorizontalAlignStyleValue
export type TLDefaultVerticalAlignStyle = DefaultVerticalAlignStyleValue

// ---- events / tools ---------------------------------------------------------
export type TLEventInfo = EventInfo
export type TLPointerEventInfo = PointerEventInfo
export type TLClickEventInfo = ClickEventInfo
export type TLKeyboardEventInfo = KeyboardEventInfo
export type TLWheelEventInfo = WheelEventInfo
export type TLHandle = ShapeHandle
export type TLSelectionHandle = SelectionHandle
export type TLResizeInfo<T extends UnknownShape> = ResizeInfo<T>
export type TLShapeUtilConstructor<T extends UnknownShape = UnknownShape> = ShapeUtilConstructor<T>
export type TLStateNodeConstructor = StateNodeConstructor
export type TLBindingUtilConstructor = BindingUtilConstructor
export type TLAnyShapeUtilConstructor = ShapeUtilConstructor
export type TLAnyBindingUtilConstructor = BindingUtilConstructor

// ---- values -----------------------------------------------------------------
/** The batteries-included component. */
export const Tldraw = Mocanvas
/** The bare canvas (bring your own shapes, tools and UI). */
export const TldrawEditor = Canvas
export const createTLStore = createStore
export const createTLSchema = createSchema
export type TLEditor = Editor

// ---- custom shape and binding authoring -------------------------------------
// The two base types a custom shape/binding is declared with. `Props` is the
// object registered in `TLGlobalShapePropsMap` / `TLGlobalBindingPropsMap`.
export type TLBaseShape<Type extends string, Props extends object> = BaseShape<Type, Props>
export type TLBaseBinding<Type extends string, Props extends object> = BaseBinding<Type, Props>

// ---- assets -----------------------------------------------------------------
export type TLAsset = Asset
export type TLAssetId = AssetId
export type TLAssetStore = AssetStore

// ---- users and presence -----------------------------------------------------
export type TLUser = User
export type TLUserStore = UserStore
export type TLCurrentUser = CurrentUser
export type TLUserPreferences = UserPreferencesState
export type TLInstancePresence = InstancePresence
export type TLInstancePresenceID = InstancePresenceId
/** The `Tldraw`-spelled identity hook. */
export const useTldrawCurrentUser = useCurrentUser

// ---- embeds -----------------------------------------------------------------
export type TLEmbedDefinition = EmbedDefinition

// `TldrawUiMenuItem` used to be aliased here, back when the flagship only had
// `MocanvasUiMenuItem`. The UI layer now exports the documented name itself, and
// an alias here would shadow it — so there is nothing to add.
