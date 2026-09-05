/**
 * Arrow body and arrowhead math.
 *
 * A body is a straight run, an arc, or — for an elbow arrow — the polyline
 * routed by `elbow-helpers`. Everything below works on all three, so callers
 * ask for a point, a tangent or a length without caring which one they hold.
 *
 * Bend convention: `bend` is the signed perpendicular offset of the arc's
 * midpoint from the chord midpoint. The perpendicular is `Per(Uni(end-start))`
 * = (-dy, dx), so for a left-to-right arrow a positive bend bows the arc toward
 * +y (down in screen space).
 */
import { CubicSpline2d, Polygon2d, Polyline2d, Vec, type ArrowShapeArrowheadKind, type Geometry2d, type VecLike } from "@mocanvas/editor"
import { arcToCubicSegments } from "./spline-helpers"

/**
 * How an arrow's terminal is drawn.
 *
 * The vocabulary itself lives with the other style vocabularies in the editor
 * (`ARROWHEAD_KINDS`), so the style prop and the geometry cannot drift apart;
 * this is the name the arrow code has always used for it.
 */
export type ArrowheadKind = ArrowShapeArrowheadKind

export interface StraightBody {
  kind: "straight"
  start: Vec
  end: Vec
}

export interface ArcBody {
  kind: "arc"
  center: Vec
  radius: number
  startAngle: number
  /** Signed sweep in radians. */
  sweep: number
}

/**
 * A body made of straight runs: the elbow arrow's axis-aligned route with its
 * corners already rounded. Built by `getElbowBody` in `elbow-helpers`; every
 * body operation below treats it as a polyline parameterized by arc length.
 */
export interface ElbowBody {
  kind: "elbow"
  points: Vec[]
}

export type ArrowBody = StraightBody | ArcBody | ElbowBody

const EPS = 1e-6

function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  if (r <= -Math.PI) r += Math.PI * 2
  return r
}

/** Describe the body running from `start` to `end`, bowed by `bend`. */
export function getArrowBody(start: VecLike, end: VecLike, bend: number): ArrowBody {
  const s = Vec.From(start)
  const e = Vec.From(end)
  const chord = Vec.Sub(e, s)
  const halfChord = Vec.Len(chord) / 2
  if (Math.abs(bend) < EPS || halfChord < EPS) return { kind: "straight", start: s, end: e }

  const u = Vec.Uni(chord)
  const n = Vec.Per(u)
  const mid = Vec.Lrp(s, e, 0.5)
  const b = Math.abs(bend)
  const sign = Math.sign(bend)
  const radius = (halfChord * halfChord + b * b) / (2 * b)
  const center = Vec.Add(mid, Vec.Mul(n, bend - sign * radius))
  const arcMid = Vec.Add(mid, Vec.Mul(n, bend))

  const startAngle = Vec.Angle(center, s)
  const endAngle = Vec.Angle(center, e)
  let sweep = normalizeAngle(endAngle - startAngle)
  // Pick the direction whose midpoint lands on the requested arc midpoint.
  const midAngle = startAngle + sweep / 2
  const candidate = new Vec(center.x + radius * Math.cos(midAngle), center.y + radius * Math.sin(midAngle))
  if (Vec.Dist(candidate, arcMid) > 1e-3 * Math.max(1, radius)) {
    sweep = sweep - Math.sign(sweep || 1) * Math.PI * 2
  }
  return { kind: "arc", center, radius, startAngle, sweep }
}

/** Cumulative length at each point of a polyline; `at(-1)` is its total length. */
function cumulativeLengths(points: Vec[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + Vec.Dist(points[i - 1]!, points[i]!))
  return out
}

/** Index of the segment holding `distance`, as an index into `points`. */
function segmentAt(lengths: number[], distance: number): number {
  for (let i = 1; i < lengths.length; i++) {
    if (distance <= lengths[i]! || i === lengths.length - 1) return i - 1
  }
  return 0
}

