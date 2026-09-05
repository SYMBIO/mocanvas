/**
 * Where things cross.
 *
 * Hit-testing answers "is this near me"; these answer "and exactly where". They
 * are what an arrow uses to find the point on a shape's outline it should stop
 * at, what a brush uses to decide whether it grazed a shape, and what a clipping
 * frame uses to work out the visible part of a child.
 *
 * The `intersect*` family returns the crossing points and `null` when there are
 * none; the `*Intersect*` predicates return a boolean and do the cheaper work.
 */
import { Box } from "./Box"
import { Vec, type VecLike } from "./Vec"

/**
 * Where the segments `a1`→`a2` and `b1`→`b2` cross, or null if they do not.
 *
 * `precision` is the tolerance on the parametric bounds, so that two segments
 * meeting exactly at an endpoint after a transform still count as meeting.
 */
export function intersectLineSegmentLineSegment(
  a1: VecLike,
  a2: VecLike,
  b1: VecLike,
  b2: VecLike,
  precision = 0.000001,
): null | Vec {
  const ax = a2.x - a1.x
  const ay = a2.y - a1.y
  const bx = b2.x - b1.x
  const by = b2.y - b1.y
  const denominator = ax * by - ay * bx
  // Parallel or degenerate: no single crossing point exists even if they overlap.
  if (denominator === 0) return null
  const dx = a1.x - b1.x
  const dy = a1.y - b1.y
  const ua = (bx * dy - by * dx) / denominator
  const ub = (ax * dy - ay * dx) / denominator
  if (ua < -precision || ua > 1 + precision || ub < -precision || ub > 1 + precision) return null
  return new Vec(a1.x + ua * ax, a1.y + ua * ay)
}

/** Whether the segments `A`→`B` and `C`→`D` cross. */
export function linesIntersect(A: VecLike, B: VecLike, C: VecLike, D: VecLike): boolean {
  return intersectLineSegmentLineSegment(A, B, C, D) !== null
}

/**
 * Where the segment `a1`→`a2` crosses the circle of radius `r` about `c`, or
 * null when it misses it entirely. A segment that lies wholly inside the circle
 * crosses it nowhere and also gives null.
 */
export function intersectLineSegmentCircle(a1: VecLike, a2: VecLike, c: VecLike, r: number): null | VecLike[] {
  const dx = a2.x - a1.x
  const dy = a2.y - a1.y
  const fx = a1.x - c.x
  const fy = a1.y - c.y
  const a = dx * dx + dy * dy
  if (a === 0) return null
  const b = 2 * (fx * dx + fy * dy)
  const cc = fx * fx + fy * fy - r * r
  const discriminant = b * b - 4 * a * cc
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const results: Vec[] = []
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t >= 0 && t <= 1) results.push(new Vec(a1.x + t * dx, a1.y + t * dy))
  }
  // Both roots equal is a tangent, which is one point, not two.
  if (results.length === 2 && discriminant === 0) results.pop()
  return results.length === 0 ? null : results
}

/**
 * Where two circles cross. Two points when they properly overlap, one when they
 * are tangent, none when one contains the other or they are apart.
 */
export function intersectCircleCircle(c1: VecLike, r1: number, c2: VecLike, r2: number): Vec[] {
  const d = Vec.Dist(c1, c2)
  if (d === 0) return []
  if (d > r1 + r2) return []
  if (d < Math.abs(r1 - r2)) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const hSquared = r1 * r1 - a * a
  const h = hSquared <= 0 ? 0 : Math.sqrt(hSquared)
  const px = c1.x + (a * (c2.x - c1.x)) / d
  const py = c1.y + (a * (c2.y - c1.y)) / d
  if (h === 0) return [new Vec(px, py)]
  const rx = (-(c2.y - c1.y) * h) / d
  const ry = ((c2.x - c1.x) * h) / d
  return [new Vec(px + rx, py + ry), new Vec(px - rx, py - ry)]
}

function intersectCircleEdges(c: VecLike, r: number, points: VecLike[], closed: boolean): null | VecLike[] {
  const results: VecLike[] = []
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const hit = intersectLineSegmentCircle(points[i]!, points[(i + 1) % points.length]!, c, r)
    if (hit) results.push(...hit)
  }
  return results.length === 0 ? null : results
}

/** Where a circle crosses a closed polygon's outline. */
export function intersectCirclePolygon(c: VecLike, r: number, points: VecLike[]): null | VecLike[] {
  return intersectCircleEdges(c, r, points, true)
}

/** Where a circle crosses an open polyline. */
export function intersectCirclePolyline(c: VecLike, r: number, points: VecLike[]): null | VecLike[] {
  return intersectCircleEdges(c, r, points, false)
}

