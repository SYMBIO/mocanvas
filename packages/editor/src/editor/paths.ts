/**
 * Turning points into SVG path data, and making a dashed stroke land on whole
 * dashes.
 *
 * Both are shared between the canvas renderer, the SVG exporter and any shape
 * util that draws its own outline, which is why they live here rather than
 * inside one of them: a dash pattern computed differently in the exporter than
 * on screen is a picture that does not match what the person drew.
 */
import type { VecLike } from "../geometry"

/**
 * SVG path data through a list of points.
 *
 * With `closed`, the path is closed with `Z`, which is not the same as
 * repeating the first point: only `Z` makes the join at the start a proper
 * corner rather than two overlapping line caps.
 *
 * Coordinates are rounded to two decimals. At canvas scale that is far below a
 * device pixel, and it keeps an exported path from being three times longer
 * than it needs to be because of float dust.
 */
export function getSvgPathFromPoints(points: readonly VecLike[], closed = true): string {
  const length = points.length
  if (length === 0) return ""

  const first = points[0]!
  if (length === 1) {
    // A single point still has to draw something: a zero-length line with a
    // round cap is the dot a one-point stroke should be.
    return `M${round(first.x)},${round(first.y)}L${round(first.x)},${round(first.y)}`
  }

  let d = `M${round(first.x)},${round(first.y)}`
  for (let i = 1; i < length; i++) {
    const point = points[i]!
    d += `L${round(point.x)},${round(point.y)}`
  }
  return closed ? `${d}Z` : d
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * How a dashed stroke behaves at one end of an open path.
 *
 * - `none` — start the pattern exactly at the end.
 * - `outset` — start half a gap early, so the line begins with a full dash
 *   sitting proud of the endpoint. What an arrow's tail wants.
 * - `skip` — leave the first gap empty, so the stroke starts a dash in. What
 *   the end abutting an arrowhead wants, so the dash does not collide with it.
 */
export type PerfectDashTerminal = "none" | "outset" | "skip"

/** Options for {@link getPerfectDashProps}. */
export interface PerfectDashOptions {
  /** The dash style being drawn. Anything but `dashed`/`dotted` returns a solid stroke. */
  style?: "solid" | "dashed" | "dotted" | "draw" | (string & {})
  /** Dash length as a multiple of the stroke width. Defaults to 4 dashed, 100 dotted. */
  lengthRatio?: number
  /** How the pattern meets the start of an open path. */
  start?: PerfectDashTerminal
  /** How it meets the end. */
  end?: PerfectDashTerminal
  /** Snap the dash count to a multiple of this. `4` keeps a closed shape symmetric. */
  snap?: number
  /** Whether the path is closed, in which case both terminals are ignored. */
  closed?: boolean
  /** Return a solid stroke regardless of style — for a zoom level where dashes are noise. */
  forceSolid?: boolean
}

/** What SVG needs to draw the pattern. */
export interface PerfectDashProps {
  strokeDasharray: string
  strokeDashoffset: string
}

const SOLID: PerfectDashProps = { strokeDasharray: "none", strokeDashoffset: "none" }

/**
 * A dash pattern that divides evenly into the length it has to cover.
 *
 * The problem this solves: CSS `stroke-dasharray` is an absolute length, so a
 * pattern applied to an arbitrary path almost always ends mid-dash. On a
 * rectangle that shows up as a stub at one corner and a visible seam; on a
 * circle it is worse, because the seam moves as the shape is resized.
 *
 * So the dash length is *derived* from the path: a target ratio is chosen, the
 * number of whole dashes that fits is computed and rounded, and the dash and
 * gap are stretched to make that count exact. The stroke then always ends on a
 * whole dash.
 *
 * `strokeWidth` is in the same units as `length` — page units on the canvas,
 * so a caller drawing at a fixed screen size passes `1 / zoom`.
 */
export function getPerfectDashProps(
  length: number,
  strokeWidth: number,
  opts: PerfectDashOptions = {},
): PerfectDashProps {
  const { style = "dashed", snap = 1, start = "outset", end = "outset", closed = false, forceSolid = false } = opts

  if (forceSolid || (style !== "dashed" && style !== "dotted")) return SOLID
  if (!(length > 0) || !(strokeWidth > 0)) return SOLID

  const lengthRatio = opts.lengthRatio ?? (style === "dotted" ? 100 : 4)
  const ratio = 1

  let dashLength = style === "dotted" ? strokeWidth / 100 : strokeWidth * lengthRatio
  // A dash longer than the line it is on is just a solid line, drawn expensively.
  if (dashLength > length / 2) dashLength = length / 2

  let dashCount = Math.floor(length / dashLength / (2 * ratio))
  // `snap` keeps a closed shape symmetric: four corners want a dash count
  // divisible by four, or one corner ends up different from the other three.
  dashCount -= dashCount % snap
  if (dashCount < 3 && style === "dashed") return SOLID
  if (dashCount === 0) {
    if (style !== "dotted") return SOLID
    dashCount = 1
  }

  let ratioAdjustedGapLength = ratio
  let currentGapLength = (length - dashCount * dashLength) / dashCount
  if (!closed) {
    // An open path has one more gap than a closed one only when both ends
    // outset; each end that does not adds a half-gap of its own to account for.
    const startOffset = start === "outset" ? 0.5 : start === "skip" ? -0.5 : 0
    const endOffset = end === "outset" ? 0.5 : end === "skip" ? -0.5 : 0
    const gaps = Math.max(1, dashCount - 1 + startOffset + endOffset)
    currentGapLength = (length - dashCount * dashLength) / gaps
  }
  ratioAdjustedGapLength = currentGapLength

  const offset = closed || start === "none" ? 0 : start === "outset" ? -dashLength / 2 : dashLength / 2

  return {
    strokeDasharray: [round2(dashLength), round2(Math.max(0, ratioAdjustedGapLength))].join(" "),
    strokeDashoffset: String(round2(offset)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
