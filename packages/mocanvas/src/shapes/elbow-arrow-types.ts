/**
 * The elbow arrow's *model*: the boxes, edges and ranges a route is chosen
 * from, and the route once it has been chosen.
 *
 * `elbow-helpers.ts` answers the narrow question "given two points and two
 * axes, what is the polyline?". This module answers the wider one an arrow
 * bound to two shapes actually asks: *which side of each shape should the
 * arrow leave and enter, and where along that side?* The answer needs the two
 * shapes' boxes, each box grown by the distance an arrow is kept clear of it,
 * the span of each edge an arrow may attach anywhere along, and the corridor
 * between the two boxes that a middle leg can slide in.
 *
 * SEMANTICS-ASSUMED throughout. The published docs name these types but do not
 * list their members, and the clean-room rule forbids reading the reference
 * implementation. The shapes below are what the routing this library already
 * performs actually needs, named after the documented types; where a choice was
 * free it went to the reading that keeps the route stable as a shape is
 * dragged, because a routing that flips between two equally good answers on
 * every frame is the failure mode that matters.
 */

import { Box, Vec, type VecLike } from "@mocanvas/editor"
import { getElbowRoute, type ElbowAxis, type ElbowRoute, type ElbowRouteOptions } from "./elbow-helpers"

/** Which side of a box an elbow arrow attaches to. */
export type ElbowArrowSide = "top" | "right" | "bottom" | "left"

/** The four sides, in clockwise order from the top. */
export const ELBOW_ARROW_SIDES: readonly ElbowArrowSide[] = ["top", "right", "bottom", "left"]

/** The axis a leg attached to `side` runs along. */
export function getElbowArrowSideAxis(side: ElbowArrowSide): ElbowAxis {
  return side === "left" || side === "right" ? "x" : "y"
}

/** A closed span on one axis, in page units. `min` is always `<= max`. */
export interface ElbowArrowRange {
  min: number
  max: number
}

/**
 * One side of a box, as the router sees it.
 *
 * `value` is where the side sits on its own axis (a left or right edge has an
 * x, a top or bottom edge has a y); `cross` is how far the attachment point may
 * slide along the side, and `crossTarget` is where it would like to sit — the
 * centre, unless a bound anchor asked for somewhere else. `expanded` is `value`
 * pushed outwards by {@link ElbowArrowOptions.expandDistance}, which is where a
 * leg parallel to the side is allowed to run, or `null` when the side may not
 * be expanded because the other box is already inside that margin.
 */
export interface ElbowArrowEdge {
  value: number
  cross: ElbowArrowRange
  crossTarget: number
  expanded: number | null
}

/** A box's four sides, keyed by side. A side is `null` when nothing may attach to it. */
export interface ElbowArrowBoxEdges {
  top: ElbowArrowEdge | null
  right: ElbowArrowEdge | null
  bottom: ElbowArrowEdge | null
  left: ElbowArrowEdge | null
}

/**
 * A box the router works with, in both the sizes it needs: the shape's own
 * bounds, and those bounds grown by the clearance an arrow keeps from them.
 */
export interface ElbowArrowBox {
  /** The shape's bounds, in the arrow's space. */
  original: Box
  /** {@link ElbowArrowBox.original} grown by {@link ElbowArrowOptions.expandDistance}. */
  expanded: Box
}

/**
 * One end of an elbow arrow: the box it attaches to, plus how it may attach.
 *
 * A terminal that is not bound to anything is still a target box — a
 * zero-sized one at the terminal's point, with `isPoint` set — so the router
 * has one shape of input rather than two.
 */
export interface ElbowArrowTargetBox extends ElbowArrowBox {
  edges: ElbowArrowBoxEdges
  /** The point the arrow aims at: the anchor if bound, else the box's centre. */
  target: Vec
  /** Whether this end is a bare point rather than a bound shape. */
  isPoint: boolean
  /** Whether the terminal must land exactly on {@link ElbowArrowTargetBox.target}. */
  isExact: boolean
}

/**
 * The two ends and the space they share.
 *
 * `common` is the union of the two expanded boxes: the region the whole route
 * is contained in, which is what a caller culls and hit-tests against.
 */
