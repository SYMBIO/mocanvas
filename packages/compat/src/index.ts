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
  ArrowBindingProps,
  ArrowBindings,
  ArrowShapeProps,
  AssetContext,
  AssetPartial,
  BaseAsset,
  BaseEventInfo,
  BindingCreate,
  BookmarkAsset,
  BookmarkShape,
  BookmarkShapeProps,
  CancelEventInfo,
  CompleteEventInfo,
  DrawShapeProps,
  EditorOptions,
  EditorStoreProps,
  EmbedShape,
  EmbedShapeProps,
  EventHandlers,
  ExternalContent,
  FrameShapeProps,
  GeoShapeProps,
  ImageAsset,
  ImageShape,
  ImageShapeProps,
  InstanceId,
  InstancePageStateId,
  InterruptEventInfo,
  KeyboardEventName,
  LineShapeProps,
  MocanvasProps,
  NoteShapeProps,
  PinchEventInfo,
  PointerEventName,
  PropsMigration,
  PropsMigrations,
  ResizeShapeOptions,
  RichText,
  Scribble,
  SvgExportOptions,
  TLSchema,
  TextShapeProps,
  TickEventInfo,
  UserId,
  VideoAsset,
  VideoShape,
  VideoShapeProps,
} from "@mocanvas/mocanvas"
import { Mocanvas, createSchema, createStore, Canvas, Editor, useCurrentUser, DOCUMENT_ID, INSTANCE_ID } from "@mocanvas/mocanvas"
import type { SerializedStore } from "@mocanvas/store"

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


// ---- the documented `TL*` spellings ------------------------------------------
//
// Everything below is a name tldraw's reference documents and this package did
// not carry. Each is a pure alias of a type mocanvas already exports unprefixed:
// the capability was never missing, only the spelling a migrating codebase
// imports it by. Kept in step by `pnpm --filter bench api-coverage`.

// ---- events the tools and the editor emit ------------------------------------
export type TLBaseEventInfo = BaseEventInfo
export type TLCancelEventInfo = CancelEventInfo
export type TLCompleteEventInfo = CompleteEventInfo
export type TLEventHandlers = EventHandlers
export type TLInterruptEventInfo = InterruptEventInfo
export type TLKeyboardEventName = KeyboardEventName
export type TLPinchEventInfo = PinchEventInfo
export type TLPointerEventName = PointerEventName
export type TLTickEventInfo = TickEventInfo

// ---- per-shape props ---------------------------------------------------------
export type TLArrowShapeProps = ArrowShapeProps
export type TLBookmarkShapeProps = BookmarkShapeProps
export type TLDrawShapeProps = DrawShapeProps
export type TLEmbedShapeProps = EmbedShapeProps
export type TLFrameShapeProps = FrameShapeProps
export type TLGeoShapeProps = GeoShapeProps
export type TLImageShapeProps = ImageShapeProps
export type TLLineShapeProps = LineShapeProps
export type TLNoteShapeProps = NoteShapeProps
export type TLTextShapeProps = TextShapeProps
export type TLVideoShapeProps = VideoShapeProps

// ---- shapes ------------------------------------------------------------------
export type TLBookmarkShape = BookmarkShape
export type TLEmbedShape = EmbedShape
export type TLImageShape = ImageShape
export type TLVideoShape = VideoShape

// ---- assets ------------------------------------------------------------------
export type TLAssetContext = AssetContext
export type TLAssetPartial<A extends Asset = Asset> = AssetPartial<A>
export type TLBaseAsset<Type extends string, Props extends object> = BaseAsset<Type, Props>
export type TLBookmarkAsset = BookmarkAsset
export type TLImageAsset = ImageAsset
export type TLVideoAsset = VideoAsset

// ---- records and their ids ---------------------------------------------------
export type TLBindingCreate<B extends UnknownBinding = UnknownBinding> = BindingCreate<B>
export const TLDOCUMENT_ID = DOCUMENT_ID
export const TLINSTANCE_ID = INSTANCE_ID
export type TLInstanceId = InstanceId
export type TLInstancePageStateId = InstancePageStateId
export type TLPropsMigration = PropsMigration
export type TLPropsMigrations = PropsMigrations
export type TLRichText = RichText
export type TLScribble = Scribble
export type TLSerializedStore = SerializedStore<EditorRecord>
export type TLStoreSchema = TLSchema
export type TLUnknownBinding = UnknownBinding
export type TLUserId = UserId

// ---- options, props and the rest ----------------------------------------
export type TLArrowBindingProps = ArrowBindingProps
export type TLArrowBindings = ArrowBindings
export type TldrawEditorStoreProps = EditorStoreProps
export type TldrawProps = MocanvasProps
export type TLEditorOptions = EditorOptions
export type TLExternalContent = ExternalContent
export type TLResizeShapeOptions = ResizeShapeOptions
export type TLSvgExportOptions = SvgExportOptions

// `TldrawUiMenuItem` used to be aliased here, back when the flagship only had
// `MocanvasUiMenuItem`. The UI layer now exports the documented name itself, and
// an alias here would shadow it — so there is nothing to add.
