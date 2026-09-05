/**
 * The command list a {@link PathBuilder} accumulates, and the arc maths that
 * turns an SVG-style elliptical arc into something the rest of the pipeline can
 * draw.
 *
 * A path is kept as commands rather than as a `d` string or a vertex list
 * because every consumer wants a different projection of it: the indicator
 * layer wants the engine's flat word stream, an export wants a `d`, a hit test
 * wants vertices, and the draw style wants to jitter the *original* points
 * before any of that happens. Keeping the commands means each projection is
 * generated once from the same source rather than parsed back out of another
 * projection.
 */

import type { Geometry2dOptions, VecLike } from "@mocanvas/editor"

/**
 * How a dashed run starts or ends.
 *
 * `"none"` leaves the terminal alone, `"outset"` pushes it half a dash out so a
 * corner reads as solid, and `"skip"` drops the terminal dash entirely.
 *
 * SEMANTICS-ASSUMED: the documented spelling of this is
 * `@tldraw/editor`'s `PerfectDashTerminal`, which mocanvas does not export yet
 * (it belongs to the editor package's dash helpers). The three names above are
 * the terminal treatments a dash generator has to distinguish; when the editor
 * publishes its own alias the two are structurally the same string union.
 */
export type PathDashTerminal = "none" | "outset" | "skip"

/** Per-command settings shared by every command that draws a line. */
export interface PathBuilderCommandOpts {
  /**
   * When converting to a dash- or dot-style line, whether this segment is
   * merged with the previous one when the dash pattern is measured. Merging
   * keeps a dash running across a corner instead of restarting at it.
   */
  mergeWithPrevious?: boolean
  /** When converting to a draw-style line, how far this point may wander from where it was placed. */
  offset?: number
  /** When converting to a draw-style line, how much to round the end of this line. */
  roundness?: number
}

/**
 * Settings for a command that *starts* a run — `moveTo`, and the two static
 * builders. Beyond {@link PathBuilderCommandOpts} it decides what geometry the
 * run contributes and how its dashes terminate.
 */
export interface PathBuilderLineOpts extends PathBuilderCommandOpts {
  /** Terminal treatment for the last dash of the run. */
  dashEnd?: PathDashTerminal
  /** Terminal treatment for the first dash of the run. */
  dashStart?: PathDashTerminal
  /**
   * The geometry this run contributes, or `false` for a run that is painted
   * but never hit-tested. `isClosed` is not settable: whether a run is closed
   * is decided by whether it ends in `close()`.
   */
  geometry?: false | Omit<Geometry2dOptions, "isClosed">
}

/** A `moveTo`: lifts the pen and starts a new run. */
export interface PathMoveCommand {
  type: "move"
  x: number
  y: number
  opts: PathBuilderLineOpts
}

/** A straight segment to `(x, y)`. */
export interface PathLineCommand {
  type: "line"
  x: number
  y: number
  opts: PathBuilderCommandOpts
}

/** A cubic bézier to `(x, y)` through two control points. */
export interface PathCubicCommand {
  type: "cubic"
  x: number
  y: number
  cp1X: number
  cp1Y: number
  cp2X: number
  cp2Y: number
  opts: PathBuilderCommandOpts
}

/** An SVG-style elliptical arc to `(x, y)`. */
export interface PathArcCommand {
  type: "arc"
  rx: number
  ry: number
  largeArcFlag: boolean
  sweepFlag: boolean
  xAxisRotationRadians: number
  x: number
  y: number
  opts: PathBuilderCommandOpts
}

/** Closes the run in progress, joining its end back to its `moveTo`. */
export interface PathCloseCommand {
  type: "close"
}

/** One entry of a {@link PathBuilder}'s command list. */
export type PathBuilderCommand = PathMoveCommand | PathLineCommand | PathCubicCommand | PathArcCommand | PathCloseCommand

/** A cubic segment in the form every projection consumes: start, two controls, end. */
export interface CubicSegment {
  start: VecLike
  cp1: VecLike
  cp2: VecLike
  end: VecLike
}

/**
 * The cubic béziers an elliptical arc is drawn as.
 *
 * SVG states an arc by where it ends and how it bulges (`rx`, `ry`, the
 * rotation, and the two flags); everything that draws one — a `d` string aside
 * — needs its centre, its start angle and its sweep. This is the endpoint →
 * centre conversion from the SVG path specification's implementation notes,
 * followed by the standard split into at most one cubic per quarter turn.
 *
 * Degenerate input (a zero radius, or an arc that ends where it starts) yields
 * a single straight segment, which is what the specification asks for.
 */