export interface ElbowArrowBoxes {
  A: ElbowArrowTargetBox
  B: ElbowArrowTargetBox
  common: ElbowArrowBox
}

/** How much room an elbow arrow gives itself. */
export interface ElbowArrowOptions {
  /** How far outside a bound shape a leg parallel to it runs. */
  expandDistance: number
  /** The shortest leg the router will emit; shorter ones are absorbed into their neighbours. */
  minElbowLegLength: number
  /** How close to a corner an arrow may attach, as a fraction of the side's length, `0..0.5`. */
  minArrowDistanceFromCorner: number
  /** Corner fillet radius, before the per-corner clamp {@link roundElbowCorners} applies. */
  cornerRadius: number
}

/**
 * The defaults, in page units.
 *
 * SEMANTICS-ASSUMED: `expandDistance` is a little over the widest default
 * stroke so an arrow beside a shape never overlaps it; `minElbowLegLength` is
 * large enough that a fillet at each end of a leg cannot swallow it whole.
 */
export const DEFAULT_ELBOW_ARROW_OPTIONS: ElbowArrowOptions = {
  expandDistance: 16,
  minElbowLegLength: 24,
  minArrowDistanceFromCorner: 0.15,
  cornerRadius: 12,
}

/**
 * The handle that slides an elbow's middle leg.
 *
 * `axis` is the axis the leg *slides along*, `point` is where the handle sits
 * now, and `range` is how far it may travel — the corridor between the two
 * boxes, so a dragged handle cannot be pushed inside either shape.
 */
export interface ElbowArrowMidpointHandle {
  axis: ElbowAxis
  point: Vec
  range: ElbowArrowRange
}

/**
 * A routed elbow: the polyline, and everything a caller needs to describe it.
 *
 * `name` identifies which of the router's cases produced it (`"hvh"`, `"vh"`,
 * `"straight"`, …). It is not decoration: when two candidate routes are the
 * same length the name is the tie-break, and keeping the previous frame's name
 * is what stops a route flipping between two equally good answers while a
 * shape is dragged.
 */
export interface ElbowArrowRoute {
  name: string
  /** The drawn polyline, corners already filleted. */
  points: Vec[]
  /** The corner points before filleting — what a handle or a hit test wants. */
  corners: Vec[]
  /** Total length of the un-filleted route; the router's cost function. */
  distance: number
  /** The side of `A` the arrow leaves, or `null` when `A` is a bare point. */
  aEdge: ElbowArrowSide | null
  /** The side of `B` the arrow enters, or `null` when `B` is a bare point. */
  bEdge: ElbowArrowSide | null
  midpointHandle: ElbowArrowMidpointHandle | null
}

/** Everything the router derived, before it picked a route. */
export interface ElbowArrowInfoWithoutRoute {
  options: ElbowArrowOptions
  A: ElbowArrowTargetBox
  B: ElbowArrowTargetBox
  common: ElbowArrowBox
  /** The x a vertical middle leg would sit at, or `null` when the boxes overlap on x. */
  midX: number | null
  /** The y a horizontal middle leg would sit at, or `null` when the boxes overlap on y. */
  midY: number | null
  /** The clear gap between the two expanded boxes on each axis; `0` when they overlap. */
  gapX: number
  gapY: number
}

/** {@link ElbowArrowInfoWithoutRoute} plus the route that was picked. */
export interface ElbowArrowInfo extends ElbowArrowInfoWithoutRoute {
  /** `null` when the two ends are so close that no elbow can be drawn between them. */
  route: ElbowArrowRoute | null
}

/**
 * The elbow member of the arrow-info union — what `getArrowInfo` returns for
 * an arrow whose `kind` is `"elbow"`, alongside the arc and straight members.
 */
export interface TLElbowArrowInfo {
  /** Discriminates this from the arc and straight members. */
  type: "elbow"
  /** The start terminal in the arrow's own space, after binding resolution. */
  start: VecLike
  /** The end terminal in the arrow's own space, after binding resolution. */
  end: VecLike
  /** The routed body. */
  route: ElbowArrowRoute
  /** Whether the arrow could be routed at all; a degenerate arrow is not drawn. */
  isValid: boolean
}

/* ---- building the model -------------------------------------------------- */

