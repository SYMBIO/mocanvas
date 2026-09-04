/**
 * Elbow arrow routing.
 *
 * An elbow arrow runs from its start terminal to its end terminal along
 * axis-aligned legs instead of an arc. The route is decided by two axes — the
 * axis the body leaves the start on and the axis it arrives at the end on:
 *
 * - same axis on both ends: three legs (H-V-H or V-H-V), with the middle leg
 *   placed at `midPoint` along that axis (0 hard against the start, 1 against
 *   the end);
 * - different axes: two legs (an L, H-V or V-H).
 *
 * A free terminal uses the *dominant* axis — whichever of `|dx|` and `|dy|` is
 * larger — so a wide, short arrow leaves horizontally and a tall, narrow one
 * leaves vertically. A bound terminal uses the axis of the bound shape's
 * nearest edge normal (see `getBoundElbowAxes`), so the arrow leaves the shape
 * square-on rather than diagonally.
 *
 * Corners are then rounded with a quarter-turn whose radius is clamped to half
 * of each adjacent leg, so two corners sharing a leg can never overlap.
 */
import { Vec, type VecLike } from "@mocanvas/editor"
import type { ElbowBody } from "./arrow-helpers"

/** Which coordinate a leg varies: `"x"` for a horizontal leg, `"y"` for a vertical one. */
export type ElbowAxis = "x" | "y"

const EPS = 1e-6

/** Corner radius as a multiple of the stroke width. */
export const ELBOW_CORNER_STROKES = 2.5

/** Line segments used to approximate one rounded corner. */
const CORNER_SEGMENTS = 4

export interface ElbowRouteOptions {
  /** Where the middle leg sits along the shared axis, clamped to `0..1`. */
  midPoint?: number
  /** Axis the body must leave the start on; defaults to the dominant axis. */
  startAxis?: ElbowAxis | undefined
  /** Axis the body must arrive at the end on; defaults to the dominant axis. */
  endAxis?: ElbowAxis | undefined
  /** Corner radius before per-corner clamping. */
  cornerRadius?: number
}

export interface ElbowRoute {
  /** Corner points from start to end, before the corners are rounded. */
  corners: Vec[]
  /** The drawn polyline: `corners` with each corner replaced by a fillet. */
  points: Vec[]
  /** The middle leg, when the route has one; `null` for an L or a straight run. */
  midLeg: [Vec, Vec] | null
  /** The axis the middle leg slides along, `null` when there is no middle leg. */
  slideAxis: ElbowAxis | null
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** The axis a free terminal leaves on: the one the terminals are further apart on. */
export function getDominantAxis(start: VecLike, end: VecLike): ElbowAxis {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "x" : "y"
}

/** Drop points that repeat, and points that sit on the straight line between their neighbours. */
function simplify(points: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (last && Vec.Dist2(last, p) < EPS * EPS) continue
    out.push(p)
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!
    const b = out[i]!
    const c = out[i + 1]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) < EPS) out.splice(i, 1)
  }
  return out
}

/**
 * Round one corner at `p` between `a` and `b` into `CORNER_SEGMENTS` chords of
 * a quarter circle. The radius is clamped to half of each adjacent leg. Corners
 * that are not right angles (which an axis-aligned route never produces) are
 * left sharp.
 */
