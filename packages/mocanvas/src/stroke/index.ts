/**
 * Freehand strokes: turning pointer samples into a fillable outline, and
 * reading a draw shape's stored segments back out.
 */
export {
  getStroke,
  getStrokeOutlinePoints,
  getStrokePoints,
  getSvgPathFromStrokePoints,
  type StrokeOptions,
  type StrokePoint,
  type StrokeTerminalOptions,
} from "./getStroke"
export { getPointsFromDrawSegment, getPointsFromDrawSegments } from "./draw-segments"
