export * from "./editor/Editor"
export * from "./editor/createStore"
export * from "./editor/events"
export { HandleTable } from "./editor/HandleTable"
export {
  TextureManager,
  bucketTextureResolution,
  MAX_TEXTURE_RESOLUTION,
  MAX_TEXTURE_ZOOM,
  type TextureInfo,
  type TextureLoader,
  type TextureManagerOptions,
  type TextureState,
} from "./editor/TextureManager"
export * from "./editor/selectionHandles"
export { SnapManager, type SnapLine, type SnapResult } from "./editor/SnapManager"
export { HistoryManager } from "./editor/HistoryManager"
export * from "./geometry"
// Fractional index keys live in the store; re-exported so shape ordering can be
// worked with from the editor surface alone.
export { ZERO_INDEX_KEY, getIndexAbove, getIndexBelow, getIndexBetween, getIndices, getIndicesAbove, getIndicesBelow, getIndicesBetween, sortByIndex, type IndexKey } from "@mocanvas/store"
export * from "./records/base"
export * from "./records/binding"
export * from "./records/asset"
export * from "./records/presence"
export * from "./records/normalize"
export * from "./bindings/BindingUtil"
export {
  DEFAULT_COLORS,
  DEFAULT_DASHES,
  DEFAULT_FILLS,
  DEFAULT_FONTS,
  DEFAULT_H_ALIGNS,
  DEFAULT_SIZES,
  DEFAULT_V_ALIGNS,
  GEO_SHAPE_KINDS,
  STROKE_SIZES,
  FONT_SIZES,
  LIGHT_THEME,
  hexToRgba,
  type GeoShapeKind,
  type ThemeColor,
} from "./records/styles"
export * from "./records/styleProp"
export * from "./shapes/ShapeUtil"
export * from "./tools/StateNode"
export { RootState, createRootState } from "./tools/RootState"
export type { RenderBackend, DrawOptions, RGBA, TextureOptions, TextureSource } from "./render/backend"
export { WebGL2Backend, createBackend } from "./render/webgl2"
export { Canvas, type CanvasProps, type CanvasComponents } from "./react/Canvas"
export {
  registerExportImplementation,
  getExportImplementation,
  registerTextMeasureImplementation,
  getTextMeasureProvider,
  type EditorExportImplementation,
  type EditorTextMeasureProvider,
} from "./editor/Editor"
export { getShapeIndicatorNode } from "./react/Canvas"

// --- workstream A: augmentable prop maps, validation, props migrations ---------
export * from "./records/props"
export * from "./migrations/propsMigrations"
// Deliberately NOT `export *`: T.ts declares `object`, `or`, `union`, `optional`,
// `literal`, `model` and `dict`, which must not land in the package namespace.
export { T, ObjectValidator, ArrayOfValidator, type ObjectValidatorType, type ValidationLibrary } from "./validation/T"
export {
  ValidationError,
  Validator,
  isOptionalValidator,
  formatValidationPath,
  prefixError,
  type Validatable,
  type TypeOf,
  type ValidationPathSegment,
} from "./validation/validator"
export { validateProps, isValidProps } from "./validation/props"

// --- workstream E: shape containers and the UI override surface ----------------
export {
  HTMLContainer,
  SVGContainer,
  stopEventPropagation,
  type HTMLContainerProps,
  type SVGContainerProps,
} from "./react/containers"
export type {
  TLComponents,
  TLComponentsResolved,
  TLUiComponentSlot,
  TLUiEventSource,
  TLUiToolItem,
  TLUiToolsContextType,
  TLUiActionItem,
  TLUiActionsContextType,
  TLUiOverrideHelpers,
  TLUiOverrides,
} from "./react/ui-types"
export {
  MocanvasUiProvider,
  useMocanvasUi,
  useEditorComponents,
  useTools,
  useActions,
  useIsToolSelected,
  useIsEditing,
  useGlobalMenuIsOpen,
  type MocanvasUiContextValue,
  type MocanvasUiProviderProps,
  type TLUiToolsBuilder,
  type TLUiActionsBuilder,
} from "./react/ui-context"

// --- workstream G: asset store, users, presence --------------------------------
export * from "./assets"
export * from "./user"

// --- workstream D: theme system and display values -----------------------------
export * from "./theme"

// --- workstream C: camera options, timers, fonts, performance, container -------
export {
  DEFAULT_CAMERA_OPTIONS,
  easeInOutCubic,
  getBaseZoomForCameraOptions,
  type TLCameraOptions,
  type TLCameraConstraints,
  type TLCameraConstraintsZoom,
  type TLCameraMoveOptions,
} from "./editor/CameraOptions"
export { Timers } from "./editor/Timers"
export { FontManager, fontKey, type TLFontLoadState } from "./editor/FontManager"
export { PerformanceManager, type PerformanceEvents, type PerformanceEventName } from "./editor/PerformanceManager"
export {
  getOwnerDocument,
  getOwnerWindow,
  type ContainerDocument,
  type ContainerWindow,
} from "./editor/container"

export { useEditor, useMaybeEditor, EditorProvider, EditorContext } from "./react/EditorContext"
export { loadEngine, loadEngineSync, getLoadedEngine, EngineBridge, FLAG, PATH_OP, type StyleWords, type CameraState, type ClipRect } from "@mocanvas/wasm"
export { useValue, track, useAtom, useComputed, useReactor, useQuickReactor } from "@mocanvas/state/react"

// ── Workstream B: canvas indicators, frame-like shapes ──────────────────────
// Added by the indicators/frame-like workstream. Kept as one contiguous block
// so the integrator can move or re-order it in a single edit.
export {
  boundsIndicatorPath,
  canBuildIndicatorPaths,
  DEFAULT_SHAPE_INDICATOR_OPTIONS,
  getIndicatorSource,
  getShapeIndicatorPath,
  normalizeIndicatorPath,
  OverlayUtil,
  ShapeIndicatorOverlayUtil,
  type IndicatorPathSource,
  type IndicatorShapeUtil,
  type IndicatorSource,
  type OverlayHost,
  type TLIndicatorContext,
  type TLIndicatorHost,
  type TLIndicatorPath,
  type TLIndicatorPathResult,
  type TLIndicatorTransform,
  type TLShapeIndicator,
  type TLShapeIndicatorOptions,
} from "./indicators"
export { BaseFrameLikeShapeUtil, type FrameLikeShape } from "./shapes/BaseFrameLikeShapeUtil"
export { dropShapesOnFrameLike, getFrameLikeDropTarget } from "./shapes/frame-like"
