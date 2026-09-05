/**
 * Reading a draw shape's stored segments back into points.
 *
 * A draw shape stores its points packed (see `b64Vecs`) and in the shape's own
 * unit space, so anything that wants to measure, hit-test or re-render a stroke
 * has to unpack it and scale it to the shape's current size. That is exactly
 * these two functions, kept separate from the draw shape util so a tool, an
 * exporter or an app's own code can read a stroke without going through the
 * util.
 */

import { b64Vecs, DIM_2D, Vec, type TLDrawShapeSegment } from "@mocanvas/editor"

/**
 * The points of one segment, scaled by `scaleX`/`scaleY`, appended to `points`.
 *
 * Appending into a caller-supplied array rather than returning a fresh one is
 * what lets {@link getPointsFromDrawSegments} walk a whole stroke without
 * allocating an array per segment; the array is returned as well, so a caller
 * that does not care can ignore the parameter.
 */
export function getPointsFromDrawSegment(segment: TLDrawShapeSegment, scaleX: number, scaleY: number, points: Vec[] = []): Vec[] {
  const dim = segment.dim ?? undefined
  const decoded =
    dim === DIM_2D
      ? b64Vecs.decodePoints2D(segment.points).map((p) => ({ x: p.x, y: p.y, z: 0.5 }))
      : b64Vecs.decodePoints(segment.points)
  for (const point of decoded) {
    // Pressure rides along as `z` so a re-stroked segment keeps its width
    // profile; scaling must not touch it.
    const scaled = new Vec(point.x * scaleX, point.y * scaleY, point.z)
    // A repeated point contributes no direction and would put a spike in the
    // outline where two segments meet.
    const last = points[points.length - 1]
    if (last && last.x === scaled.x && last.y === scaled.y) continue
    points.push(scaled)
  }
  return points
}

/** Every point of a stroke, in order, scaled to the shape's current size. */
export function getPointsFromDrawSegments(segments: TLDrawShapeSegment[], scaleX = 1, scaleY = 1): Vec[] {
  const points: Vec[] = []
  for (const segment of segments) getPointsFromDrawSegment(segment, scaleX, scaleY, points)
  return points
}