function range(a: number, b: number): ElbowArrowRange {
  return a <= b ? { min: a, max: b } : { min: b, max: a }
}

/** Whether `value` lies inside `span`, inclusive. */
export function isInElbowArrowRange(span: ElbowArrowRange, value: number): boolean {
  return value >= span.min && value <= span.max
}

/**
 * The four sides of `box` as the router sees them.
 *
 * `target` is the point the arrow aims at — the bound anchor, or the centre —
 * and it is what each side's `crossTarget` is pulled towards, clamped away
 * from the corners by {@link ElbowArrowOptions.minArrowDistanceFromCorner} so
 * an arrow never appears to attach to a corner rather than to a side.
 */
export function getElbowArrowBoxEdges(
  box: Box,
  target: VecLike = box.center,
  options: ElbowArrowOptions = DEFAULT_ELBOW_ARROW_OPTIONS,
): ElbowArrowBoxEdges {
  const inset = options.minArrowDistanceFromCorner
  const clampX = (value: number): number => {
    const margin = box.width * inset
    return Math.min(Math.max(value, box.minX + margin), box.maxX - margin)
  }
  const clampY = (value: number): number => {
    const margin = box.height * inset
    return Math.min(Math.max(value, box.minY + margin), box.maxY - margin)
  }
  const expand = options.expandDistance
  return {
    top: { value: box.minY, cross: range(box.minX, box.maxX), crossTarget: clampX(target.x), expanded: box.minY - expand },
    bottom: { value: box.maxY, cross: range(box.minX, box.maxX), crossTarget: clampX(target.x), expanded: box.maxY + expand },
    left: { value: box.minX, cross: range(box.minY, box.maxY), crossTarget: clampY(target.y), expanded: box.minX - expand },
    right: { value: box.maxX, cross: range(box.minY, box.maxY), crossTarget: clampY(target.y), expanded: box.maxX + expand },
  }
}

/** Grow `box` by `distance` on every side. */
function expandBox(box: Box, distance: number): Box {
  return Box.FromMinMax(box.minX - distance, box.minY - distance, box.maxX + distance, box.maxY + distance)
}

/**
 * One end of an arrow as a target box.
 *
 * Pass a `Box` for a bound terminal and a point for a free one; a free terminal
 * becomes a zero-sized box at that point, with `isPoint` set, so the router has
 * one kind of input to reason about.
 */
export function getElbowArrowTargetBox(
  boxOrPoint: Box | VecLike,
  options: ElbowArrowOptions = DEFAULT_ELBOW_ARROW_OPTIONS,
  extra: { target?: VecLike; isExact?: boolean } = {},
): ElbowArrowTargetBox {
  const isPoint = !(boxOrPoint instanceof Box)
  const original = isPoint
    ? Box.FromMinMax(boxOrPoint.x, boxOrPoint.y, boxOrPoint.x, boxOrPoint.y)
    : (boxOrPoint as Box)
  const target = Vec.From(extra.target ?? original.center)
  return {
    original,
    expanded: expandBox(original, options.expandDistance),
    edges: isPoint ? { top: null, right: null, bottom: null, left: null } : getElbowArrowBoxEdges(original, target, options),
    target,
    isPoint,
    isExact: extra.isExact ?? false,
  }
}

/** The two ends and their union; see {@link ElbowArrowBoxes}. */
export function getElbowArrowBoxes(A: ElbowArrowTargetBox, B: ElbowArrowTargetBox): ElbowArrowBoxes {
  const union = (a: Box, b: Box): Box => Box.FromMinMax(Math.min(a.minX, b.minX), Math.min(a.minY, b.minY), Math.max(a.maxX, b.maxX), Math.max(a.maxY, b.maxY))
  return { A, B, common: { original: union(A.original, B.original), expanded: union(A.expanded, B.expanded) } }
}

/** Which side of `box` the point `to` sits off, or `null` when it is inside. */
export function getElbowArrowSideTowards(box: Box, to: VecLike): ElbowArrowSide | null {
  const dx = to.x < box.minX ? to.x - box.minX : to.x > box.maxX ? to.x - box.maxX : 0
  const dy = to.y < box.minY ? to.y - box.minY : to.y > box.maxY ? to.y - box.maxY : 0
  if (dx === 0 && dy === 0) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right"
  return dy < 0 ? "top" : "bottom"
}