export function arcToCubicSegments(from: VecLike, arc: PathArcCommand): CubicSegment[] {
  const x1 = from.x
  const y1 = from.y
  const x2 = arc.x
  const y2 = arc.y
  if (x1 === x2 && y1 === y2) return []

  let rx = Math.abs(arc.rx)
  let ry = Math.abs(arc.ry)
  if (rx === 0 || ry === 0) return [straight(from, { x: x2, y: y2 })]

  const phi = arc.xAxisRotationRadians
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Step 1: the endpoints in the ellipse's own frame, centred between them.
  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  // Step 2: grow radii that are too small to reach across the chord.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rx *= scale
    ry *= scale
  }

  // Step 3: the centre, in that same frame and then back in path space.
  const rxSq = rx * rx
  const rySq = ry * ry
  const numerator = Math.max(0, rxSq * rySq - rxSq * y1p * y1p - rySq * x1p * x1p)
  const denominator = rxSq * y1p * y1p + rySq * x1p * x1p
  const coefficient = (arc.largeArcFlag === arc.sweepFlag ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator)
  const cxp = (coefficient * (rx * y1p)) / ry
  const cyp = (coefficient * -(ry * x1p)) / rx
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  // Step 4: start angle and swept angle.
  const startAngle = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let deltaAngle = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!arc.sweepFlag && deltaAngle > 0) deltaAngle -= Math.PI * 2
  else if (arc.sweepFlag && deltaAngle < 0) deltaAngle += Math.PI * 2

  // Step 5: one cubic per quarter turn keeps the approximation error invisible.
  const count = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)))
  const step = deltaAngle / count
  // The magic constant that makes a cubic follow a circular arc of `step`.
  const alpha = (4 / 3) * Math.tan(step / 4)

  const segments: CubicSegment[] = []
  let theta = startAngle
  let current: VecLike = { x: x1, y: y1 }
  for (let i = 0; i < count; i++) {
    const next = theta + step
    const end = onEllipse(cx, cy, rx, ry, cosPhi, sinPhi, next)
    const d1 = derivativeOnEllipse(rx, ry, cosPhi, sinPhi, theta)
    const d2 = derivativeOnEllipse(rx, ry, cosPhi, sinPhi, next)
    segments.push({
      start: current,
      cp1: { x: current.x + alpha * d1.x, y: current.y + alpha * d1.y },
      cp2: { x: end.x - alpha * d2.x, y: end.y - alpha * d2.y },
      end,
    })
    current = end
    theta = next
  }
  // Land exactly on the requested endpoint; the trigonometry above lands within
  // floating-point noise of it, and a path that does not close exactly reads as
  // an open shape to every fill rule downstream.
  const last = segments[segments.length - 1]
  if (last) last.end = { x: x2, y: y2 }
  return segments
}

function straight(from: VecLike, to: VecLike): CubicSegment {
  return { start: from, cp1: from, cp2: to, end: to }
}

function onEllipse(cx: number, cy: number, rx: number, ry: number, cosPhi: number, sinPhi: number, theta: number): VecLike {
  const x = rx * Math.cos(theta)
  const y = ry * Math.sin(theta)
  return { x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy }
}

function derivativeOnEllipse(rx: number, ry: number, cosPhi: number, sinPhi: number, theta: number): VecLike {
  const x = -rx * Math.sin(theta)
  const y = ry * Math.cos(theta)
  return { x: cosPhi * x - sinPhi * y, y: sinPhi * x + cosPhi * y }
}

/** The signed angle from vector `u` to vector `v`, in `(-PI, PI]`. */
function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy
  const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy)
  if (len === 0) return 0
  const sign = ux * vy - uy * vx < 0 ? -1 : 1
  return sign * Math.acos(Math.min(1, Math.max(-1, dot / len)))
}

/** A point on a cubic bézier at `t`, by de Casteljau. */
export function cubicPointAt(segment: CubicSegment, t: number): VecLike {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * segment.start.x + b * segment.cp1.x + c * segment.cp2.x + d * segment.end.x,
    y: a * segment.start.y + b * segment.cp1.y + c * segment.cp2.y + d * segment.end.y,
  }
}

/**
 * How many straight pieces a cubic should be flattened into.
 *
 * Scaled by the control polygon's length so a long sweep gets more pieces than
 * a short one, and clamped so a pathological curve cannot generate thousands of
 * vertices for a hit test.
 */
export function cubicSubdivisions(segment: CubicSegment): number {
  const d =
    dist(segment.start, segment.cp1) + dist(segment.cp1, segment.cp2) + dist(segment.cp2, segment.end)
  return Math.max(4, Math.min(64, Math.ceil(d / 8)))
}

function dist(a: VecLike, b: VecLike): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
