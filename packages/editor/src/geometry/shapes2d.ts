/**
 * The concrete geometries a `ShapeUtil` returns from `getGeometry`.
 *
 * Each one supplies an outline and a serialization; the queries all come from
 * {@link Geometry2d}, except where a shape can answer better than its own
 * flattened outline can — an ellipse knows its exact perimeter, a bézier knows
 * its exact point at `t`.
 */
import { PATH_OP } from "@mocanvas/wasm"
import { Box } from "./Box"
import { Geometry2d, type Geometry2dFilters, type Geometry2dOptions } from "./Geometry2d"
import { Vec, type VecLike } from "./Vec"
import { PI2, getArcMeasure, getPointInArcT, perimeterOfEllipse } from "./utils"

/** The presentation flags every geometry config carries. */
type Flags = Omit<Geometry2dOptions, "isClosed" | "isFilled">

function polygonWords(points: VecLike[], close: boolean): number[] {
  const out: number[] = []
  if (points.length === 0) return out
  out.push(PATH_OP.MOVE, points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) out.push(PATH_OP.LINE, points[i]!.x, points[i]!.y)
  if (close) out.push(PATH_OP.CLOSE)
  return out
}

/**
 * A single point, with a `margin` that gives it something to be hit at.
 *
 * This is the geometry of anything that has a position but no extent — a bare
 * handle, an anchor, the origin of a shape that draws itself entirely from its
 * props.
 */
export class Point2d extends Geometry2d {
  readonly point: Vec
  readonly margin: number

  constructor(config: Flags & { point: VecLike; margin: number }) {
    super({ ...config, isClosed: true, isFilled: true })
    this.point = Vec.From(config.point)
    this.margin = config.margin
  }

  getVertices(): Vec[] {
    return [this.point]
  }
  override nearestPoint(): Vec {
    return this.point
  }
  override hitTestPoint(point: VecLike, margin = 0): boolean {
    return Vec.Dist(this.point, point) <= this.margin + margin
  }
  override hitTestLineSegment(A: VecLike, B: VecLike, margin = 0): boolean {
    return Vec.DistanceToLineSegment(A, B, this.point) <= this.margin + margin
  }
  override getBounds(): Box {
    return new Box(this.point.x, this.point.y, 0, 0)
  }
  override getSvgPathData(first = true): string {
    // A zero-length subpath: with a round line cap this renders as the dot the
    // point actually is, rather than as nothing at all.
    return `${first ? "M" : "L"}${this.point.x},${this.point.y}L${this.point.x},${this.point.y}`
  }
  toPathWords(): number[] {
    return [PATH_OP.MOVE, this.point.x, this.point.y, PATH_OP.LINE, this.point.x, this.point.y]
  }
}

/** An open run of straight segments. */
export class Polyline2d extends Geometry2d {
  readonly points: Vec[]
  private _segments: Edge2d[] | undefined

  constructor(config: Flags & { points: VecLike[]; isClosed?: boolean | undefined; isFilled?: boolean | undefined }) {
    super({ ...config, isClosed: config.isClosed ?? false, isFilled: config.isFilled ?? false })
    this.points = config.points.map(Vec.From)
  }

  /** The outline as individual edges, for anything that walks it segment by segment. */
  get segments(): Edge2d[] {
    if (!this._segments) {
      const out: Edge2d[] = []
      const n = this.isClosed ? this.points.length : this.points.length - 1
      for (let i = 0; i < n; i++) {
        out.push(new Edge2d({ start: this.points[i]!, end: this.points[(i + 1) % this.points.length]! }))
      }
      this._segments = out
    }
    return this._segments
  }

  getVertices(): Vec[] {
    return this.points
  }
  toPathWords(): number[] {
    return polygonWords(this.points, this.isClosed)
  }
}

/** A closed run of straight segments. */
export class Polygon2d extends Geometry2d {
  readonly points: Vec[]

  constructor(config: Flags & { points: VecLike[]; isFilled: boolean }) {
    super({ ...config, isClosed: true })
    this.points = config.points.map(Vec.From)
  }

