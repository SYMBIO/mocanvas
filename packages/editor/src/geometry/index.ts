/**
 * Shape geometry as seen by ShapeUtils. Every geometry serializes to the flat
 * path encoding the engine consumes, and offers a small set of TS-side helpers
 * for tools that need geometry without a round trip (e.g. handle placement).
 */
import { PATH_OP } from "@mocanvas/wasm"

export interface VecLike {
  x: number
  y: number
}

export interface BoxLike {
  x: number
  y: number
  w: number
  h: number
}

export class Vec {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  static From(p: VecLike): Vec {
    return new Vec(p.x, p.y)
  }
  static Add(a: VecLike, b: VecLike): Vec {
    return new Vec(a.x + b.x, a.y + b.y)
  }
  static Sub(a: VecLike, b: VecLike): Vec {
    return new Vec(a.x - b.x, a.y - b.y)
  }
  static Mul(a: VecLike, s: number): Vec {
    return new Vec(a.x * s, a.y * s)
  }
  static Div(a: VecLike, s: number): Vec {
    return new Vec(a.x / s, a.y / s)
  }
  static Dist(a: VecLike, b: VecLike): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  static Dist2(a: VecLike, b: VecLike): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }
  static Len(a: VecLike): number {
    return Math.hypot(a.x, a.y)
  }
  static Dot(a: VecLike, b: VecLike): number {
    return a.x * b.x + a.y * b.y
  }
  static Cross(a: VecLike, b: VecLike): number {
    return a.x * b.y - a.y * b.x
  }
  static Lrp(a: VecLike, b: VecLike, t: number): Vec {
    return new Vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
  }
  static Angle(a: VecLike, b: VecLike): number {
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  static Rot(a: VecLike, r: number): Vec {
    const s = Math.sin(r)
    const c = Math.cos(r)
    return new Vec(a.x * c - a.y * s, a.x * s + a.y * c)
  }
  static RotWith(a: VecLike, center: VecLike, r: number): Vec {
    const p = Vec.Rot(Vec.Sub(a, center), r)
    return new Vec(p.x + center.x, p.y + center.y)
  }
  static Uni(a: VecLike): Vec {
    const l = Vec.Len(a)
    return l === 0 ? new Vec() : Vec.Div(a, l)
  }
  static Per(a: VecLike): Vec {
    return new Vec(-a.y, a.x)
  }
  static Equals(a: VecLike, b: VecLike): boolean {
    return a.x === b.x && a.y === b.y
  }
  static NearestPointOnLineSegment(a: VecLike, b: VecLike, p: VecLike): Vec {
    const ab = Vec.Sub(b, a)
    const l2 = Vec.Dot(ab, ab)
    if (l2 === 0) return Vec.From(a)
    const t = Math.max(0, Math.min(1, Vec.Dot(Vec.Sub(p, a), ab) / l2))
    return Vec.Add(a, Vec.Mul(ab, t))
  }
  static DistanceToLineSegment(a: VecLike, b: VecLike, p: VecLike): number {
    return Vec.Dist(p, Vec.NearestPointOnLineSegment(a, b, p))
  }
  add(b: VecLike): this {
    this.x += b.x
    this.y += b.y
    return this
  }
  sub(b: VecLike): this {
    this.x -= b.x
    this.y -= b.y
    return this
  }
  mul(s: number): this {
    this.x *= s
    this.y *= s
    return this
  }
  clone(): Vec {
    return new Vec(this.x, this.y)
  }
  toJson(): VecLike {
    return { x: this.x, y: this.y }
  }
}

export class Box {
  constructor(
    public x = 0,
    public y = 0,
    public w = 0,
    public h = 0,
  ) {}
  static From(b: BoxLike): Box {
    return new Box(b.x, b.y, b.w, b.h)
  }
  static FromPoints(points: VecLike[]): Box {
    if (points.length === 0) return new Box()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    return new Box(minX, minY, maxX - minX, maxY - minY)
  }
  static FromMinMax(minX: number, minY: number, maxX: number, maxY: number): Box {
    return new Box(minX, minY, maxX - minX, maxY - minY)
  }
  static Common(boxes: BoxLike[]): Box {
    if (boxes.length === 0) return new Box()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of boxes) {
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    return Box.FromMinMax(minX, minY, maxX, maxY)
  }
  static Contains(a: BoxLike, b: BoxLike): boolean {
    return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h
  }
  static ContainsPoint(a: BoxLike, p: VecLike, margin = 0): boolean {
    return p.x >= a.x - margin && p.y >= a.y - margin && p.x <= a.x + a.w + margin && p.y <= a.y + a.h + margin
  }
  static Collides(a: BoxLike, b: BoxLike): boolean {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
  }
  static Expand(a: BoxLike, d: number): Box {
    return new Box(a.x - d, a.y - d, a.w + 2 * d, a.h + 2 * d)
  }
  get minX(): number {
    return this.x
  }
  get minY(): number {
    return this.y
  }
  get maxX(): number {
    return this.x + this.w
  }
  get maxY(): number {
    return this.y + this.h
  }
  get width(): number {
    return this.w
  }
  get height(): number {
    return this.h
  }
  get center(): Vec {
    return new Vec(this.x + this.w / 2, this.y + this.h / 2)
  }
  get corners(): Vec[] {
    return [
      new Vec(this.x, this.y),
      new Vec(this.maxX, this.y),
      new Vec(this.maxX, this.maxY),
      new Vec(this.x, this.maxY),
    ]
  }
  clone(): Box {
    return new Box(this.x, this.y, this.w, this.h)
  }
  toJson(): BoxLike {
    return { x: this.x, y: this.y, w: this.w, h: this.h }
  }
}

