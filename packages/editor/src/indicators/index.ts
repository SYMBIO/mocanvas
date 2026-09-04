/** The canvas indicator overlay: types, the compositor, and the resolution rule. */
export type {
  TLIndicatorContext,
  TLIndicatorPath,
  TLIndicatorPathResult,
  TLIndicatorTransform,
  TLShapeIndicator,
} from "./types"
export { OverlayUtil, type OverlayHost } from "./OverlayUtil"
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
  ShapeIndicatorOverlayUtil,
  type IndicatorShapeUtil,
  type TLIndicatorHost,
  type TLShapeIndicatorOptions,
} from "./ShapeIndicatorOverlayUtil"