  getVertices(): Vec[] {
    return this.points
  }
  toPathWords(): number[] {
    return polygonWords(this.points, true)
  }
}

/** One straight segment. */
export class Edge2d extends Polyline2d {
  readonly start: Vec
  readonly end: Vec

  constructor(config: Flags & { start: VecLike; end: VecLike }) {
    super({ ...config, points: [config.start, config.end] })
    this.start = this.points[0]!
    this.end = this.points[1]!
  }

  /** The unit direction from `start` to `end`. */
  get direction(): Vec {
    return Vec.Uni(Vec.Sub(this.end, this.start))
  }

  override getLength(): number {
    return Vec.Dist(this.start, this.end)
  }
  override nearestPoint(point: VecLike): Vec {
    return Vec.NearestPointOnLineSegment(this.start, this.end, point)
  }
}

/** An axis-aligned rectangle, optionally offset from the shape's origin. */
export class Rectangle2d extends Geometry2d {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number

  constructor(config: Flags & { x?: number | undefined; y?: number | undefined; width: number; height: number; isFilled: boolean }) {
    super({ ...config, isClosed: true })
    this.x = config.x ?? 0
    this.y = config.y ?? 0
    this.w = config.width
    this.h = config.height
  }

  getVertices(): Vec[] {
    return new Box(this.x, this.y, this.w, this.h).corners
  }
  override getBounds(): Box {
    return Box.ZeroFix(new Box(this.x, this.y, this.w, this.h))
  }
  override getArea(): number {
    return Math.abs(this.w * this.h)
  }
  override getLength(): number {
    return 2 * (Math.abs(this.w) + Math.abs(this.h))
  }
  toPathWords(): number[] {
    return polygonWords(this.getVertices(), true)
  }
}

const KAPPA = 0.5522848

/** An ellipse inscribed in a `width × height` box at the shape's origin. */
export class Ellipse2d extends Geometry2d {
  readonly w: number
  readonly h: number

  constructor(config: Flags & { width: number; height: number; isFilled: boolean }) {
    super({ ...config, isClosed: true })
    this.w = config.width
    this.h = config.height
  }

  getVertices(): Vec[] {
    const rx = this.w / 2
    const ry = this.h / 2
    const n = Math.max(16, Math.min(128, Math.ceil((rx + ry) / 4)))
    const out: Vec[] = []
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      out.push(new Vec(rx + rx * Math.cos(t), ry + ry * Math.sin(t)))
    }
    return out
  }
  override getBounds(): Box {
    return Box.ZeroFix(new Box(0, 0, this.w, this.h))
  }
  override getArea(): number {
    return (Math.PI * Math.abs(this.w) * Math.abs(this.h)) / 4
  }
  /** The exact perimeter, rather than the perimeter of the sampled outline. */
  override getLength(): number {
    return perimeterOfEllipse(Math.abs(this.w) / 2, Math.abs(this.h) / 2)
  }
  toPathWords(): number[] {
    const rx = this.w / 2
    const ry = this.h / 2
    const cx = rx
    const cy = ry
    const kx = KAPPA * rx
    const ky = KAPPA * ry
    const C = PATH_OP.CUBIC
    return [
      PATH_OP.MOVE, cx + rx, cy,
      C, cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry,
      C, cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy,
      C, cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry,
      C, cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy,
      PATH_OP.CLOSE,
    ]
  }
}

/** A circle of the given radius, inscribed in its own bounding box. */
export class Circle2d extends Ellipse2d {
  readonly radius: number

  constructor(config: Flags & { radius: number; isFilled: boolean }) {
    super({ ...config, width: config.radius * 2, height: config.radius * 2 })
    this.radius = config.radius
  }
}

/**
 * A rectangle with fully rounded ends — a pill. The shorter axis decides the
 * radius, so a square stadium is a circle.
 *
 * SEMANTICS-ASSUMED: the docs give only `{ width, height }`. Rounding the
 * shorter axis completely is what makes the name "stadium" true at every aspect
 * ratio, and is the only rule under which the shape degenerates sensibly.
 */
export class Stadium2d extends Geometry2d {
  readonly w: number
  readonly h: number