/** The point `distance` along a polyline, clamped to its ends. */
function pointAtDistance(points: Vec[], lengths: number[], distance: number): Vec {
  if (points.length === 0) return new Vec()
  if (points.length === 1) return points[0]!.clone()
  const i = segmentAt(lengths, distance)
  const segment = lengths[i + 1]! - lengths[i]!
  const t = segment < EPS ? 0 : (distance - lengths[i]!) / segment
  return Vec.Lrp(points[i]!, points[i + 1]!, Math.max(0, Math.min(1, t)))
}

export function getBodyLength(body: ArrowBody): number {
  if (body.kind === "straight") return Vec.Dist(body.start, body.end)
  if (body.kind === "elbow") return cumulativeLengths(body.points).at(-1) ?? 0
  return Math.abs(body.sweep) * body.radius
}

/** Point at parameter `t` in [0, 1] along the body. */
export function getPointOnBody(body: ArrowBody, t: number): Vec {
  if (body.kind === "straight") return Vec.Lrp(body.start, body.end, t)
  if (body.kind === "elbow") {
    const lengths = cumulativeLengths(body.points)
    return pointAtDistance(body.points, lengths, (lengths.at(-1) ?? 0) * t)
  }
  const a = body.startAngle + body.sweep * t
  return new Vec(body.center.x + body.radius * Math.cos(a), body.center.y + body.radius * Math.sin(a))
}

/**
 * Unit direction of travel at parameter `t`. On an elbow that is the direction
 * of the leg `t` falls on, so `t = 1` gives the direction of the final leg —
 * which is where the end arrowhead points.
 */
export function getTangentOnBody(body: ArrowBody, t: number): Vec {
  if (body.kind === "straight") return Vec.Uni(Vec.Sub(body.end, body.start))
  if (body.kind === "elbow") {
    const points = body.points
    if (points.length < 2) return new Vec(1, 0)
    const lengths = cumulativeLengths(points)
    const i = segmentAt(lengths, (lengths.at(-1) ?? 0) * Math.max(0, Math.min(1, t)))
    // Degenerate segments carry no direction; walk to the nearest one that does.
    for (let step = 0; step < points.length; step++) {
      for (const j of [i + step, i - step]) {
        if (j < 0 || j >= points.length - 1) continue
        const d = Vec.Sub(points[j + 1]!, points[j]!)
        if (Vec.Len(d) > EPS) return Vec.Uni(d)
      }
    }
    return new Vec(1, 0)
  }
  const a = body.startAngle + body.sweep * t
  const dir = Math.sign(body.sweep) || 1
  return new Vec(-Math.sin(a) * dir, Math.cos(a) * dir)
}

/** Trim `startBy` / `endBy` page units from either end of the body. */
export function shortenBody(body: ArrowBody, startBy: number, endBy: number): ArrowBody {
  const length = getBodyLength(body)
  if (length < EPS) return body
  // Never eat more than 90% of the body.
  const total = startBy + endBy
  const budget = length * 0.9
  const scale = total > budget ? budget / total : 1
  const s = startBy * scale
  const e = endBy * scale
  if (body.kind === "straight") {
    return { kind: "straight", start: getPointOnBody(body, s / length), end: getPointOnBody(body, 1 - e / length) }
  }
  if (body.kind === "elbow") {
    const lengths = cumulativeLengths(body.points)
    const from = s
    const to = length - e
    const points: Vec[] = [pointAtDistance(body.points, lengths, from)]
    for (let i = 1; i < body.points.length - 1; i++) {
      const at = lengths[i]!
      if (at > from + EPS && at < to - EPS) points.push(body.points[i]!.clone())
    }
    points.push(pointAtDistance(body.points, lengths, to))
    return { kind: "elbow", points }
  }
  const dir = Math.sign(body.sweep) || 1
  const dStart = (s / body.radius) * dir
  const dEnd = (e / body.radius) * dir
  return {
    kind: "arc",
    center: body.center,
    radius: body.radius,
    startAngle: body.startAngle + dStart,
    sweep: body.sweep - dStart - dEnd,
  }
}

