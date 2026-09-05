/**
 * One run of a {@link PathBuilder} seen as shape geometry.
 *
 * A path built with several `moveTo`s is several runs; each becomes one of
 * these, and `PathBuilder.toGeometry()` groups them. Keeping a run's identity
 * rather than flattening the whole path to a single vertex list is what lets a
 * hit test tell "inside the ring" from "inside the hole", and lets one run be
 * filled while another is only stroked.
 */

import { Geometry2d, PATH_OP, Vec, type Geometry2dFilters, type Geometry2dOptions, type VecLike } from "@mocanvas/editor"
import { arcToCubicSegments, cubicPointAt, cubicSubdivisions, type CubicSegment, type PathBuilderCommand } from "./commands"
import type { PathBuilder } from "./PathBuilder"

/**
 * The drawable pieces of a run: the straight and curved segments between its
 * points, in order. Shared by the vertex walk, the `d` writer and the flat
 * word stream so all three describe the same curve.
 */
export interface PathRunSegment {
  /** A curve carries its control points; a straight segment carries only its ends. */
  cubic: CubicSegment | null
  start: VecLike
  end: VecLike
}

/** Walk `commands[startIdx..endIdx)` into ordered segments. */
export function segmentsOfRun(commands: readonly PathBuilderCommand[], startIdx: number, endIdx: number): PathRunSegment[] {
  const segments: PathRunSegment[] = []
  let cursor: VecLike | null = null
  let runStart: VecLike | null = null
  for (let i = startIdx; i < endIdx && i < commands.length; i++) {
    const command = commands[i]!
    switch (command.type) {
      case "move":
        cursor = { x: command.x, y: command.y }
        runStart = cursor
        break
      case "line": {
        if (!cursor) break
        const end = { x: command.x, y: command.y }
        segments.push({ cubic: null, start: cursor, end })
        cursor = end
        break
      }
      case "cubic": {
        if (!cursor) break
        const end = { x: command.x, y: command.y }
        const cubic: CubicSegment = { start: cursor, cp1: { x: command.cp1X, y: command.cp1Y }, cp2: { x: command.cp2X, y: command.cp2Y }, end }
        segments.push({ cubic, start: cursor, end })
        cursor = end
        break
      }
      case "arc": {
        if (!cursor) break
        for (const cubic of arcToCubicSegments(cursor, command)) segments.push({ cubic, start: cubic.start, end: cubic.end })
        cursor = { x: command.x, y: command.y }
        break
      }
      case "close":
        // No segment is emitted: `isClosed` is what tells every consumer that
        // the last vertex joins the first, and emitting the join as well would
        // duplicate the start point in the vertex list — which would then be
        // counted twice by the area and perimeter walks.
        cursor = runStart
        break
    }
  }
  return segments
}

/** Whether `commands[startIdx..endIdx)` ends in a `close()`. */
export function runIsClosed(commands: readonly PathBuilderCommand[], startIdx: number, endIdx: number): boolean {
  for (let i = Math.min(endIdx, commands.length) - 1; i >= startIdx; i--) {
    const command = commands[i]!
    if (command.type === "close") return true
    if (command.type === "move") return false
  }
  return false
}

/** Flatten segments to a polyline, dropping the duplicate point between neighbours. */
export function segmentsToVertices(segments: readonly PathRunSegment[]): Vec[] {
  const out: Vec[] = []
  const push = (p: VecLike) => {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) return
    out.push(new Vec(p.x, p.y))
  }
  for (const segment of segments) {
    push(segment.start)
    if (segment.cubic) {
      const steps = cubicSubdivisions(segment.cubic)
      for (let i = 1; i < steps; i++) push(cubicPointAt(segment.cubic, i / steps))
    }
    push(segment.end)
  }
  return out
}

/** The engine's flat word stream for one run. */
export function segmentsToPathWords(segments: readonly PathRunSegment[], closed: boolean): number[] {
  const words: number[] = []
  const first = segments[0]
  if (!first) return words
  words.push(PATH_OP.MOVE, first.start.x, first.start.y)
  for (const segment of segments) {
    if (segment.cubic) {
      words.push(PATH_OP.CUBIC, segment.cubic.cp1.x, segment.cubic.cp1.y, segment.cubic.cp2.x, segment.cubic.cp2.y, segment.cubic.end.x, segment.cubic.end.y)
    } else {
      words.push(PATH_OP.LINE, segment.end.x, segment.end.y)
    }
  }
  if (closed) words.push(PATH_OP.CLOSE)
  return words
}

/** One run of a path, as a `Geometry2d` the editor can hit-test, snap to and export. */
export class PathBuilderGeometry2d extends Geometry2d {
  private readonly segmentCache: PathRunSegment[]

  constructor(
    readonly path: PathBuilder,
    readonly startIdx: number,
    readonly endIdx: number,
    options: Geometry2dOptions,
  ) {
    super(options)
    this.segmentCache = segmentsOfRun(path.commands, startIdx, endIdx)
  }

  /**
   * This run split into one geometry per segment.
   *
   * The unit an arrow terminal or a handle is placed against: a caller that
   * wants "the third edge of the shape" wants a segment, not the whole run.
   */
  getSegments(): Geometry2d[] {
    return this.segmentCache.map((segment) => {
      const vertices = segmentsToVertices([segment])
      return new PathSegmentGeometry2d(vertices, { isFilled: false, isClosed: false })
    })
  }

  override getVertices(_filters?: Geometry2dFilters): Vec[] {
    return segmentsToVertices(this.segmentCache)
  }

  override toPathWords(): number[] {
    return segmentsToPathWords(this.segmentCache, this.isClosed)
  }

  override getSvgPathData(first = true): string {
    const segments = this.segmentCache
    const head = segments[0]
    if (!head) return ""
    const parts = [`${first ? "M" : "L"}${head.start.x},${head.start.y}`]
    for (const segment of segments) {
      if (segment.cubic) {
        parts.push(`C${segment.cubic.cp1.x},${segment.cubic.cp1.y} ${segment.cubic.cp2.x},${segment.cubic.cp2.y} ${segment.cubic.end.x},${segment.cubic.end.y}`)
      } else {
        parts.push(`L${segment.end.x},${segment.end.y}`)
      }
    }
    if (this.isClosed) parts.push("Z")
    return parts.join("")
  }
}

/** A single segment of a run, handed out by {@link PathBuilderGeometry2d.getSegments}. */
class PathSegmentGeometry2d extends Geometry2d {
  constructor(
    private readonly points: Vec[],
    options: Geometry2dOptions,
  ) {
    super(options)
  }

  override getVertices(): Vec[] {
    return this.points
  }

  override toPathWords(): number[] {
    const words: number[] = []
    const first = this.points[0]
    if (!first) return words
    words.push(PATH_OP.MOVE, first.x, first.y)
    for (let i = 1; i < this.points.length; i++) words.push(PATH_OP.LINE, this.points[i]!.x, this.points[i]!.y)
    return words
  }
}