function roundCorner(a: Vec, p: Vec, b: Vec, radius: number): Vec[] {
  const lenA = Vec.Dist(a, p)
  const lenB = Vec.Dist(b, p)
  const r = Math.min(radius, lenA / 2, lenB / 2)
  if (r < EPS) return [p]
  const da = Vec.Div(Vec.Sub(a, p), lenA)
  const db = Vec.Div(Vec.Sub(b, p), lenB)
  if (Math.abs(Vec.Dot(da, db)) > 1e-3) return [p]
  const from = Vec.Add(p, Vec.Mul(da, r))
  const to = Vec.Add(p, Vec.Mul(db, r))
  // Both legs are unit and perpendicular, so the arc's centre is one radius
  // along each of them.
  const center = Vec.Add(p, Vec.Mul(Vec.Add(da, db), r))
  const a0 = Math.atan2(from.y - center.y, from.x - center.x)
  const a1 = Math.atan2(to.y - center.y, to.x - center.x)
  let sweep = a1 - a0
  while (sweep > Math.PI) sweep -= Math.PI * 2
  while (sweep <= -Math.PI) sweep += Math.PI * 2
  const out: Vec[] = []
  for (let i = 0; i <= CORNER_SEGMENTS; i++) {
    const angle = a0 + (sweep * i) / CORNER_SEGMENTS
    out.push(new Vec(center.x + r * Math.cos(angle), center.y + r * Math.sin(angle)))
  }
  return out
}

/** `corners` with every interior corner replaced by a fillet of `radius`. */
export function roundElbowCorners(corners: Vec[], radius: number): Vec[] {
  if (corners.length < 3 || radius < EPS) return corners.map((p) => p.clone())
  const out: Vec[] = [corners[0]!.clone()]
  for (let i = 1; i < corners.length - 1; i++) {
    for (const p of roundCorner(corners[i - 1]!, corners[i]!, corners[i + 1]!, radius)) out.push(p)
  }
  out.push(corners.at(-1)!.clone())
  return simplify(out)
}

/**
 * Route an elbow from `start` to `end`. See the module comment for the rule.
 */
export function getElbowRoute(start: VecLike, end: VecLike, options: ElbowRouteOptions = {}): ElbowRoute {
  const s = Vec.From(start)
  const e = Vec.From(end)
  const dominant = getDominantAxis(s, e)
  const startAxis = options.startAxis ?? dominant
  const endAxis = options.endAxis ?? dominant
  const t = clamp01(options.midPoint ?? 0.5)

  let corners: Vec[]
  let midLeg: [Vec, Vec] | null = null
  let slideAxis: ElbowAxis | null = null

  if (startAxis === endAxis) {
    // Three legs: out along the shared axis, across, then in along it again.
    if (startAxis === "x") {
      const mx = s.x + (e.x - s.x) * t
      const a = new Vec(mx, s.y)
      const b = new Vec(mx, e.y)
      corners = [s, a, b, e]
      if (Math.abs(e.y - s.y) > EPS) {
        midLeg = [a, b]
        slideAxis = "x"
      }
    } else {
      const my = s.y + (e.y - s.y) * t
      const a = new Vec(s.x, my)
      const b = new Vec(e.x, my)
      corners = [s, a, b, e]
      if (Math.abs(e.x - s.x) > EPS) {
        midLeg = [a, b]
        slideAxis = "y"
      }
    }
  } else {
    // Two legs: one turn, at the corner the two axes meet in.
    corners = startAxis === "x" ? [s, new Vec(e.x, s.y), e] : [s, new Vec(s.x, e.y), e]
  }

  const simplified = simplify(corners)
  return {
    corners: simplified,
    points: roundElbowCorners(simplified, options.cornerRadius ?? 0),
    midLeg,
    slideAxis,
  }
}

/** The elbow body for an arrow: the rounded route as a polyline body. */
export function getElbowBody(start: VecLike, end: VecLike, options: ElbowRouteOptions = {}): ElbowBody {
  return { kind: "elbow", points: getElbowRoute(start, end, options).points }
}

/**
 * `elbowMidPoint` for a midpoint handle dragged to `point`: how far along
 * `axis` it sits between the terminals, clamped to `0..1`.
 */
export function getElbowMidPointFromPoint(start: VecLike, end: VecLike, point: VecLike, axis: ElbowAxis): number {
  const span = end[axis] - start[axis]
  if (Math.abs(span) < EPS) return 0.5
  return clamp01((point[axis] - start[axis]) / span)
}
