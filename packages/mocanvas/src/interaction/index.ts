/**
 * Editor-level operations the flagship's chrome drives: the zoom tool, canvas
 * hit testing, drag-from-toolbar, frame operations, and the default store side
 * effects.
 *
 * They are grouped by *when* they run rather than by what they touch — all of
 * them are things that happen in response to a gesture or a store change, and
 * all of them are exported because a custom tool or a custom menu has to be
 * able to do exactly what the built-in one does.
 */
export { fitFrameToContent, removeFrame } from "./frames"
export { centerSelectionAroundPoint, getHitShapeOnCanvasPointerDown } from "./pointer"
export { onDragFromToolbarToCreateShape, type OnDragFromToolbarToCreateShapesOpts } from "./toolbar-drag"
export { registerDefaultSideEffects } from "./side-effects"
export { ZoomTool } from "./ZoomTool"