/** Geometry for the body: a polyline (straight or elbow) or a cubic approximation of the arc. */
export function bodyToGeometry(body: ArrowBody): Geometry2d {
  if (body.kind === "straight") return new Polyline2d({ points: [body.start, body.end] })
  if (body.kind === "elbow") return new Polyline2d({ points: body.points })
  const count = Math.max(2, Math.ceil(Math.abs(body.sweep) / (Math.PI / 2)))
  return new CubicSpline2d({
    segments: arcToCubicSegments(body.center, body.radius, body.startAngle, body.sweep, count),
    isClosed: false,
    isFilled: false,
  })
}

/** Arrowhead length for a stroke width, capped so two heads never overlap. */
export function getArrowheadLength(strokeWidth: number, bodyLength: number): number {
  return Math.max(0, Math.min(Math.max(12, strokeWidth * 4), bodyLength / 2.5))
}

/** How far the body must retreat from the tip so it ends at the head's base. */
export function getArrowheadInset(kind: ArrowheadKind, length: number): number {
  switch (kind) {
    case "triangle":
    case "inverted":
    case "diamond":
    case "square":
    case "dot":
      return length
    case "arrow":
    case "bar":
    case "pipe":
    case "none":
      return 0
  }
}

const CHEVRON_HALF_WIDTH = Math.tan(Math.PI / 6)

/**
 * Arrowhead geometry with its tip at `tip`, pointing along unit `dir` (from
 * the body outward). Closed heads are filled; open ones are polylines.
 */
export function getArrowheadGeometry(kind: ArrowheadKind, tip: VecLike, dir: VecLike, length: number): Geometry2d | null {
  if (kind === "none" || length <= 0) return null
  const t = Vec.From(tip)
  const d = Vec.From(dir)
  const p = Vec.Per(d)
  const back = Vec.Sub(t, Vec.Mul(d, length))
  const wing = Vec.Mul(p, length * CHEVRON_HALF_WIDTH)
  switch (kind) {
    case "arrow":
      return new Polyline2d({ points: [Vec.Add(back, wing), t, Vec.Sub(back, wing)] })
    case "triangle":
      return new Polygon2d({ points: [t, Vec.Add(back, wing), Vec.Sub(back, wing)], isFilled: true })
    case "inverted":
      return new Polygon2d({ points: [back, Vec.Add(t, wing), Vec.Sub(t, wing)], isFilled: true })
    case "square": {
      const half = Vec.Mul(p, length / 2)
      return new Polygon2d({
        points: [Vec.Add(t, half), Vec.Sub(t, half), Vec.Sub(back, half), Vec.Add(back, half)],
        isFilled: true,
      })
    }
    case "diamond": {
      const mid = Vec.Lrp(t, back, 0.5)
      const half = Vec.Mul(p, length / 2)
      return new Polygon2d({ points: [t, Vec.Add(mid, half), back, Vec.Sub(mid, half)], isFilled: true })
    }
    case "dot": {
      const center = Vec.Lrp(t, back, 0.5)
      return new CubicSpline2d({
        segments: arcToCubicSegments(center, length / 2, 0, Math.PI * 2, 4),
        isClosed: true,
        isFilled: true,
      })
    }
    case "bar": {
      const half = Vec.Mul(p, length / 2)
      return new Polyline2d({ points: [Vec.Add(t, half), Vec.Sub(t, half)] })
    }
    case "pipe": {
      const half = Vec.Mul(p, length * 0.35)
      return new Polyline2d({ points: [Vec.Add(t, half), Vec.Sub(t, half)] })
    }
  }
}

/** Signed bend for a dragged midpoint handle at `point`. */
export function getBendFromPoint(start: VecLike, end: VecLike, point: VecLike): number {
  const chord = Vec.Sub(end, start)
  if (Vec.Len(chord) < EPS) return 0
  const n = Vec.Per(Vec.Uni(chord))
  const mid = Vec.Lrp(start, end, 0.5)
  const bend = Vec.Dot(Vec.Sub(point, mid), n)
  return Math.abs(bend) < 1 ? 0 : bend
}
