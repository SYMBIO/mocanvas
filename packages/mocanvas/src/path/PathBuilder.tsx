/**
 * A chainable description of a shape's outline.
 *
 * `PathBuilder` is the authoring surface a custom geo type uses to say what it
 * looks like:
 *
 * ```ts
 * new PathBuilder()
 *   .moveTo(r, 0, { geometry: { isFilled: true } })
 *   .lineTo(w - r, 0)
 *   .circularArcTo(r, false, true, w, r)
 *   .close()
 * ```
 *
 * What makes it worth having over a raw `d` string is that one path answers
 * every question the canvas asks of an outline. `toGeometry()` gives the
 * hit-testable geometry, `toD()` the SVG attribute, `toPath2D()` something the
 * overlay layer can stroke, `toSvg()` a rendered element, and `toDrawD()` the
 * same outline redrawn with a hand-drawn wobble. All of them read the same
 * command list, so a shape cannot end up hit-testing one outline and painting
 * another.
 *
 * @see {@link PathBuilderGeometry2d} for one run of a path as geometry.
 */

import { Group2d, Mat, Vec, type Geometry2dOptions, type MatLike, type VecLike } from "@mocanvas/editor"
import type { JSX, SVGProps } from "react"
import { arcToCubicSegments, type PathBuilderCommand, type PathBuilderCommandOpts, type PathBuilderLineOpts } from "./commands"
import { PathBuilderGeometry2d, runIsClosed, segmentsOfRun, type PathRunSegment } from "./PathBuilderGeometry2d"

export type { PathBuilderCommand, PathBuilderCommandOpts, PathBuilderLineOpts, PathDashTerminal } from "./commands"

/** What every rendering of a path needs, whatever its style. */
export interface BasePathBuilderOpts {
  /** Ignore the style and draw one solid stroke — what a tiny shape or a print export wants. */
  forceSolid?: boolean
  /** Emit only the runs that asked for a fill, dropping stroke-only runs. */
  onlyFilled?: boolean
  /** Extra attributes for the element {@link PathBuilder.toSvg} returns. */
  props?: SVGProps<SVGPathElement & SVGGElement>
  /** Stroke width, in the path's own units. Dash lengths and draw jitter scale off it. */
  strokeWidth: number
}

/** Draw the path as one continuous stroke. */
export interface SolidPathBuilderOpts extends BasePathBuilderOpts {
  style: "solid"
}

/** Do not stroke the path at all; a fill (when the run asked for one) still paints. */
export interface NonePathBuilderOpts extends BasePathBuilderOpts {
  style: "none"
}

/** Draw the path as evenly spaced dashes or dots. */
export interface DashedPathBuilderOpts extends BasePathBuilderOpts {
  style: "dashed" | "dotted"
  /** Terminal treatment for the last dash of each run. */
  end?: import("./commands").PathDashTerminal
  /** Dash length as a multiple of the stroke width. */
  lengthRatio?: number
  /** Round the gap so a whole number of dashes fits the run exactly. */
  snap?: number
  /** Terminal treatment for the first dash of each run. */
  start?: import("./commands").PathDashTerminal
}

/** The inputs {@link PathBuilder.toDrawD} needs to reproduce one hand-drawn pass. */
export interface DrawPathBuilderDOpts {
  /** How far a point may wander, in stroke widths. */
  offset?: number
  /** How many overlapping passes to draw; two reads as a pen gone over twice. */
  passes?: number
  /** Seeds the jitter, so the same path redraws identically between frames. */
  randomSeed: string
  /** How much to round the corners between segments. */
  roundness?: number
}

/** Draw the path with a hand-drawn wobble. */
export interface DrawPathBuilderOpts extends BasePathBuilderOpts, DrawPathBuilderDOpts {
  style: "draw"
}

/** Every way a path can be rendered, as a discriminated union on `style`. */
export type PathBuilderOpts = DashedPathBuilderOpts | DrawPathBuilderOpts | NonePathBuilderOpts | SolidPathBuilderOpts