/** The un-filleted length of a corner list. */
function routeDistance(corners: readonly Vec[]): number {
  let total = 0
  for (let i = 1; i < corners.length; i++) total += Vec.Dist(corners[i - 1]!, corners[i]!)
  return total
}

/**
 * Lift the polyline `elbow-helpers` produced into the documented route shape.
 *
 * `name` is the router's case: `"hvh"` and `"vhv"` for the three-leg routes,
 * `"hv"` and `"vh"` for the two-leg ones, `"straight"` when the terminals line
 * up. It is derived from the corners rather than passed in, so a route and its
 * name can never disagree.
 */
export function toElbowArrowRoute(
  route: ElbowRoute,
  ends: { aEdge?: ElbowArrowSide | null; bEdge?: ElbowArrowSide | null; range?: ElbowArrowRange } = {},
): ElbowArrowRoute {
  const legs: string[] = []
  for (let i = 1; i < route.corners.length; i++) {
    const a = route.corners[i - 1]!
    const b = route.corners[i]!
    legs.push(Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "h" : "v")
  }
  const midLeg = route.midLeg
  return {
    name: legs.length <= 1 ? "straight" : legs.join(""),
    points: route.points,
    corners: route.corners,
    distance: routeDistance(route.corners),
    aEdge: ends.aEdge ?? null,
    bEdge: ends.bEdge ?? null,
    midpointHandle:
      midLeg && route.slideAxis
        ? {
            axis: route.slideAxis,
            point: Vec.Med(midLeg[0], midLeg[1]),
            range: ends.range ?? range(route.corners[0]![route.slideAxis], route.corners.at(-1)![route.slideAxis]),
          }
        : null,
  }
}

/**
 * Route an elbow arrow between two ends, and report everything the routing was
 * derived from.
 *
 * The route itself still comes from {@link getElbowRoute}: this adds the side
 * picking (which edge of each box the arrow leaves and enters) and the gaps
 * that decide where a middle leg may sit.
 */
export function getElbowArrowInfo(
  A: ElbowArrowTargetBox,
  B: ElbowArrowTargetBox,
  options: ElbowArrowOptions = DEFAULT_ELBOW_ARROW_OPTIONS,
  routeOptions: Pick<ElbowRouteOptions, "midPoint"> = {},
): ElbowArrowInfo {
  const boxes = getElbowArrowBoxes(A, B)
  const gapX = Math.max(0, Math.max(B.expanded.minX - A.expanded.maxX, A.expanded.minX - B.expanded.maxX))
  const gapY = Math.max(0, Math.max(B.expanded.minY - A.expanded.maxY, A.expanded.minY - B.expanded.maxY))
  // A middle leg only has somewhere to sit when the two boxes are clear of each
  // other on that axis; where they overlap, running a leg down the middle would
  // put it inside one of the shapes.
  const midX = gapX > 0 ? (Math.max(A.expanded.minX, B.expanded.minX) + Math.min(A.expanded.maxX, B.expanded.maxX)) / 2 : null
  const midY = gapY > 0 ? (Math.max(A.expanded.minY, B.expanded.minY) + Math.min(A.expanded.maxY, B.expanded.maxY)) / 2 : null

  const aEdge = A.isPoint ? null : getElbowArrowSideTowards(A.original, B.target)
  const bEdge = B.isPoint ? null : getElbowArrowSideTowards(B.original, A.target)
  const routed = getElbowRoute(A.target, B.target, {
    ...(routeOptions.midPoint === undefined ? {} : { midPoint: routeOptions.midPoint }),
    ...(aEdge ? { startAxis: getElbowArrowSideAxis(aEdge) } : {}),
    ...(bEdge ? { endAxis: getElbowArrowSideAxis(bEdge) } : {}),
    cornerRadius: options.cornerRadius,
  })
  const degenerate = Vec.Dist(A.target, B.target) < 1e-6
  return {
    options,
    A,
    B,
    common: boxes.common,
    midX,
    midY,
    gapX,
    gapY,
    route: degenerate ? null : toElbowArrowRoute(routed, { aEdge, bEdge }),
  }
}