  constructor(config: Flags & { width: number; height: number; isFilled: boolean }) {
    super({ ...config, isClosed: true })
    this.w = config.width
    this.h = config.height
  }

  /** The radius of the rounded ends. */
  get radius(): number {
    return Math.min(Math.abs(this.w), Math.abs(this.h)) / 2
  }

  getVertices(): Vec[] {
    const { w, h } = this
    const r = this.radius
    if (r === 0) return new Box(0, 0, w, h).corners
    // Samples per rounded end; enough that the flat part of a long pill is not
    // visibly polygonal at the zoom levels a shape is edited at.
    const steps = Math.max(8, Math.min(48, Math.ceil(r / 2)))
    const out: Vec[] = []
    const arc = (cx: number, cy: number, from: number, to: number) => {
      for (let i = 0; i <= steps; i++) {
        const a = from + ((to - from) * i) / steps
        out.push(new Vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
      }
    }
    if (w > h) {
      // Horizontal pill: semicircles on the left and right.
      arc(w - r, r, -Math.PI / 2, Math.PI / 2)
      arc(r, r, Math.PI / 2, (Math.PI * 3) / 2)
    } else {
      // Vertical pill: semicircles on the top and bottom.
      arc(r, h - r, 0, Math.PI)
      arc(r, r, Math.PI, Math.PI * 2)
    }
    return out
  }

  override getBounds(): Box {
    return Box.ZeroFix(new Box(0, 0, this.w, this.h))
  }

  override getLength(): number {
    const r = this.radius
    const straight = Math.abs(Math.abs(this.w) - Math.abs(this.h))
    return PI2 * r + 2 * straight
  }

  toPathWords(): number[] {
    return polygonWords(this.getVertices(), true)
  }
}

/**
 * A circular arc, given the way SVG gives one: a centre, two endpoints, and the
 * two flags that pick which of the four possible arcs between them is meant.
 */
export class Arc2d extends Geometry2d {
  /**
   * The centre of the circle the arc is cut from. Named apart from the
   * inherited `center`, which is the centre of the arc's bounding box and is a
   * different point entirely.
   */
  readonly _center: Vec
  readonly start: Vec
  readonly end: Vec
  readonly radius: number
  readonly largeArcFlag: number
  readonly sweepFlag: number
  /** The angle from the centre to `start`. */
  readonly angleStart: number
  /** The angle from the centre to `end`. */
  readonly angleEnd: number
  /** The signed sweep of the arc, in radians. Negative runs anti-clockwise. */
  readonly measure: number

  constructor(config: Flags & { center: VecLike; start: VecLike; end: VecLike; largeArcFlag: number; sweepFlag: number }) {
    super({ ...config, isClosed: false, isFilled: false })
    this._center = Vec.From(config.center)
    this.start = Vec.From(config.start)
    this.end = Vec.From(config.end)
    this.largeArcFlag = config.largeArcFlag
    this.sweepFlag = config.sweepFlag
    this.radius = Vec.Dist(this._center, this.start)
    this.angleStart = Vec.Angle(this._center, this.start)
    this.angleEnd = Vec.Angle(this._center, this.end)
    this.measure = getArcMeasure(this.angleStart, this.angleEnd, config.sweepFlag, config.largeArcFlag)
  }

  /** The point at `t` along the arc, `t` in `[0, 1]`. */
  getPointAt(t: number): Vec {
    const a = this.angleStart + this.measure * t
    return new Vec(this._center.x + Math.cos(a) * this.radius, this._center.y + Math.sin(a) * this.radius)
  }

  getVertices(): Vec[] {
    // One sample per few degrees of sweep, so a short arc is not oversampled and
    // a near-complete circle is not visibly faceted.
    const steps = Math.max(4, Math.min(128, Math.ceil((Math.abs(this.measure) / PI2) * 64)))
    const out: Vec[] = []
    for (let i = 0; i <= steps; i++) out.push(this.getPointAt(i / steps))
    return out
  }

  override getLength(): number {
    return Math.abs(this.measure) * this.radius
  }

