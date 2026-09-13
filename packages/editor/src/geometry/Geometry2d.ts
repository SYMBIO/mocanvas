/**
 * The base class every shape's geometry derives from.
 *
 * A `Geometry2d` is the answer to "what shape is this, in its own coordinate
 * space" — and everything the editor does spatially is asked of it: hit testing,
 * bounds, snapping, arrow binding, brush selection, export. Subclasses supply an
 * outline (`getVertices`) and a serialization (`toPathWords`); everything else
 * here is derived from the outline, and a subclass overrides one of those
 * derivations only when it can do better than the flattened polygon — an
 * ellipse's exact perimeter, say, rather than the perimeter of its samples.
 */
import { PATH_OP } from "@mocanvas/wasm"
import { Box } from "./Box"
import {
  intersectCirclePolygon,
  intersectCirclePolyline,
  intersectLineSegmentLineSegment,
  intersectLineSegmentPolygon,
  intersectLineSegmentPolyline,
  pointInPolygon,
  polygonIntersectsPolyline,
  polygonsIntersect,
} from "./intersect"
import { Mat, type MatModel } from "./Mat"
import { Vec, type VecLike } from "./Vec"

/**
 * Which parts of a shape's geometry a caller wants to see.
 *
 * A shape's geometry is not all one kind of thing: a note has an outline and a
 * label, a frame has an outline and a header, and some pieces exist only to make
 * something draggable. A hit test wants all of it; an export wants none of the
 * scaffolding.
 *
 * SEMANTICS-ASSUMED: the docs name the four presets but not the shape of the
 * object behind them. Two independent flags — internal and label — reproduce all
 * four presets exactly, with "non-standard" meaning "either of those".
 */
export interface Geometry2dFilters {
  /** Include geometry that exists for interaction rather than for drawing. */
  includeInternal: boolean
  /** Include the geometry of a shape's text label. */
  includeLabels: boolean
}

/** The four filters {@link Geometry2dFilters} presets. */
export const Geometry2dFilters = {
  INCLUDE_ALL: { includeInternal: true, includeLabels: true },
  EXCLUDE_INTERNAL: { includeInternal: false, includeLabels: true },
  EXCLUDE_LABELS: { includeInternal: true, includeLabels: false },
  EXCLUDE_NON_STANDARD: { includeInternal: false, includeLabels: false },
} as const satisfies Record<string, Geometry2dFilters>

/** Options passed to `ShapeUtil.getGeometry` alongside the shape. */
export interface TLGeometryOpts {
  /**
   * The context in which the geometry is being requested, so a shape can return
   * a different outline for (say) an export than for a hit test.
   */
  context?: string | undefined
}

export interface Geometry2dOptions {
  isFilled: boolean
  isClosed: boolean
  /** This geometry is a text label rather than part of the shape's outline. */
  isLabel?: boolean | undefined
  /** The label is empty, so it should not be hit-tested as if it had text in it. */
  isEmptyLabel?: boolean | undefined
  /**
   * This geometry exists to make something interactive, not to be drawn — a
   * widened hit area, a drag target. Excluded by `EXCLUDE_INTERNAL`.
   */
  isInternal?: boolean | undefined
  /** Skip this geometry entirely when hit-testing. */
  ignore?: boolean | undefined
  /** Stroke colour for the geometry debug overlay. Has no effect on rendering. */
  debugColor?: string | undefined
  /**
   * Keep this part out of the owning shape's bounds. A heading that hangs
   * outside its container is still hit-testable, but must not inflate the
   * bounds every zoom-to-fit, align and export reads.
   */
  excludeFromShapeBounds?: boolean | undefined
}

/** Extra flags a {@link TransformedGeometry2d} may override on its source. */
export interface TransformedGeometry2dOptions {
  isLabel?: boolean | undefined
  isEmptyLabel?: boolean | undefined
  isInternal?: boolean | undefined
  ignore?: boolean | undefined
  debugColor?: string | undefined
  excludeFromShapeBounds?: boolean | undefined
}