function intersectSegmentEdges(a1: VecLike, a2: VecLike, points: VecLike[], closed: boolean): null | VecLike[] {
  const results: VecLike[] = []
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const hit = intersectLineSegmentLineSegment(a1, a2, points[i]!, points[(i + 1) % points.length]!)
    if (hit) results.push(hit)
  }
  return results.length === 0 ? null : results
}

/** Where the segment `a1`→`a2` crosses a closed polygon's outline. */
export function intersectLineSegmentPolygon(a1: VecLike, a2: VecLike, points: VecLike[]): null | VecLike[] {
  return intersectSegmentEdges(a1, a2, points, true)
}

/** Where the segment `a1`→`a2` crosses an open polyline. */
export function intersectLineSegmentPolyline(a1: VecLike, a2: VecLike, points: VecLike[]): null | VecLike[] {
  return intersectSegmentEdges(a1, a2, points, false)
}

/** Where a closed polygon's outline crosses the edges of an axis-aligned box. */
export function intersectPolygonBounds(points: VecLike[], bounds: Box): null | VecLike[] {
  return intersectPolygonPolygonOutlines(points, bounds.corners)
}

function intersectPolygonPolygonOutlines(a: VecLike[], b: VecLike[]): null | VecLike[] {
  const results: VecLike[] = []
  for (let i = 0; i < a.length; i++) {
    const hits = intersectLineSegmentPolygon(a[i]!, a[(i + 1) % a.length]!, b)
    if (hits) results.push(...hits)
  }
  return results.length === 0 ? null : results
}

/** Whether `A` lies inside the closed polygon `points`. */
export function pointInPolygon(A: VecLike, points: VecLike[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!
    const b = points[j]!
    if (a.y > A.y !== b.y > A.y && A.x < ((b.x - a.x) * (A.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * The convex region common to two convex polygons, or null when they do not
 * overlap. Clipped one edge at a time (Sutherland–Hodgman), so a concave input
 * gives a convex answer — which is the same caveat the name carries.
 */
export function intersectPolygonPolygon(polygonA: VecLike[], polygonB: VecLike[]): null | VecLike[] {
  if (polygonA.length < 3 || polygonB.length < 3) return null
  // Clip against each of B's edges in turn, keeping whatever survives.
  let output: VecLike[] = polygonA.map((p) => ({ x: p.x, y: p.y }))
  // Which side of B's winding counts as inside; a polygon may be wound either way.
  const sign = signedArea(polygonB) >= 0 ? 1 : -1
  const isInside = (p: VecLike, e1: VecLike, e2: VecLike) =>
    sign * ((e2.x - e1.x) * (p.y - e1.y) - (e2.y - e1.y) * (p.x - e1.x)) >= 0

  for (let i = 0; i < polygonB.length; i++) {
    const e1 = polygonB[i]!
    const e2 = polygonB[(i + 1) % polygonB.length]!
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const current = input[j]!
      const previous = input[(j + input.length - 1) % input.length]!
      const currentIn = isInside(current, e1, e2)
      const previousIn = isInside(previous, e1, e2)
      if (currentIn !== previousIn) {
        const crossing = intersectLineThroughPoints(previous, current, e1, e2)
        if (crossing) output.push(crossing)
      }
      if (currentIn) output.push(current)
    }
    if (output.length === 0) return null
  }
  return output
}

/** Where the infinite lines through `a1`,`a2` and `b1`,`b2` meet. */
function intersectLineThroughPoints(a1: VecLike, a2: VecLike, b1: VecLike, b2: VecLike): Vec | null {
  const ax = a2.x - a1.x
  const ay = a2.y - a1.y
  const bx = b2.x - b1.x
  const by = b2.y - b1.y
  const denominator = ax * by - ay * bx
  if (denominator === 0) return null
  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / denominator
  return new Vec(a1.x + t * ax, a1.y + t * ay)
}

function signedArea(points: VecLike[]): number {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    total += a.x * b.y - b.x * a.y
  }
  return total / 2
}

/**
 * Whether two closed polygons overlap at all — including the case where one is
 * entirely inside the other, which no edge crossing would reveal.
 */
export function polygonsIntersect(a: VecLike[], b: VecLike[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  for (let i = 0; i < a.length; i++) {
    if (intersectLineSegmentPolygon(a[i]!, a[(i + 1) % a.length]!, b)) return true
  }
  return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a)
}

/**
 * Whether an open polyline touches a closed polygon — either by crossing its
 * outline or by running entirely inside it.
 */
export function polygonIntersectsPolyline(polygon: VecLike[], polyline: VecLike[]): boolean {
  if (polygon.length === 0 || polyline.length === 0) return false
  for (let i = 0; i < polyline.length - 1; i++) {
    if (intersectLineSegmentPolygon(polyline[i]!, polyline[i + 1]!, polygon)) return true
  }
  return pointInPolygon(polyline[0]!, polygon)
}