/** Which part of a path {@link PathBuilder.toD} should write. */
export interface PathBuilderToDOpts {
  /** Last command index, exclusive. Defaults to the end of the path. */
  endIdx?: number
  /** Write only the runs that asked for a fill. */
  onlyFilled?: boolean
  /** First command index. Defaults to `0`. */
  startIdx?: number
}

/** The half-open command range of one run, and whether that run is filled. */
interface PathRun {
  startIdx: number
  endIdx: number
  opts: PathBuilderLineOpts
}

const DEFAULT_DASH_LENGTH_RATIO = 2
const DEFAULT_DOT_LENGTH_RATIO = 0.1
const DEFAULT_DRAW_OFFSET = 0.5
const DEFAULT_DRAW_PASSES = 1

export class PathBuilder {
  /** The commands recorded so far, in order. Read by {@link PathBuilderGeometry2d}. */
  readonly commands: PathBuilderCommand[] = []

  /**
   * A path through `points`, one straight segment at a time.
   *
   * `endOffsets` pulls both ends back along their own segment by that many
   * units — the way an arrow's shaft stops short of the shapes it binds.
   */
  static lineThroughPoints(points: VecLike[], opts: PathBuilderLineOpts & { endOffsets?: number } = {}): PathBuilder {
    const path = new PathBuilder()
    const trimmed = trimEnds(points, opts.endOffsets ?? 0)
    const head = trimmed[0]
    if (!head) return path
    path.moveTo(head.x, head.y, opts)
    for (let i = 1; i < trimmed.length; i++) path.lineTo(trimmed[i]!.x, trimmed[i]!.y, opts)
    return path
  }

