/**
 * Shape geometry as seen by ShapeUtils, and the maths it is built on.
 *
 * Every geometry serializes to the flat path encoding the engine consumes, and
 * offers a TS-side surface for tools that need geometry without a round trip
 * (handle placement, snapping, arrow binding, hit testing).
 *
 * This file is the module's barrel; the code lives in the files beside it:
 * `Vec`, `Box` and `Mat` for the primitives, `utils` for scalar and angular
 * maths, `intersect` for crossings, `Geometry2d` for the base contract, and
 * `shapes2d` for the concrete geometries.
 */
// `VecModel` is deliberately not re-exported here: `@mocanvas/editor` already
// publishes a structurally identical one from its events module, and two of the
// same name in the package barrel is an ambiguity, not a convenience.
export { Vec, type VecLike } from "./Vec"
export { Box, type BoxLike, type BoxModel, type BoxHandle } from "./Box"
export { Mat, type MatLike, type MatModel, type DecomposedMat } from "./Mat"
export {
  SIDES,
  ROTATE_CORNER_TO_SELECTION_CORNER,
  rotateSelectionHandle,
  type SelectionCorner,
  type SelectionEdge,
  type RotateCorner,
} from "./handles"
export {
  PI,
  PI2,
  HALF_PI,
  SIN,
  EASINGS,
  type TLEasingType,
  clamp,
  approximately,
  toDomPrecision,
  toPrecision,
  precise,
  average,
  rangeIntersection,
  degreesToRadians,
  radiansToDegrees,
  canonicalizeRotation,
  clampRadians,
  shortAngleDist,
  clockwiseAngleDist,
  counterClockwiseAngleDist,
  angleDistance,
  areAnglesCompatible,
  snapAngle,
  getPointOnCircle,
  getArcMeasure,
  getPointInArcT,
  getPointsOnArc,
  centerOfCircleFromThreePoints,
  perimeterOfEllipse,
  getPolygonVertices,
} from "./utils"
export {
  intersectLineSegmentLineSegment,
  linesIntersect,
  intersectLineSegmentCircle,
  intersectCircleCircle,
  intersectCirclePolygon,
  intersectCirclePolyline,
  intersectLineSegmentPolygon,
  intersectLineSegmentPolyline,
  intersectPolygonBounds,
  intersectPolygonPolygon,
  polygonsIntersect,
  polygonIntersectsPolyline,
  pointInPolygon,
} from "./intersect"
export {
  Geometry2d,
  Geometry2dFilters,
  TransformedGeometry2d,
  type Geometry2dOptions,
  type TransformedGeometry2dOptions,
  type TLGeometryOpts,
} from "./Geometry2d"
export {
  Point2d,
  Polyline2d,
  Polygon2d,
  Edge2d,
  Rectangle2d,
  Ellipse2d,
  Circle2d,
  Stadium2d,
  Arc2d,
  CubicBezier2d,
  CubicSpline2d,
  Group2d,
  type CubicSegmentLike,
} from "./shapes2d"