  override nearestPoint(point: VecLike): Vec {
    // Project onto the circle first; if that lands within the sweep it is the
    // answer, and if not the nearest point is whichever end is closer.
    const angle = Vec.Angle(this._center, point)
    const t = getPointInArcT(this.measure, this.angleStart, this.angleEnd, angle)
    if (t >= 0 && t <= 1) return this.getPointAt(t)
    return Vec.Dist2(point, this.start) <= Vec.Dist2(point, this.end) ? this.start.clone() : this.end.clone()
  }

  override uninterpolateAlongEdge(point: VecLike): number {
    const angle = Vec.Angle(this._center, point)
    return Math.max(0, Math.min(1, getPointInArcT(this.measure, this.angleStart, this.angleEnd, angle)))
  }

  override interpolateAlongEdge(t: number): Vec {
    return this.getPointAt(Math.max(0, Math.min(1, t)))
  }

  toPathWords(): number[] {
    if (this.radius === 0 || this.measure === 0) return [PATH_OP.MOVE, this.start.x, this.start.y]
    // A cubic can carry about a quarter turn before the error shows, so split
    // the sweep into quarter-turn pieces and use the standard control-point
    // distance k = (4/3)·tan(Δ/4) for each.
    const count = Math.max(1, Math.ceil(Math.abs(this.measure) / (Math.PI / 2)))
    const delta = this.measure / count
    const k = ((4 / 3) * Math.tan(delta / 4) * this.radius) / 1
    const out: number[] = [PATH_OP.MOVE, this.start.x, this.start.y]
    for (let i = 0; i < count; i++) {
      const a0 = this.angleStart + delta * i
      const a1 = a0 + delta
      const p0 = new Vec(this._center.x + Math.cos(a0) * this.radius, this._center.y + Math.sin(a0) * this.radius)
      const p1 = new Vec(this._center.x + Math.cos(a1) * this.radius, this._center.y + Math.sin(a1) * this.radius)
      out.push(
        PATH_OP.CUBIC,
        p0.x - Math.sin(a0) * k,
        p0.y + Math.cos(a0) * k,
        p1.x + Math.sin(a1) * k,
        p1.y - Math.cos(a1) * k,
        p1.x,
        p1.y,
      )
    }
    return out
  }
}

/**
 * A single cubic bézier segment: `start` → `end`, shaped by the two control
 * points `cp1` and `cp2`. Shapes drawn as one wire (a connector, a pipeline
 * link) return this from `getGeometry`.
 */
export class CubicBezier2d extends Geometry2d {
  readonly start: Vec
  readonly cp1: Vec
  readonly cp2: Vec
  readonly end: Vec
  /** How many samples the flattened outline uses. */
  readonly resolution: number

  constructor(config: Flags & { start: VecLike; cp1: VecLike; cp2: VecLike; end: VecLike; isFilled?: boolean | undefined; resolution?: number | undefined }) {
    super({ ...config, isFilled: config.isFilled ?? false, isClosed: false })
    this.start = Vec.From(config.start)
    this.cp1 = Vec.From(config.cp1)
    this.cp2 = Vec.From(config.cp2)
    this.end = Vec.From(config.end)
    // SEMANTICS-ASSUMED: 24 samples by default. Hit-testing and bounds run off
    // this flattening, and it is twice the per-segment resolution a spline uses
    // (12); a lone wire is picked at more often than a spline vertex is, so it
    // gets the finer sampling.
    this.resolution = config.resolution ?? 24
  }

  /** The start point, under the name a spline segment gives it. */
  get p0(): Vec {
    return this.start
  }
  /** The first control point, under the name a spline segment gives it. */
  get c1(): Vec {
    return this.cp1
  }
  /** The second control point, under the name a spline segment gives it. */
  get c2(): Vec {
    return this.cp2
  }
  /** The end point, under the name a spline segment gives it. */
  get p1(): Vec {
    return this.end
  }

