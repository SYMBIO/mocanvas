export * from "./Editor"
export * from "./createStore"
export * from "./events"
export * from "./inputs"
export * from "./selectionHandles"
export { HandleTable } from "./HandleTable"
export {
  TextureManager,
  bucketTextureResolution,
  MAX_TEXTURE_RESOLUTION,
  MAX_TEXTURE_ZOOM,
  type TextureInfo,
  type TextureLoader,
  type TextureManagerOptions,
  type TextureState,
} from "./TextureManager"
export { SnapManager, type SnapLine, type SnapResult } from "./SnapManager"
export { HistoryManager } from "./HistoryManager"
export {
  DEFAULT_CAMERA_OPTIONS,
  easeInOutCubic,
  getBaseZoomForCameraOptions,
  type TLCameraOptions,
  type TLCameraConstraints,
  type TLCameraConstraintsZoom,
  type TLCameraMoveOptions,
} from "./CameraOptions"
export { Timers } from "./Timers"
export { FontManager, fontKey, type TLFontLoadState } from "./FontManager"
export { PerformanceManager, type PerformanceEvents, type PerformanceEventName } from "./PerformanceManager"
export { getOwnerDocument, getOwnerWindow, type ContainerDocument, type ContainerWindow } from "./container"
// the base class managers with subscriptions sit on
export * from "./EditorManager"
export * from "./ClickManager"
export * from "./ScribbleManager"
export * from "./TextManager"
export * from "./OverlayManager"
export { CollaboratorsManager } from "./CollaboratorsManager"
export { EdgeScrollManager } from "./EdgeScrollManager"
export { CameraStateTracker, type TLCameraState } from "./CameraStateTracker"
// walking, clipping and culling the shape tree
export {
  findCommonAncestor,
  findShapeAncestor,
  getShapeAndDescendantIds,
  hasAncestor,
  isAncestorSelected,
  isShapeInPage,
  resolveShape,
  visitDescendants,
  type ShapeRef,
} from "./ancestry"
export {
  getShapeClipPath,
  getShapeIdsInsideBounds,
  getShapeMaskedPageBounds,
  getShapesPageBounds,
  isPointInShape,
  type TLPointInShapeOptions,
} from "./clipping"
export {
  getCulledShapes,
  getCurrentPageRenderingShapesSorted,
  getCurrentPageShapesInReadingOrder,
  getNotVisibleShapes,
  getRenderingShapes,
  isShapeHidden,
  type TLGetShapeVisibility,
  type TLRenderingShape,
  type TLShapeVisibility,
} from "./culling"
export {
  deselect,
  getFocusedGroup,
  getFocusedGroupId,
  getNearestAdjacentShape,
  getOnlySelectedShapeId,
  getSelectedShapeAtPoint,
  getSelectionRotatedPageBounds,
  getSelectionRotatedScreenBounds,
  getSelectionScreenBounds,
  popFocusedGroupId,
  selectAdjacentShape,
  selectFirstChildShape,
  selectParentShape,
  setFocusedGroup,
  type TLAdjacentDirection,
} from "./selection"
export { canBindShapes, canCreateShape, canCreateShapes, canCropShape, canEditShape } from "./permissions"
export {
  animateShape,
  animateShapes,
  getInitialMetaForShape,
  getShapeHandles,
  getShapeStyleIfExists,
  getSharedOpacity,
  moveShapesToPage,
  packShapes,
  resizeToBounds,
  setOpacityForNextShapes,
  setOpacityForSelectedShapes,
  type TLAnimationOptions,
  type TLSharedOpacity,
} from "./shapeOperations"
export { duplicatePage, getPageStates, updatePage } from "./pages"
export {
  CURRENT_SESSION_SCHEMA_VERSION,
  getSessionStateSnapshot,
  getSnapshot,
  loadSnapshot,
  type TLEditorSnapshot,
  type TLLoadSnapshotOptions,
  type TLSessionPageState,
  type TLSessionStateSnapshot,
} from "./snapshots"
export {
  createDeepLinkString,
  parseDeepLinkString,
  type TLDeepLink,
  type TLDeepLinkOptions,
} from "./deepLinks"
export {
  AssetUtilRegistry,
  type TLAssetUtilConstructorLike,
  type TLAssetUtilLike,
  type TLTemporaryAssetPreview,
} from "./assetUtils"
// The mounted-editor registry; every editor enrols itself on `mount`.
export * from "./tleditors"

// ---- workstream: the remaining documented `@tldraw/editor` surface -----------
// Small general-purpose helpers, the environment, and the replaceable
// side effects a host may need to take over.
export * from "./utils"
export * from "./env"
export * from "./runtime"
export * from "./tltime"
export * from "./tlmenus"
// The documented vocabulary for events, timing, history and external content.
export * from "./eventTypes"
export * from "./perfEvents"
export * from "./historyTypes"
export * from "./externalContent"
// The full option bag, and the store/schema surface built on it.
export * from "./tldrawOptions"
export * from "./storeTypes"
export * from "./schemaFactories"
export * from "./sessionState"
export * from "./coreShapes"
// Snapping, placement, DOM plumbing, text, paths and export.
export * from "./snaps"
export * from "./shapePlacement"
export * from "./dom"
// `richTextValidator` and `defaultAddFontsFromNode` are deliberately NOT
// re-exported: the flagship owns both names, and a second `export *` carrying
// them would make the package barrel drop the name entirely rather than error.
export {
  getFontsFromRichText,
  resolveLineHeightPx,
  type RichTextFontVisitor,
  type RichTextFontVisitorState,
  type TLRichTextFontSource,
  type TiptapEditor,
  type TiptapNode,
} from "./richText"
export * from "./paths"
export * from "./svgExport"
export * from "./strokeIndicators"