  /**
   * A smooth path through `points`, as a Catmull-Rom spline converted to cubics.
   *
   * The curve passes *through* every point rather than being pulled towards it,
   * which is what a freehand line or a curved arrow needs: the points are
   * samples of the intended shape, not control handles.
   */
  static cubicSplineThroughPoints(points: VecLike[], opts: PathBuilderLineOpts & { endOffsets?: number } = {}): PathBuilder {
    const path = new PathBuilder()
    const p = trimEnds(points, opts.endOffsets ?? 0)
    const head = p[0]
    if (!head) return path
    path.moveTo(head.x, head.y, opts)
    if (p.length === 1) return path
    if (p.length === 2) {
      path.lineTo(p[1]!.x, p[1]!.y, opts)
      return path
    }
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] ?? p[i]!
      const p1 = p[i]!
      const p2 = p[i + 1]!
      const p3 = p[i + 2] ?? p2
      // Catmull-Rom → Bézier, at the uniform tension the canvas uses elsewhere.
      path.cubicBezierTo(
        p2.x,
        p2.y,
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        opts,
      )
    }
    return path
  }

  /** Lift the pen and start a new run at `(x, y)`. */
  moveTo(x: number, y: number, opts: PathBuilderLineOpts = {}): this {
    this.commands.push({ type: "move", x, y, opts })
    return this
  }

  /** Straight segment from the cursor to `(x, y)`. */
  lineTo(x: number, y: number, opts: PathBuilderCommandOpts = {}): this {
    this.commands.push({ type: "line", x, y, opts })
    return this
  }

  /** Cubic bézier from the cursor to `(x, y)` through `cp1` and `cp2`. */
  cubicBezierTo(x: number, y: number, cp1X: number, cp1Y: number, cp2X: number, cp2Y: number, opts: PathBuilderCommandOpts = {}): this {
    this.commands.push({ type: "cubic", x, y, cp1X, cp1Y, cp2X, cp2Y, opts })
    return this
  }

  /** SVG-style elliptical arc from the cursor to `(x2, y2)`. */
  arcTo(
    rx: number,
    ry: number,
    largeArcFlag: boolean,
    sweepFlag: boolean,
    xAxisRotationRadians: number,
    x2: number,
    y2: number,
    opts: PathBuilderCommandOpts = {},
  ): this {
    this.commands.push({ type: "arc", rx, ry, largeArcFlag, sweepFlag, xAxisRotationRadians, x: x2, y: y2, opts })
    return this
  }

  /** The circular case of {@link PathBuilder.arcTo}: one radius, no rotation. */
  circularArcTo(radius: number, largeArcFlag: boolean, sweepFlag: boolean, x2: number, y2: number, opts: PathBuilderCommandOpts = {}): this {
    return this.arcTo(radius, radius, largeArcFlag, sweepFlag, 0, x2, y2, opts)
  }

  /** Join the current run back to where it started. */
  close(): this {
    this.commands.push({ type: "close" })
    return this
  }

  /** The runs this path is made of, as half-open command ranges. */
  getRuns(): PathRun[] {
    const runs: PathRun[] = []
    let current: PathRun | null = null
    for (let i = 0; i < this.commands.length; i++) {
      const command = this.commands[i]!
      if (command.type === "move") {
        if (current) runs.push(current)
        current = { startIdx: i, endIdx: i + 1, opts: command.opts }
      } else if (current) {
        current.endIdx = i + 1
      }
    }
    if (current) runs.push(current)
    return runs
  }

  /**
   * This path as shape geometry: one {@link PathBuilderGeometry2d} per run, or
   * a `Group2d` when there is more than one.
   *
   * A run whose `geometry` option is `false` contributes nothing — it is
   * painted but never hit.
   */
  toGeometry(): Group2d | PathBuilderGeometry2d {
    const children: PathBuilderGeometry2d[] = []
    for (const run of this.getRuns()) {
      if (run.opts.geometry === false) continue
      const geometry: Omit<Geometry2dOptions, "isClosed"> = run.opts.geometry ?? { isFilled: false }
      children.push(
        new PathBuilderGeometry2d(this, run.startIdx, run.endIdx, {
          ...geometry,
          isFilled: geometry.isFilled,
          isClosed: runIsClosed(this.commands, run.startIdx, run.endIdx),
        }),
      )
    }
    if (children.length === 1) return children[0]!
    return new Group2d({ children, isLabel: false })
  }

  /** This path as an SVG `d` attribute. */
  toD(opts: PathBuilderToDOpts = {}): string {
    const startIdx = opts.startIdx ?? 0
    const endIdx = opts.endIdx ?? this.commands.length
    const parts: string[] = []
    for (const run of this.getRuns()) {
      if (run.endIdx <= startIdx || run.startIdx >= endIdx) continue
      const geometry = run.opts.geometry
      if (opts.onlyFilled && !(geometry !== false && geometry !== undefined && geometry.isFilled)) continue
      const from = Math.max(run.startIdx, startIdx)
      const to = Math.min(run.endIdx, endIdx)
      const segments = segmentsOfRun(this.commands, from, to)
      const d = segmentsToD(segments, runIsClosed(this.commands, from, to))
      if (d) parts.push(d)
    }
    return parts.join(" ")
  }

  /**
   * This path redrawn with a hand-drawn wobble.
   *
   * Every point is nudged by an amount derived from `randomSeed` and its own
   * index, so the wobble is stable across re-renders: a shape that jittered
   * differently every frame would shimmer. `passes` draws the whole outline
   * more than once with different nudges, which is what makes a stroke look
   * gone-over rather than merely crooked.
   */
  toDrawD(opts: DrawPathBuilderDOpts): string {
    const offset = opts.offset ?? DEFAULT_DRAW_OFFSET
    const passes = Math.max(1, Math.round(opts.passes ?? DEFAULT_DRAW_PASSES))
    const parts: string[] = []
    for (let pass = 0; pass < passes; pass++) {
      const random = seededRandom(`${opts.randomSeed}:${pass}`)
      for (const run of this.getRuns()) {
        const segments = segmentsOfRun(this.commands, run.startIdx, run.endIdx)
        const jittered = segments.map((segment) => jitterSegment(segment, offset, random))
        const d = segmentsToD(jittered, runIsClosed(this.commands, run.startIdx, run.endIdx))
        if (d) parts.push(d)
      }
    }
    return parts.join(" ")
  }

  /**
   * This path as a `Path2D`, for a canvas or overlay that strokes it directly.
   *
   * Returns an empty `Path2D` where the constructor is unavailable (a server
   * render, a worker without the canvas API), so a caller never has to guard.
   */
  toPath2D(opts: PathBuilderOpts): Path2D {
    const d = opts.style === "draw" ? this.toDrawD(opts) : this.toD({ onlyFilled: opts.onlyFilled ?? false })
    if (typeof Path2D === "undefined") return { } as Path2D
    return new Path2D(d)
  }

  /**
   * This path as an SVG element, styled per `opts`, or `null` when it would
   * draw nothing.
   *
   * The dash pattern is expressed as `stroke-dasharray` rather than by cutting
   * the path into pieces: a browser measures the path's own length far more
   * accurately than a flattened polyline can, so the dashes land evenly on
   * curves.
   */
  toSvg(opts: PathBuilderOpts): JSX.Element | null {
    const d = opts.style === "draw" && !opts.forceSolid ? this.toDrawD(opts) : this.toD({ onlyFilled: opts.onlyFilled ?? false })
    if (!d) return null
    if (opts.style === "none") return <path d={d} strokeWidth={0} stroke="none" {...opts.props} />
    const dash = opts.forceSolid || opts.style === "solid" || opts.style === "draw" ? undefined : dashArrayFor(opts, this)
    return <path d={d} strokeWidth={opts.strokeWidth} strokeDasharray={dash} {...opts.props} />
  }

  /**
   * A copy of this path with `mat` applied to every point, control points
   * included.
   *
   * Command metadata — fills, dash terminals, draw offsets, close state — is
   * carried across, so a mirrored or scaled path is still renderable and
   * hit-testable without rebuilding it from its parameters.
   *
   * An arc cannot survive an arbitrary affine map as an arc (a non-uniform
   * scale turns a circle into an ellipse at a new rotation), so arcs are
   * converted to the cubics they were going to be drawn as and those are
   * transformed instead.
   */
  transform(mat: MatLike): PathBuilder {
    const matrix = Mat.From(mat)
    const out = new PathBuilder()
    const map = (x: number, y: number): VecLike => matrix.applyToPoint({ x, y })
    let cursor: VecLike | null = null
    for (const command of this.commands) {
      switch (command.type) {
        case "move": {
          const p = map(command.x, command.y)
          out.commands.push({ type: "move", x: p.x, y: p.y, opts: command.opts })
          cursor = { x: command.x, y: command.y }
          break
        }
        case "line": {
          const p = map(command.x, command.y)
          out.commands.push({ type: "line", x: p.x, y: p.y, opts: command.opts })
          cursor = { x: command.x, y: command.y }
          break
        }
        case "cubic": {
          const p = map(command.x, command.y)
          const c1 = map(command.cp1X, command.cp1Y)
          const c2 = map(command.cp2X, command.cp2Y)
          out.commands.push({ type: "cubic", x: p.x, y: p.y, cp1X: c1.x, cp1Y: c1.y, cp2X: c2.x, cp2Y: c2.y, opts: command.opts })
          cursor = { x: command.x, y: command.y }
          break
        }
        case "arc": {
          if (cursor) {
            for (const cubic of arcToCubicSegments(cursor, command)) {
              const p = map(cubic.end.x, cubic.end.y)
              const c1 = map(cubic.cp1.x, cubic.cp1.y)
              const c2 = map(cubic.cp2.x, cubic.cp2.y)
              out.commands.push({ type: "cubic", x: p.x, y: p.y, cp1X: c1.x, cp1Y: c1.y, cp2X: c2.x, cp2Y: c2.y, opts: command.opts })
            }
          }
          cursor = { x: command.x, y: command.y }
          break
        }
        case "close":
          out.commands.push({ type: "close" })
          break
      }
    }
    return out
  }
}