  /** The point at `t` on the bézier defined by `segment`. */
  static GetAtT(segment: { start: VecLike; cp1: VecLike; cp2: VecLike; end: VecLike }, t: number): Vec {
    const u = 1 - t
    return new Vec(
      u * u * u * segment.start.x + 3 * u * u * t * segment.cp1.x + 3 * u * t * t * segment.cp2.x + t * t * t * segment.end.x,
      u * u * u * segment.start.y + 3 * u * u * t * segment.cp1.y + 3 * u * t * t * segment.cp2.y + t * t * t * segment.end.y,
    )
  }

  /** The point at `t ∈ [0, 1]` along the curve. */
  getPointAt(t: number): Vec {
    return CubicBezier2d.GetAtT(this, t)
  }

  getVertices(): Vec[] {
    const out: Vec[] = []
    const n = this.resolution
    for (let i = 0; i <= n; i++) out.push(this.getPointAt(i / n))
    return out
  }

  toPathWords(): number[] {
    return [
      PATH_OP.MOVE,
      this.start.x,
      this.start.y,
      PATH_OP.CUBIC,
      this.cp1.x,
      this.cp1.y,
      this.cp2.x,
      this.cp2.y,
      this.end.x,
      this.end.y,
    ]
  }
}

/** The control points of one cubic segment, as a spline stores them. */
export interface CubicSegmentLike {
  p0: VecLike
  c1: VecLike
  c2: VecLike
  p1: VecLike
}

/**
 * A chain of cubic bézier segments, serialized natively rather than flattened.
 *
 * Give it `segments` when you already have control points — an arc decomposition,
 * a fitted stadium — or `points` when you have a run of points to smooth, in
 * which case a Catmull-Rom spline through them is converted to béziers for you.
 */
export class CubicSpline2d extends Geometry2d {
  readonly segments: CubicBezier2d[]

  constructor(
    config: Flags & { isClosed?: boolean | undefined; isFilled?: boolean | undefined } & (
      | { segments: CubicSegmentLike[]; points?: undefined }
      | { points: VecLike[]; segments?: undefined }
    ),
  ) {
    super({ ...config, isFilled: config.isFilled ?? false, isClosed: config.isClosed ?? false })
    const source = config.segments ?? catmullRomSegments(config.points ?? [], config.isClosed ?? false)
    this.segments = source.map(
      (s) => new CubicBezier2d({ start: s.p0, cp1: s.c1, cp2: s.c2, end: s.p1, resolution: 12 }),
    )
  }

  getVertices(): Vec[] {
    const out: Vec[] = []
    for (const s of this.segments) {
      const n = 12
      for (let i = 0; i < n; i++) {
        const t = i / n
        const u = 1 - t
        out.push(
          new Vec(
            u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p1.x,
            u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y,
          ),
        )
      }
    }
    const last = this.segments.at(-1)
    if (last) out.push(last.p1.clone())
    return out
  }

  toPathWords(): number[] {
    const out: number[] = []
    const first = this.segments[0]
    if (!first) return out
    out.push(PATH_OP.MOVE, first.p0.x, first.p0.y)
    for (const s of this.segments) out.push(PATH_OP.CUBIC, s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y)
    if (this.isClosed) out.push(PATH_OP.CLOSE)
    return out
  }
}

/**
 * Cubic segments for a Catmull-Rom spline through `points`, which is the curve
 * that passes through every point rather than being merely pulled towards them.
 *
 * SEMANTICS-ASSUMED: the docs give `CubicSpline2d` a `points` constructor but
 * not the interpolation. Uniform Catmull-Rom with the standard 1/6 tangent
 * scaling is the conventional choice, and is the only one that reduces to a
 * straight line for collinear input.
 */
function catmullRomSegments(points: VecLike[], isClosed: boolean): CubicSegmentLike[] {
  if (points.length < 2) return []
  const at = (i: number): VecLike => {
    if (isClosed) return points[((i % points.length) + points.length) % points.length]!
    return points[Math.max(0, Math.min(points.length - 1, i))]!
  }
  const out: CubicSegmentLike[] = []
  const last = isClosed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    out.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p1: p2,
    })
  }
  return out
}

/** Several geometries drawn as one shape (e.g. a geo shape and its label). */
export class Group2d extends Geometry2d {
  readonly children: Geometry2d[]