export interface Geometry2dOptions {
  isFilled: boolean
  isClosed: boolean
  isLabel?: boolean
}

/** Base class for shape geometry. */
export abstract class Geometry2d {
  readonly isFilled: boolean
  readonly isClosed: boolean
  readonly isLabel: boolean
  private _vertices: Vec[] | undefined
  private _bounds: Box | undefined

  constructor(opts: Geometry2dOptions) {
    this.isFilled = opts.isFilled
    this.isClosed = opts.isClosed
    this.isLabel = opts.isLabel ?? false
  }

  /** Flattened outline vertices in shape-local space. */
  abstract getVertices(): Vec[]
  /** Serialize to the engine's flat path encoding. */
  abstract toPathWords(): number[]

  get vertices(): Vec[] {
    return (this._vertices ??= this.getVertices())
  }

  get bounds(): Box {
    return (this._bounds ??= Box.FromPoints(this.vertices))
  }

  get center(): Vec {
    return this.bounds.center
  }

  nearestPoint(point: VecLike): Vec {
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

  distanceToPoint(point: VecLike, hitInside = false): number {
    const d = Vec.Dist(point, this.nearestPoint(point))
    if (hitInside && this.isClosed && this.isFilled && pointInPolygon(point, this.vertices)) return -d
    return d
  }

  hitTestPoint(point: VecLike, margin = 0, hitInside = false): boolean {
    if (hitInside && this.isClosed && pointInPolygon(point, this.vertices)) return true
    return Vec.Dist(point, this.nearestPoint(point)) <= margin
  }
}

export function pointInPolygon(p: VecLike, poly: VecLike[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function polygonWords(points: VecLike[], close: boolean): number[] {
  const out: number[] = []
  if (points.length === 0) return out
  out.push(PATH_OP.MOVE, points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) out.push(PATH_OP.LINE, points[i]!.x, points[i]!.y)
  if (close) out.push(PATH_OP.CLOSE)
  return out
}

export class Rectangle2d extends Geometry2d {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  constructor(opts: { x?: number; y?: number; width: number; height: number; isFilled: boolean; isLabel?: boolean }) {
    super({ isFilled: opts.isFilled, isClosed: true, ...(opts.isLabel !== undefined ? { isLabel: opts.isLabel } : {}) })
    this.x = opts.x ?? 0
    this.y = opts.y ?? 0
    this.w = opts.width
    this.h = opts.height
  }
  getVertices(): Vec[] {
    return new Box(this.x, this.y, this.w, this.h).corners
  }
  toPathWords(): number[] {
    return polygonWords(this.getVertices(), true)
  }
}

const KAPPA = 0.5522848

export class Ellipse2d extends Geometry2d {
  readonly w: number
  readonly h: number
  constructor(opts: { width: number; height: number; isFilled: boolean }) {
    super({ isFilled: opts.isFilled, isClosed: true })
    this.w = opts.width
    this.h = opts.height
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

export class Circle2d extends Ellipse2d {
  constructor(opts: { radius: number; isFilled: boolean }) {
    super({ width: opts.radius * 2, height: opts.radius * 2, isFilled: opts.isFilled })
  }
}

export class Polygon2d extends Geometry2d {
  readonly points: Vec[]
  constructor(opts: { points: VecLike[]; isFilled: boolean }) {
    super({ isFilled: opts.isFilled, isClosed: true })
    this.points = opts.points.map(Vec.From)
  }
  getVertices(): Vec[] {
    return this.points
  }
  toPathWords(): number[] {
    return polygonWords(this.points, true)
  }
}

export class Polyline2d extends Geometry2d {
  readonly points: Vec[]
  constructor(opts: { points: VecLike[] }) {
    super({ isFilled: false, isClosed: false })
    this.points = opts.points.map(Vec.From)
  }
  getVertices(): Vec[] {
    return this.points
  }
  toPathWords(): number[] {
    return polygonWords(this.points, false)
  }
}

export class Edge2d extends Polyline2d {
  constructor(opts: { start: VecLike; end: VecLike }) {
    super({ points: [opts.start, opts.end] })
  }
}

/** Cubic bézier spline through control points, serialized natively. */
export class CubicSpline2d extends Geometry2d {
  readonly segments: { p0: Vec; c1: Vec; c2: Vec; p1: Vec }[]
  constructor(opts: { segments: { p0: VecLike; c1: VecLike; c2: VecLike; p1: VecLike }[]; isClosed?: boolean; isFilled?: boolean }) {
    super({ isFilled: opts.isFilled ?? false, isClosed: opts.isClosed ?? false })
    this.segments = opts.segments.map((s) => ({ p0: Vec.From(s.p0), c1: Vec.From(s.c1), c2: Vec.From(s.c2), p1: Vec.From(s.p1) }))
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

/** Several geometries drawn as one shape (e.g. a geo shape and its label). */
export class Group2d extends Geometry2d {
  readonly children: Geometry2d[]
  constructor(opts: { children: Geometry2d[] }) {
    super({ isFilled: opts.children.some((c) => c.isFilled), isClosed: opts.children.some((c) => c.isClosed) })
    this.children = opts.children
  }
  getVertices(): Vec[] {
    return this.children.flatMap((c) => c.vertices)
  }
  toPathWords(): number[] {
    return this.children.filter((c) => !c.isLabel).flatMap((c) => c.toPathWords())
  }
  override nearestPoint(point: VecLike): Vec {
    let best = new Vec()
    let bestD = Infinity
    for (const c of this.children) {
      const p = c.nearestPoint(point)
      const d = Vec.Dist2(p, point)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }
  override hitTestPoint(point: VecLike, margin = 0, hitInside = false): boolean {
    return this.children.some((c) => c.hitTestPoint(point, margin, hitInside))
  }
}