/** Serialize segments to a `d`, starting with an `M` at the first segment's start. */
function segmentsToD(segments: readonly PathRunSegment[], closed: boolean): string {
  const head = segments[0]
  if (!head) return ""
  const parts = [`M${n(head.start.x)},${n(head.start.y)}`]
  for (const segment of segments) {
    if (segment.cubic) parts.push(`C${n(segment.cubic.cp1.x)},${n(segment.cubic.cp1.y)} ${n(segment.cubic.cp2.x)},${n(segment.cubic.cp2.y)} ${n(segment.cubic.end.x)},${n(segment.cubic.end.y)}`)
    else parts.push(`L${n(segment.end.x)},${n(segment.end.y)}`)
  }
  if (closed) parts.push("Z")
  return parts.join("")
}

function n(value: number): number {
  return Math.round(value * 100) / 100
}

/** The `stroke-dasharray` for a dashed or dotted style. */
function dashArrayFor(opts: DashedPathBuilderOpts, path: PathBuilder): string {
  const ratio = opts.lengthRatio ?? (opts.style === "dotted" ? DEFAULT_DOT_LENGTH_RATIO : DEFAULT_DASH_LENGTH_RATIO)
  const dash = Math.max(0.01, opts.strokeWidth * ratio)
  const gap = Math.max(0.01, opts.strokeWidth * (opts.style === "dotted" ? 2 : 2))
  if (!opts.snap) return `${n(dash)} ${n(gap)}`
  // Snapping: stretch the gap so a whole number of dash+gap periods fits the
  // run, which is what keeps a dashed rectangle's corners symmetrical.
  const length = path.toGeometry().length
  const periods = Math.max(1, Math.round(length / (dash + gap) / opts.snap) * opts.snap)
  const period = length / periods
  return `${n(dash)} ${n(Math.max(0.01, period - dash))}`
}

