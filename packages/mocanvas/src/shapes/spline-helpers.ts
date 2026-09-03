/** Curve construction shared by the line, arrow and geo shapes. */
import { Vec, type VecLike } from "@mocanvas/editor"

export interface CubicSegment {
  p0: VecLike
  c1: VecLike
  c2: VecLike
  p1: VecLike
}

/** A straight line expressed as a cubic (control points at 1/3 and 2/3). */
export function lineSegment(a: VecLike, b: VecLike): CubicSegment {
  return { p0: a, c1: Vec.Lrp(a, b, 1 / 3), c2: Vec.Lrp(a, b, 2 / 3), p1: b }
}

/**
 * Approximate a circular arc with `count` cubic béziers.
 * `sweep` is signed: positive sweeps toward increasing angle (clockwise in
 * screen space where +y points down).
 */
export function arcToCubicSegments(
  center: VecLike,
  radius: number,
  startAngle: number,
  sweep: number,
  count = 2,
): CubicSegment[] {
  const n = Math.max(1, Math.floor(count))
  const step = sweep / n
  // Tangent handle length for a cubic approximating an arc of `step` radians.
  const k = (4 / 3) * Math.tan(step / 4) * radius
  const out: CubicSegment[] = []
  for (let i = 0; i < n; i++) {
    const a0 = startAngle + step * i
    const a1 = a0 + step
    const p0 = { x: center.x + radius * Math.cos(a0), y: center.y + radius * Math.sin(a0) }
    const p1 = { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1) }
    out.push({
      p0,
      c1: { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) },
      c2: { x: p1.x + k * Math.sin(a1), y: p1.y - k * Math.cos(a1) },
      p1,
    })
  }
  return out
}

/**
 * Convert a polyline into a smooth cubic spline that passes through every
 * point (uniform Catmull-Rom, tension 0.5, converted to bézier handles).
 * Endpoints are clamped so the curve starts and ends exactly on the first and
 * last points.
 */
export function catmullRomToBezier(points: readonly VecLike[], closed = false): CubicSegment[] {
  const n = points.length
  if (n < 2) return []
  const at = (i: number): VecLike => {
    if (closed) return points[((i % n) + n) % n]!
    return points[Math.max(0, Math.min(n - 1, i))]!
  }
  const segCount = closed ? n : n - 1
  const out: CubicSegment[] = []
  for (let i = 0; i < segCount; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    out.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p1: p2,
    })
  }
  return out
}

/** Evaluate a cubic segment at `t`. */
export function pointOnCubic(s: CubicSegment, t: number): Vec {
  const u = 1 - t
  return new Vec(
    u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p1.x,
    u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y,
  )
}