  constructor(config: Flags & { children: Geometry2d[] }) {
    super({
      ...config,
      isFilled: config.children.some((c) => c.isFilled),
      isClosed: config.children.some((c) => c.isClosed),
    })
    this.children = config.children
  }

  /** The children a filter says to skip. */
  get ignoredChildren(): Geometry2d[] {
    return this.children.filter((c) => c.ignore)
  }

  /** The children `filters` admits — all of them when there is no filter. */
  private visible(filters?: Geometry2dFilters): Geometry2d[] {
    if (!filters) return this.children
    return this.children.filter((c) => !c.isExcludedByFilter(filters))
  }

  getVertices(filters?: Geometry2dFilters): Vec[] {
    return this.visible(filters).flatMap((c) => c.getVertices(filters))
  }

  /**
   * Children flagged `excludeFromShapeBounds` are hit-tested but do not count
   * towards the group's bounds. If every child is excluded the group falls back
   * to all of them, so a shape is never reported as having no bounds at all.
   */
  override getBounds(): Box {
    const counted = this.children.filter((c) => !c.excludeFromShapeBounds)
    const from = counted.length > 0 ? counted : this.children
    return Box.FromPoints(from.flatMap((c) => c.vertices))
  }

  override getBoundsVertices(): Vec[] {
    return this.bounds.corners
  }

  override getArea(): number {
    let total = 0
    for (const c of this.children) total += c.getArea()
    return total
  }

  override getLength(filters?: Geometry2dFilters): number {
    let total = 0
    for (const c of this.visible(filters)) total += c.getLength(filters)
    return total
  }

  toPathWords(): number[] {
    return this.children.filter((c) => !c.isLabel).flatMap((c) => c.toPathWords())
  }

  override nearestPoint(point: VecLike, filters?: Geometry2dFilters): Vec {
    let best = new Vec()
    let bestD = Infinity
    for (const c of this.visible(filters)) {
      const p = c.nearestPoint(point, filters)
      const d = Vec.Dist2(p, point)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  override distanceToPoint(point: VecLike, hitInside = false, filters?: Geometry2dFilters): number {
    let best = Infinity
    for (const c of this.visible(filters)) best = Math.min(best, c.distanceToPoint(point, hitInside, filters))
    return best
  }

  override hitTestPoint(point: VecLike, margin = 0, hitInside = false, filters?: Geometry2dFilters): boolean {
    return this.visible(filters).some((c) => c.hitTestPoint(point, margin, hitInside, filters))
  }

  override hitTestLineSegment(A: VecLike, B: VecLike, distance = 0, filters?: Geometry2dFilters): boolean {
    return this.visible(filters).some((c) => c.hitTestLineSegment(A, B, distance, filters))
  }

  override distanceToLineSegment(A: VecLike, B: VecLike, filters?: Geometry2dFilters): number {
    let best = Infinity
    for (const c of this.visible(filters)) best = Math.min(best, c.distanceToLineSegment(A, B, filters))
    return best
  }

  override intersectCircle(center: VecLike, radius: number, filters?: Geometry2dFilters): VecLike[] {
    return this.visible(filters).flatMap((c) => c.intersectCircle(center, radius, filters))
  }
  override intersectLineSegment(A: VecLike, B: VecLike, filters?: Geometry2dFilters): VecLike[] {
    return this.visible(filters).flatMap((c) => c.intersectLineSegment(A, B, filters))
  }
  override intersectPolygon(polygon: VecLike[], filters?: Geometry2dFilters): VecLike[] {
    return this.visible(filters).flatMap((c) => c.intersectPolygon(polygon, filters))
  }
  override intersectPolyline(polyline: VecLike[], filters?: Geometry2dFilters): VecLike[] {
    return this.visible(filters).flatMap((c) => c.intersectPolyline(polyline, filters))
  }
  override overlapsPolygon(polygon: VecLike[]): boolean {
    return this.children.some((c) => c.overlapsPolygon(polygon))
  }

  override getSvgPathData(_first = true): string {
    // Every child is its own subpath, so each one starts with a move.
    return this.children.map((c) => c.getSvgPathData(true)).join("")
  }
}