/** Nudge a segment's points by up to `offset` stroke widths, deterministically. */
function jitterSegment(segment: PathRunSegment, offset: number, random: () => number): PathRunSegment {
  const nudge = (p: VecLike): VecLike => ({ x: p.x + (random() - 0.5) * 2 * offset, y: p.y + (random() - 0.5) * 2 * offset })
  const start = nudge(segment.start)
  const end = nudge(segment.end)
  if (!segment.cubic) return { cubic: null, start, end }
  return { start, end, cubic: { start, cp1: nudge(segment.cubic.cp1), cp2: nudge(segment.cubic.cp2), end } }
}

/**
 * A deterministic pseudo-random sequence from a string seed.
 *
 * xorshift over an FNV-1a hash of the seed: cheap, dependency-free, and stable
 * across engines, which is the whole requirement — a shape must wobble the same
 * way on every machine that opens the file.
 */
function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let state = h >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
}

/** Pull the first and last point of `points` back along their own segment by `by` units. */
function trimEnds(points: readonly VecLike[], by: number): VecLike[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }))
  if (by <= 0 || out.length < 2) return out
  const first = out[0]!
  const second = out[1]!
  const last = out[out.length - 1]!
  const penultimate = out[out.length - 2]!
  const head = Vec.Add(first, Vec.Mul(Vec.Uni(Vec.Sub(second, first)), Math.min(by, Vec.Dist(first, second))))
  const tail = Vec.Add(last, Vec.Mul(Vec.Uni(Vec.Sub(penultimate, last)), Math.min(by, Vec.Dist(last, penultimate))))
  out[0] = { x: head.x, y: head.y }
  out[out.length - 1] = { x: tail.x, y: tail.y }
  return out
}