/** Base class for shape geometry. */
export abstract class Geometry2d {
  readonly isFilled: boolean
  readonly isClosed: boolean
  readonly isLabel: boolean
  readonly isEmptyLabel: boolean
  readonly isInternal: boolean
  readonly ignore: boolean
  readonly debugColor: string | undefined
  readonly excludeFromShapeBounds: boolean
  private _vertices: Vec[] | undefined
  private _bounds: Box | undefined
  private _area: number | undefined
  private _length: number | undefined

  constructor(opts: Geometry2dOptions) {
    this.isFilled = opts.isFilled
    this.isClosed = opts.isClosed
    this.isLabel = opts.isLabel ?? false
    this.isEmptyLabel = opts.isEmptyLabel ?? false
    this.isInternal = opts.isInternal ?? false
    this.ignore = opts.ignore ?? false
    this.debugColor = opts.debugColor
    this.excludeFromShapeBounds = opts.excludeFromShapeBounds ?? false
  }

  /** Flattened outline vertices in shape-local space. */
  abstract getVertices(filters?: Geometry2dFilters): Vec[]
  /** Serialize to the engine's flat path encoding. */
  abstract toPathWords(): number[]

  // ---- memoized derivations -------------------------------------------------

  get vertices(): Vec[] {
    return (this._vertices ??= this.getVertices())
  }

  get bounds(): Box {
    return (this._bounds ??= this.getBounds())
  }

  /** The four corners of {@link Geometry2d.bounds}. */
  get boundsVertices(): Vec[] {
    return this.getBoundsVertices()
  }

  /** The enclosed area, or `0` for anything open. */
  get area(): number {
    return (this._area ??= this.getArea())
  }

  /** The length of the outline — the perimeter, for anything closed. */
  get length(): number {
    return (this._length ??= this.getLength())
  }

  get center(): Vec {
    return this.bounds.center
  }

  /** The bounds this geometry contributes to its shape. Memoized by `bounds`. */
  getBounds(): Box {
    return Box.FromPoints(this.vertices)
  }

  getBoundsVertices(): Vec[] {
    return this.bounds.corners
  }

  /** The enclosed area by the shoelace formula. Open geometry encloses nothing. */
  getArea(): number {
    if (!this.isClosed) return 0
    const v = this.vertices
    let total = 0
    for (let i = 0; i < v.length; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      total += a.x * b.y - b.x * a.y
    }
    return Math.abs(total / 2)
  }

  /** The total length of the outline, walked vertex to vertex. */
  getLength(_filters?: Geometry2dFilters): number {
    const v = this.vertices
    if (v.length < 2) return 0
    let total = 0
    const n = this.isClosed ? v.length : v.length - 1
    for (let i = 0; i < n; i++) total += Vec.Dist(v[i]!, v[(i + 1) % v.length]!)
    return total
  }

  // ---- filtering ------------------------------------------------------------

  /** Whether `filters` says to skip this geometry. */
  isExcludedByFilter(filters?: Geometry2dFilters): boolean {
    if (!filters) return false
    if (this.isLabel && !filters.includeLabels) return true
    if (this.isInternal && !filters.includeInternal) return true
    return false
  }

  /**
   * Whether a hit at `_point` should be discarded even though it landed. The
   * default answer comes from the `ignore` flag; a subclass may look at where
   * the hit was.
   */
  ignoreHit(_point: VecLike): boolean {
    return this.ignore
  }

  // ---- point queries --------------------------------------------------------

