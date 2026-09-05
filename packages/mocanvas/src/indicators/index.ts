/**
 * The canvas overlay painters.
 *
 * v5 moved the brush, the scribbles, the snap lines, the handles, the selection
 * box and the collaborator chrome off React and onto one 2D canvas above the
 * scene. Each of them is an `OverlayUtil` registered with `editor.overlays`;
 * this directory holds the built-in set, and {@link defaultOverlayUtils} is the
 * list a board gets unless it says otherwise.
 *
 * The seam itself — `OverlayUtil`, `OverlayManager`, `getOverlayDisplayValues`,
 * `TLIndicatorPath` — lives in `@mocanvas/editor`, because `<Canvas>` there has
 * to work for an app that never imports this package.
 */
export { ShapeIndicatorOverlayUtil, type TLShapeIndicatorOverlay } from "./ShapeIndicatorOverlayUtil"
export {
  ArrowBindingHintOverlayUtil,
  ArrowHintOverlayUtil,
  DEFAULT_ARROW_BINDING_HINT_OVERLAY_OPTIONS,
  DEFAULT_ARROW_HINT_OVERLAY_OPTIONS,
  type ArrowBindingHintOverlayUtilDisplayValues,
  type ArrowBindingHintOverlayUtilOptions,
  type ArrowHintOverlayUtilDisplayValues,
  type ArrowHintOverlayUtilOptions,
} from "./ArrowHintOverlayUtil"
export {
  BrushOverlayUtil,
  DEFAULT_BRUSH_OVERLAY_OPTIONS,
  ZoomBrushOverlayUtil,
  type BrushOverlayUtilDisplayValues,
  type BrushOverlayUtilOptions,
} from "./BrushOverlayUtil"
export {
  CollaboratorBrushOverlayUtil,
  CollaboratorCursorOverlayUtil,
  CollaboratorHintOverlayUtil,
  CollaboratorScribbleOverlayUtil,
  CollaboratorShapeIndicatorOverlayUtil,
  DEFAULT_COLLABORATOR_OVERLAY_OPTIONS,
  type CollaboratorOverlayUtilOptions,
} from "./CollaboratorOverlayUtils"
export {
  DEFAULT_SCRIBBLE_OVERLAY_OPTIONS,
  ScribbleOverlayUtil,
  resolveScribbleColor,
  type ScribbleOverlayUtilDisplayValues,
  type ScribbleOverlayUtilOptions,
} from "./ScribbleOverlayUtil"
export {
  DEFAULT_SELECTION_FOREGROUND_OVERLAY_OPTIONS,
  SelectionForegroundOverlayUtil,
  type SelectionForegroundOverlayUtilDisplayValues,
  type SelectionForegroundOverlayUtilOptions,
} from "./SelectionForegroundOverlayUtil"
export {
  DEFAULT_SHAPE_HANDLE_OVERLAY_OPTIONS,
  ShapeHandleOverlayUtil,
  type ShapeHandleOverlayUtilDisplayValues,
  type ShapeHandleOverlayUtilOptions,
} from "./ShapeHandleOverlayUtil"
export {
  DEFAULT_SNAP_INDICATOR_OVERLAY_OPTIONS,
  SnapIndicatorOverlayUtil,
  type SnapIndicatorOverlayUtilDisplayValues,
  type SnapIndicatorOverlayUtilOptions,
} from "./SnapIndicatorOverlayUtil"
export { defaultOverlayUtils } from "./defaultOverlayUtils"
export type {
  CameraLike,
  OverlayBox,
  TLArrowBindingHintOverlay,
  TLArrowHintOverlay,
  TLBrushOverlay,
  TLCollaboratorBrushOverlay,
  TLCollaboratorCursorOverlay,
  TLCollaboratorHintOverlay,
  TLCollaboratorScribbleOverlay,
  TLCollaboratorShapeIndicatorOverlay,
  TLScribbleOverlay,
  TLSelectionForegroundOverlay,
  TLShapeHandleOverlay,
  TLSnapIndicatorOverlay,
  TLZoomBrushOverlay,
} from "./types"
export {
  drawLabelChip,
  hairline,
  isolate,
  traceCross,
  tracePolyline,
  traceRoundedRect,
  traceTaperedStroke,
  withCamera,
} from "./paint"
