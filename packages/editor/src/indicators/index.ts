/** The canvas indicator overlay: types, the compositor, and the resolution rule. */
export type {
  TLIndicatorContext,
  TLIndicatorPath,
  TLIndicatorPathResult,
  TLIndicatorTransform,
  TLIndicatorOverlay,
} from "./types"
export { OverlayUtil, type OverlayHost, type OverlayLike, type OverlayUtilOptions } from "./OverlayUtil"
export {
  getOverlayDisplayValues,
  type OverlayOptionsWithDisplayValues,
  type TLGetCustomOverlayDisplayValues,
  type TLGetDefaultOverlayDisplayValues,
  type TLOverlayDisplayValuesSource,
} from "./overlayDisplayValues"
export {
  boundsIndicatorPath,
  canBuildIndicatorPaths,
  getIndicatorSource,
  getShapeIndicatorPath,
  normalizeIndicatorPath,
  type IndicatorPathSource,
  type IndicatorSource,
} from "./resolve"
export {
  DEFAULT_SHAPE_INDICATOR_OPTIONS,
  ShapeIndicatorCompositor,
  type IndicatorShapeUtil,
  type TLIndicatorHost,
  type TLShapeIndicatorOptions,
} from "./ShapeIndicatorCompositor"