  nearestPoint(point: VecLike, _filters?: Geometry2dFilters): Vec {
    const v = this.vertices
    if (v.length === 0) return new Vec()
    if (v.length === 1) return v[0]!.clone()
    let best = v[0]!
    let bestD = Infinity
    const n = this.isClosed ? v.length : v.length - 1
    for (let i = 0; i < n; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      const p = Vec.NearestPointOnLineSegment(a, b, point)
      const d = Vec.Dist2(p, point)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  distanceToPoint(point: VecLike, hitInside = false, filters?: Geometry2dFilters): number {
    const d = Vec.Dist(point, this.nearestPoint(point, filters))
    if (hitInside && this.isClosed && this.isFilled && pointInPolygon(point, this.vertices)) return -d
    return d
  }

  /**
   * Whether `point` hits this geometry, within `margin`.
   *
   * The interior counts when the shape is **filled**, or when the caller asks
   * for `hitInside` — the two are alternatives, not a requirement and a
   * refinement. `hitInside` means "count the interior of a HOLLOW shape too",
   * which is what a marquee or a drop target wants; it is not the only way the
   * interior is ever reachable.
   *
   * This used to test `hitInside` alone, so a solid rectangle could not be
   * selected by clicking its middle — only its outline answered. Nothing failed
   * and nothing warned: every feature built on hit testing simply returned
   * nothing, which reads as several unrelated bugs rather than one.
   *
   * An unfilled shape still misses in the middle. A hollow rectangle is a frame
   * around empty space, and clicking the space inside it should reach whatever
   * is behind.
   */
  hitTestPoint(point: VecLike, margin = 0, hitInside = false, _filters?: Geometry2dFilters): boolean {
    if ((hitInside || this.isFilled) && this.isClosed && pointInPolygon(point, this.vertices)) return true
    return Vec.Dist(point, this.nearestPoint(point)) <= margin
  }

  /** Whether `point` lies within the bounding box, which is the cheap pre-test. */
  isPointInBounds(point: VecLike, margin = 0): boolean {
    return this.bounds.containsPoint(point, margin)
  }

  // ---- segment queries ------------------------------------------------------

  /** The shortest distance from any point of this geometry to the segment `A`→`B`. */
  distanceToLineSegment(A: VecLike, B: VecLike, filters?: Geometry2dFilters): number {
    if (Vec.Equals(A, B)) return this.distanceToPoint(A, false, filters)
    const v = this.getVertices(filters)
    if (v.length === 0) return Infinity
    let best = Infinity
    const n = this.isClosed ? v.length : Math.max(v.length - 1, 1)
    for (let i = 0; i < n; i++) {
      const p = v[i]!
      const q = v[(i + 1) % v.length]!
      // Two segments that cross are zero apart; two that do not have their
      // closest approach between an endpoint of one and the body of the other.
      if (intersectLineSegmentLineSegment(A, B, p, q)) return 0
      best = Math.min(
        best,
        Vec.DistanceToLineSegment(A, B, p),
        Vec.DistanceToLineSegment(A, B, q),
        Vec.DistanceToLineSegment(p, q, A),
        Vec.DistanceToLineSegment(p, q, B),
      )
      if (best === 0) return 0
    }
    return best
  }

  /** Whether the segment `A`→`B` comes within `distance` of this geometry. */
  hitTestLineSegment(A: VecLike, B: VecLike, distance = 0, filters?: Geometry2dFilters): boolean {
    return this.distanceToLineSegment(A, B, filters) <= distance
  }

  // ---- intersections --------------------------------------------------------

  intersectCircle(center: VecLike, radius: number, _filters?: Geometry2dFilters): VecLike[] {
    const v = this.getVertices(_filters)
    return (this.isClosed ? intersectCirclePolygon(center, radius, v) : intersectCirclePolyline(center, radius, v)) ?? []
  }

  intersectLineSegment(A: VecLike, B: VecLike, _filters?: Geometry2dFilters): VecLike[] {
    const v = this.getVertices(_filters)
    return (this.isClosed ? intersectLineSegmentPolygon(A, B, v) : intersectLineSegmentPolyline(A, B, v)) ?? []
  }

  intersectPolygon(polygon: VecLike[], _filters?: Geometry2dFilters): VecLike[] {
    const v = this.getVertices(_filters)
    const out: VecLike[] = []
    for (let i = 0; i < polygon.length; i++) {
      const hits = this.isClosed
        ? intersectLineSegmentPolygon(polygon[i]!, polygon[(i + 1) % polygon.length]!, v)
        : intersectLineSegmentPolyline(polygon[i]!, polygon[(i + 1) % polygon.length]!, v)
      if (hits) out.push(...hits)
    }
    return out
  }

  intersectPolyline(polyline: VecLike[], _filters?: Geometry2dFilters): VecLike[] {
    const v = this.getVertices(_filters)
    const out: VecLike[] = []
    for (let i = 0; i < polyline.length - 1; i++) {
      const hits = this.isClosed
        ? intersectLineSegmentPolygon(polyline[i]!, polyline[i + 1]!, v)
        : intersectLineSegmentPolyline(polyline[i]!, polyline[i + 1]!, v)
      if (hits) out.push(...hits)
    }
    return out
  }

  /**
   * Whether `_polygon` overlaps this geometry at all — including the case where
   * one lies entirely within the other, which no edge crossing would reveal.
   */
  overlapsPolygon(_polygon: VecLike[]): boolean {
    const v = this.vertices
    if (v.length === 0 || _polygon.length === 0) return false
    return this.isClosed ? polygonsIntersect(_polygon, v) : polygonIntersectsPolyline(_polygon, v)
  }

  // ---- walking the outline --------------------------------------------------

  /**
   * The point `t` of the way along the outline, `t` in `[0, 1]`. This is how a
   * label, a handle or an arrow terminal is placed a fixed fraction along a
   * shape's edge and stays there as the shape resizes.
   */
  interpolateAlongEdge(t: number, _filters?: Geometry2dFilters): Vec {
    const v = this.getVertices(_filters)
    if (v.length === 0) return new Vec()
    if (v.length === 1) return v[0]!.clone()
    const total = this.getLength(_filters)
    if (total === 0) return v[0]!.clone()
    let remaining = Math.max(0, Math.min(1, t)) * total
    const n = this.isClosed ? v.length : v.length - 1
    for (let i = 0; i < n; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      const d = Vec.Dist(a, b)
      if (remaining <= d || i === n - 1) return Vec.Lrp(a, b, d === 0 ? 0 : remaining / d)
      remaining -= d
    }
    return v[v.length - 1]!.clone()
  }

  /**
   * The inverse of {@link Geometry2d.interpolateAlongEdge}: how far along the
   * outline the nearest point to `point` sits, as a `t` in `[0, 1]`.
   */
  uninterpolateAlongEdge(point: VecLike, _filters?: Geometry2dFilters): number {
    const v = this.getVertices(_filters)
    if (v.length < 2) return 0
    const total = this.getLength(_filters)
    if (total === 0) return 0
    let travelled = 0
    let best = 0
    let bestD = Infinity
    const n = this.isClosed ? v.length : v.length - 1
    for (let i = 0; i < n; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      const nearest = Vec.NearestPointOnLineSegment(a, b, point)
      const d = Vec.Dist2(nearest, point)
      if (d < bestD) {
        bestD = d
        best = (travelled + Vec.Dist(a, nearest)) / total
      }
      travelled += Vec.Dist(a, b)
    }
    return best
  }

  // ---- transformation -------------------------------------------------------

  /**
   * This geometry seen through `transform` — the form a parent needs when it
   * asks a child for its outline in the parent's own space. The result is a view
   * onto this geometry, not a copy of it, so transforming is cheap.
   */
  transform(transform: MatModel, opts?: TransformedGeometry2dOptions): Geometry2d {
    return new TransformedGeometry2d(this, transform, opts ?? {})
  }

  // ---- SVG ------------------------------------------------------------------

  /**
   * This geometry as one subpath of an SVG `d` attribute.
   *
   * @param first - whether this is the first subpath in the `d`. A later one
   * starts with `L` rather than `M`, so it joins what came before instead of
   * lifting the pen.
   */
  getSvgPathData(first = true): string {
    const v = this.getVertices()
    if (v.length === 0) return ""
    const head = v[0]!
    let d = `${first ? "M" : "L"}${head.x},${head.y}`
    for (let i = 1; i < v.length; i++) d += `L${v[i]!.x},${v[i]!.y}`
    if (this.isClosed) d += "Z"
    return d
  }

  /** The whole geometry as a standalone SVG path `d`. */
  toSimpleSvgPath(): string {
    return this.getSvgPathData(true)
  }
}

/**
 * Another geometry seen through an affine transform.
 *
 * Every query is answered by mapping the question into the source geometry's own
 * space, asking it there, and mapping the answer back — so a transformed
 * geometry costs one matrix inversion rather than a rebuilt outline, and stays
 * exact for anything the source answers exactly.
 */
export class TransformedGeometry2d extends Geometry2d {
  readonly geometry: Geometry2d
  readonly matrix: Mat
  private readonly inverse: Mat

  constructor(geometry: Geometry2d, matrix: MatModel, opts: TransformedGeometry2dOptions = {}) {
    super({
      isFilled: geometry.isFilled,
      isClosed: geometry.isClosed,
      isLabel: opts.isLabel ?? geometry.isLabel,
      isEmptyLabel: opts.isEmptyLabel ?? geometry.isEmptyLabel,
      isInternal: opts.isInternal ?? geometry.isInternal,
      ignore: opts.ignore ?? geometry.ignore,
      debugColor: opts.debugColor ?? geometry.debugColor,
      excludeFromShapeBounds: opts.excludeFromShapeBounds ?? geometry.excludeFromShapeBounds,
    })
    this.geometry = geometry
    this.matrix = Mat.From(matrix)
    this.inverse = Mat.Inverse(matrix)
  }

  /** A point in this geometry's space, expressed in the source's space. */
  private toLocal(p: VecLike): Vec {
    return this.inverse.applyToPoint(p)
  }

  override getVertices(filters?: Geometry2dFilters): Vec[] {
    return this.matrix.applyToPoints(this.geometry.getVertices(filters))
  }

  override getBoundsVertices(): Vec[] {
    return this.matrix.applyToPoints(this.geometry.getBoundsVertices())
  }

  override nearestPoint(point: VecLike, filters?: Geometry2dFilters): Vec {
    return this.matrix.applyToPoint(this.geometry.nearestPoint(this.toLocal(point), filters))
  }

  override distanceToPoint(point: VecLike, hitInside = false, filters?: Geometry2dFilters): number {
    // Distance has to be measured in this space, not the source's: a scaled
    // transform would otherwise report the source's distances.
    const nearest = this.nearestPoint(point, filters)
    const d = Vec.Dist(point, nearest)
    if (hitInside && this.geometry.distanceToPoint(this.toLocal(point), true, filters) < 0) return -d
    return d
  }

  override hitTestPoint(point: VecLike, margin = 0, hitInside = false, filters?: Geometry2dFilters): boolean {
    // Same rule as the base: filled OR asked for. See `Geometry2d.hitTestPoint`.
    if ((hitInside || this.isFilled) && this.isClosed && pointInPolygon(point, this.vertices)) return true
    return Vec.Dist(point, this.nearestPoint(point, filters)) <= margin
  }

  override ignoreHit(point: VecLike): boolean {
    return this.geometry.ignoreHit(this.toLocal(point))
  }

  override toPathWords(): number[] {
    // The path encoding is a flat list of points, so a transform is a remap of
    // the coordinate pairs; the opcodes and their arities are unchanged.
    return remapPathWords(this.geometry.toPathWords(), (x, y) => {
      const p = this.matrix.applyToPoint({ x, y })
      return [p.x, p.y]
    })
  }
}

/**
 * Rewrite every `(x, y)` pair in a flat path encoding, leaving the opcodes and
 * their operand counts alone.
 *
 * The encoding is `[op, ...coords]` repeated, so all this needs to know is how
 * many coordinate pairs each op carries.
 */
const PAIRS_PER_OP: Record<number, number> = {
  [PATH_OP.MOVE]: 1,
  [PATH_OP.LINE]: 1,
  [PATH_OP.QUAD]: 2,
  [PATH_OP.CUBIC]: 3,
  [PATH_OP.CLOSE]: 0,
}

function remapPathWords(words: number[], map: (x: number, y: number) => [number, number]): number[] {
  const out: number[] = []
  let i = 0
  while (i < words.length) {
    const op = words[i]!
    out.push(op)
    i++
    const pairs = PAIRS_PER_OP[op] ?? 0
    for (let p = 0; p < pairs; p++) {
      const [x, y] = map(words[i]!, words[i + 1]!)
      out.push(x, y)
      i += 2
    }
  }
  return out
}
