/**
 * Everything about an arrow that is derived rather than stored.
 *
 * An arrow's record holds terminals in its own space and a bend; where the
 * arrow *actually* starts and ends depends on what it is bound to, how big
 * those shapes are right now, and how much of the body the arrowheads take up.
 * `getArrowInfo` resolves all of that once, and the geometry, the renderer, the
 * indicator and the label placement all read the same answer — which is what
 * keeps a bound arrow's outline and its paint from disagreeing.
 *
 * It is a free function taking the editor rather than a method on the shape
 * util because a tool needs it before the shape exists.
 */

import { Vec, type Editor, type ShapeId, type VecLike } from "@mocanvas/editor"
import { getArrowBody, getArrowheadInset, getArrowheadLength, getBodyLength, shortenBody, type ArcBody, type ArrowBody } from "../shapes/arrow-helpers"
import type { ElbowArrowRoute, TLElbowArrowInfo } from "../shapes/elbow-arrow-types"
import { getElbowBody, getElbowRoute } from "../shapes/elbow-helpers"
import type { ArrowShape } from "../shapes/ArrowShapeUtil"
import { getArrowTerminalsInArrowSpace, type ArrowBindings } from "./arrow-terminals"
import { getArrowBindings } from "./arrow-terminals"

/** One end of an arrow: where the handle sits, where the line stops, and what is drawn there. */
export interface TLArrowPoint {
  /** The arrowhead style drawn at this end. */
  arrowhead: ArrowShape["props"]["arrowheadStart"]
  /** Where the draggable handle sits — the terminal itself, unshortened. */
  handle: VecLike
  /** Where the body actually stops, pulled back to make room for the arrowhead. */
  point: VecLike
}

/** A circular arc, in the form an SVG `A` command and a length query both need. */
export interface TLArcInfo {
  center: VecLike
  /** `1` when the arc takes the long way round; SVG's own flag, as a number. */
  largeArcFlag: number
  /** Arc length, in the arrow's own units. */
  length: number
  radius: number
  /** The swept angle, in radians. Signed: negative sweeps anticlockwise. */
  size: number
  /** `1` when the arc sweeps clockwise; SVG's own flag, as a number. */
  sweepFlag: number
}

/** A straight arrow, resolved. */
export interface TLStraightArrowInfo {
  type: "straight"
  bindings: ArrowBindings
  start: TLArrowPoint
  end: TLArrowPoint
  /** The midpoint of the body — where the label sits by default. */
  middle: VecLike
  /** The body's length, after the arrowheads have been made room for. */
  length: number
  /** Whether the arrow has enough body left to draw. */
  isValid: boolean
}

/** A bowed arrow, resolved. */
export interface TLArcArrowInfo {
  type: "arc"
  bindings: ArrowBindings
  /** The arc the *body* is drawn along, after shortening for arrowheads. */
  bodyArc: TLArcInfo
  /** The arc through the *handles*, which is what the bend handle is dragged along. */
  handleArc: TLArcInfo
  start: TLArrowPoint
  end: TLArrowPoint
  middle: VecLike
  isValid: boolean
}

/** A resolved arrow, discriminated by how its body is routed. */
export type TLArrowInfo = TLArcArrowInfo | TLElbowArrowInfo | TLStraightArrowInfo

/** An arc body as {@link TLArcInfo}. */
function arcInfo(body: ArcBody): TLArcInfo {
  const size = body.sweep
  return {
    center: body.center,
    radius: body.radius,
    size,
    length: Math.abs(size) * body.radius,
    largeArcFlag: Math.abs(size) > Math.PI ? 1 : 0,
    sweepFlag: size > 0 ? 1 : 0,
  }
}

/**
 * Resolve an arrow to the geometry everything downstream draws from.
 *
 * Returns `undefined` for a shape that is not an arrow, so a caller can pass
 * whatever it has selected.
 */
export function getArrowInfo(editor: Editor, shape: ArrowShape | ShapeId): TLArrowInfo | undefined {
  const arrow = typeof shape === "string" ? editor.getShape<ArrowShape>(shape) : shape
  if (!arrow || arrow.type !== "arrow") return undefined

  const bindings = getArrowBindings(editor, arrow)
  const terminals = getArrowTerminalsInArrowSpace(editor, arrow)
  const start = Vec.From(terminals.start)
  const end = Vec.From(terminals.end)

  // The routing kind decides the body: `"elbow"` ignores `bend` entirely, and
  // `"arc"` with no bend is a straight line, which is what `getArrowBody`
  // already reports.
  const handleBody: ArrowBody =
    arrow.props.kind === "elbow"
      ? getElbowBody(start, end, { midPoint: arrow.props.elbowMidPoint })
      : getArrowBody(start, end, arrow.props.bend)
  const bodyLength = getBodyLength(handleBody)

  // Each arrowhead eats into the body from its own end. Computing the inset
  // from the *whole* body length rather than from each half is what keeps a
  // short arrow from having its two arrowheads overlap in the middle.
  const strokeWidth = 2
  const headLength = getArrowheadLength(strokeWidth, bodyLength)
  const startInset = getArrowheadInset(arrow.props.arrowheadStart, headLength)
  const endInset = getArrowheadInset(arrow.props.arrowheadEnd, headLength)
  const shortened = shortenBody(handleBody, startInset, endInset)

  const isValid = bodyLength - startInset - endInset > 0

  if (shortened.kind === "arc" && handleBody.kind === "arc") {
    const bodyArc = arcInfo(shortened)
    const handleArc = arcInfo(handleBody)
    const startPoint = pointOnArc(shortened, 0)
    const endPoint = pointOnArc(shortened, 1)
    return {
      type: "arc",
      bindings,
      bodyArc,
      handleArc,
      start: { arrowhead: arrow.props.arrowheadStart, handle: start, point: startPoint },
      end: { arrowhead: arrow.props.arrowheadEnd, handle: end, point: endPoint },
      middle: pointOnArc(shortened, 0.5),
      isValid,
    }
  }

  if (handleBody.kind === "elbow") {
    const routed = getElbowRoute(start, end, { midPoint: arrow.props.elbowMidPoint })
    const route: ElbowArrowRoute = {
      name: "free",
      points: routed.points,
      corners: routed.corners,
      distance: getBodyLength(handleBody),
      // A free-terminal route leaves and enters bare points, so neither end
      // sits on a box edge; a bound elbow's edges come from the router in
      // `elbow-arrow-types`, which knows the boxes.
      aEdge: null,
      bEdge: null,
      midpointHandle: null,
    }
    return { type: "elbow", start, end, route, isValid }
  }

  const straightStart = shortened.kind === "straight" ? shortened.start : start
  const straightEnd = shortened.kind === "straight" ? shortened.end : end
  return {
    type: "straight",
    bindings,
    start: { arrowhead: arrow.props.arrowheadStart, handle: start, point: straightStart },
    end: { arrowhead: arrow.props.arrowheadEnd, handle: end, point: straightEnd },
    middle: Vec.Lrp(straightStart, straightEnd, 0.5),
    length: Vec.Dist(straightStart, straightEnd),
    isValid,
  }
}

/** The point `t` of the way along an arc body. */
function pointOnArc(body: ArcBody, t: number): Vec {
  const angle = body.startAngle + body.sweep * t
  return new Vec(body.center.x + Math.cos(angle) * body.radius, body.center.y + Math.sin(angle) * body.radius)
}
