/**
 * The 2D vector every point in the editor is expressed in.
 *
 * A `Vec` carries a third component, `z`, which is *not* a spatial axis: it is
 * the pen pressure that came with the point, so a stroke recorded on a stylus
 * survives every transform the point goes through. Everything geometric ignores
 * it.
 *
 * The instance surface follows one rule, and the rule is worth stating because
 * it is what makes long chains cheap: a method that **transforms** the vector
 * mutates it and returns `this`, so `v.sub(o).uni().mul(r)` allocates once; a
 * method that only **asks** something — a length, a dot product, a comparison —
 * is pure and allocates nothing. The capitalised statics are the pure form of
 * every transform, for when you must not touch the input.
 */

/** Anything with an `x` and a `y`: the shape almost every API here accepts. */
export interface VecLike {
  x: number
  y: number
  z?: number | undefined
}

/** The serialized form of a {@link Vec}, as it is stored in shape props. */
export interface VecModel {
  x: number
  y: number
  z?: number | undefined
}

/**
 * The pressure reported for a point that never recorded one. `1` so that `z` is
 * a multiplier a renderer can apply unconditionally.
 *
 * The field itself stays `undefined` in that case rather than defaulting to 1:
 * a vector built by ordinary geometry then serializes, compares and prints as
 * the plain `{ x, y }` it has always been, and only a point that really came
 * from a stylus carries a third component.
 */
const DEFAULT_PRESSURE = 1

export class Vec {
  constructor(
    public x = 0,
    public y = 0,
    public z: number | undefined = undefined,
  ) {}

  /**
   * The pen pressure this point was recorded with, in `[0, 1]`. An alias for
   * `z`, named for what it means rather than which slot it sits in.
   *
   * SEMANTICS-ASSUMED: the docs give `pressure` as a read-only getter alongside
   * a writable `z` but do not say how the two relate. Making it a plain alias is
   * the only reading under which both can be true at once.
   */
  get pressure(): number {
    return this.z ?? DEFAULT_PRESSURE
  }

  // ---- construction ---------------------------------------------------------

  static From({ x, y, z }: VecLike): Vec {
    return new Vec(x, y, z)
  }

  /** `A` itself when it is already a `Vec`, otherwise a `Vec` copy of it. */
  static Cast(A: VecLike): Vec {
    return A instanceof Vec ? A : Vec.From(A)
  }

  static FromArray(v: number[]): Vec {
    return new Vec(v[0] ?? 0, v[1] ?? 0, v[2])
  }

  /** The vector `length` units long pointing at `r` radians. */
  static FromAngle(r: number, length = 1): Vec {
    return new Vec(Math.cos(r) * length, Math.sin(r) * length)
  }

  // ---- arithmetic -----------------------------------------------------------

  static Add(A: VecLike, B: VecLike): Vec {
    return new Vec(A.x + B.x, A.y + B.y)
  }
  static AddXY(A: VecLike, x: number, y: number): Vec {
    return new Vec(A.x + x, A.y + y)
  }
  static AddScalar(A: VecLike, n: number): Vec {
    return new Vec(A.x + n, A.y + n)
  }
  static Sub(A: VecLike, B: VecLike): Vec {
    return new Vec(A.x - B.x, A.y - B.y)
  }
  static SubXY(A: VecLike, x: number, y: number): Vec {
    return new Vec(A.x - x, A.y - y)
  }
  static SubScalar(A: VecLike, n: number): Vec {
    return new Vec(A.x - n, A.y - n)
  }
  static Mul(A: VecLike, t: number): Vec {
    return new Vec(A.x * t, A.y * t)
  }
  /** Component-wise multiply, i.e. a non-uniform scale. */
  static MulV(A: VecLike, B: VecLike): Vec {
    return new Vec(A.x * B.x, A.y * B.y)
  }
  static Div(A: VecLike, t: number): Vec {
    return new Vec(A.x / t, A.y / t)
  }
  /** Component-wise divide. */
  static DivV(A: VecLike, B: VecLike): Vec {
    return new Vec(A.x / B.x, A.y / B.y)
  }
  static Neg(A: VecLike): Vec {
    return new Vec(-A.x, -A.y)
  }
  static Abs(A: VecLike): Vec {
    return new Vec(Math.abs(A.x), Math.abs(A.y))
  }
  static Min(A: VecLike, B: VecLike): Vec {
    return new Vec(Math.min(A.x, B.x), Math.min(A.y, B.y))
  }
  static Max(A: VecLike, B: VecLike): Vec {
    return new Vec(Math.max(A.x, B.x), Math.max(A.y, B.y))
  }
  /**
   * Both components clamped into `[min, max]`. With no `max`, `min` is a floor
   * only — the form you want when clamping a size away from zero.
   *
   * SEMANTICS-ASSUMED: the one-bound overload is documented but not described;
   * a lone lower bound is the only reading that makes `Clamp(v, 0)` useful.
   */
  static Clamp(A: VecLike, min: number, max?: number): Vec {
    if (max === undefined) return new Vec(Math.max(A.x, min), Math.max(A.y, min))
    return new Vec(Math.min(Math.max(A.x, min), max), Math.min(Math.max(A.y, min), max))
  }

  // ---- products and lengths -------------------------------------------------

  static Len(A: VecLike): number {
    return Math.hypot(A.x, A.y)
  }
  static Len2(A: VecLike): number {
    return A.x * A.x + A.y * A.y
  }
  static Dist(A: VecLike, B: VecLike): number {
    return Math.hypot(A.x - B.x, A.y - B.y)
  }
  static Dist2(A: VecLike, B: VecLike): number {
    const dx = A.x - B.x
    const dy = A.y - B.y
    return dx * dx + dy * dy
  }
  /** Whether `A` and `B` are closer together than `n`, without taking a root. */
  static DistMin(A: VecLike, B: VecLike, n: number): boolean {
    return Vec.Dist2(A, B) < n * n
  }
  /** Distance along the axes rather than through them — the taxicab metric. */
  static ManhattanDist(A: VecLike, B: VecLike): number {
    return Math.abs(A.x - B.x) + Math.abs(A.y - B.y)
  }
  /** The dot product. */
  static Dpr(A: VecLike, B: VecLike): number {
    return A.x * B.x + A.y * B.y
  }
  /**
   * The scalar cross product, i.e. the signed area of the parallelogram `A` and
   * `B` span. Positive when `B` is counter-clockwise of `A` in maths axes, which
   * on a y-down canvas reads as clockwise.
   */
  static Cpr(A: VecLike, B: VecLike): number {
    return A.x * B.y - A.y * B.x
  }
  /**
   * The full 3D cross product, taking `z` as a real axis. Rarely what a 2D
   * caller wants — see {@link Vec.Cpr} for the signed area, which is the `z` of
   * this result.
   *
   * SEMANTICS-ASSUMED: the docs give `Cross` a `Vec` return and `Cpr` a number,
   * which only makes sense if `Cross` is the vector product; a point with no
   * recorded pressure is read as sitting at the default depth.
   */
  static Cross(A: VecLike, V: VecLike): Vec {
    const az = A.z ?? DEFAULT_PRESSURE
    const vz = V.z ?? DEFAULT_PRESSURE
    return new Vec(A.y * vz - az * V.y, az * V.x - A.x * vz, A.x * V.y - A.y * V.x)
  }
  /**
   * The dot product, under its older name.
   *
   * @deprecated Use {@link Vec.Dpr}, the documented name.
   */
  static Dot(A: VecLike, B: VecLike): number {
    return Vec.Dpr(A, B)
  }
  /** How far along `B` the projection of `A` lands. */
  static Pry(A: VecLike, B: VecLike): number {
    const l = Vec.Len(B)
    return l === 0 ? 0 : Vec.Dpr(A, B) / l
  }

  // ---- directions and angles ------------------------------------------------

  /** `A` scaled to unit length. A zero vector has no direction and stays zero. */
  static Uni(A: VecLike): Vec {
    const l = Vec.Len(A)
    return l === 0 ? new Vec() : Vec.Div(A, l)
  }
  /** `A` scaled to length `n`, keeping its direction. */
  static Rescale(A: VecLike, n: number): Vec {
    return Vec.Mul(Vec.Uni(A), n)
  }
  /** A quarter turn: `(x, y)` becomes `(-y, x)`. */
  static Per(A: VecLike): Vec {
    return new Vec(-A.y, A.x)
  }
  static Rot(A: VecLike, r = 0): Vec {
    const s = Math.sin(r)
    const c = Math.cos(r)
    return new Vec(A.x * c - A.y * s, A.x * s + A.y * c)
  }
  static RotWith(A: VecLike, C: VecLike, r: number): Vec {
    const p = Vec.Rot(Vec.Sub(A, C), r)
    return new Vec(p.x + C.x, p.y + C.y)
  }
  /** `A` scaled about `origin` rather than about the page origin. */
  static ScaleWithOrigin(A: VecLike, scale: number, origin: VecLike): Vec {
    return Vec.Add(Vec.Mul(Vec.Sub(A, origin), scale), origin)
  }
  /** The angle from `A` to `B`, in radians. */
  static Angle(A: VecLike, B: VecLike): number {
    return Math.atan2(B.y - A.y, B.x - A.x)
  }
  /** The direction `A` points in, normalized to `[0, 2π)`. */
  static ToAngle(A: VecLike): number {
    const angle = Math.atan2(A.y, A.x)
    return angle < 0 ? angle + Math.PI * 2 : angle
  }
  /**
   * The signed angle you would turn through to get from direction `A` to
   * direction `B`, in `(-π, π]`.
   *
   * SEMANTICS-ASSUMED: the docs give only the signature. Reading the arguments
   * as directions (rather than as two positions, which {@link Vec.Angle} already
   * covers) is what makes this distinct from `Angle`.
   */
  static AngleBetween(A: VecLike, B: VecLike): number {
    return Math.atan2(Vec.Cpr(A, B), Vec.Dpr(A, B))
  }
  /** The gradient of the line `A`→`B`; `NaN` for a vertical or degenerate one. */
  static Slope(A: VecLike, B: VecLike): number {
    if (A.x === B.x) return Number.NaN
    return (A.y - B.y) / (A.x - B.x)
  }
  /** The unit direction from `B` towards `A`. */
  static Tan(A: VecLike, B: VecLike): Vec {
    return Vec.Uni(Vec.Sub(A, B))
  }
  /** Whether the turn `A`→`B`→`C` goes clockwise in screen (y-down) axes. */
  static Clockwise(A: VecLike, B: VecLike, C: VecLike): boolean {
    return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x) < 0
  }

  // ---- interpolation --------------------------------------------------------

  static Lrp(A: VecLike, B: VecLike, t: number): Vec {
    return new Vec(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t)
  }
  /** The midpoint of `A` and `B`. */
  static Med(A: VecLike, B: VecLike): Vec {
    return new Vec((A.x + B.x) / 2, (A.y + B.y) / 2)
  }
  /** `A` moved `distance` units towards `B`. */
  static Nudge(A: VecLike, B: VecLike, distance: number): Vec {
    return Vec.Add(A, Vec.Mul(Vec.Uni(Vec.Sub(B, A)), distance))
  }
  /** The average of every vector given; the zero vector for an empty list. */
  static Average(arr: VecLike[]): Vec {
    if (arr.length === 0) return new Vec()
    let x = 0
    let y = 0
    for (const p of arr) {
      x += p.x
      y += p.y
    }
    return new Vec(x / arr.length, y / arr.length)
  }
  /**
   * `steps` points spread from `A` to `B` inclusive, optionally eased. Used to
   * turn a jump — a camera move, an animated nudge — into something to tween
   * along.
   */
  static PointsBetween(A: VecModel, B: VecModel, steps = 6, ease?: (t: number) => number): Vec[] {
    if (steps < 2) return [Vec.From(A), Vec.From(B)]
    const out: Vec[] = []
    for (let i = 0; i < steps; i++) {
      const raw = i / (steps - 1)
      const t = ease ? ease(raw) : raw
      const p = Vec.Lrp(A, B, t)
      // Pressure ramps with the raw parameter, not the eased one: it describes
      // the stroke, not the timing of the tween. Two pressureless points stay
      // pressureless rather than acquiring a default.
      if (A.z !== undefined || B.z !== undefined) {
        const from = A.z ?? DEFAULT_PRESSURE
        const to = B.z ?? DEFAULT_PRESSURE
        p.z = from + (to - from) * raw
      }
      out.push(p)
    }
    return out
  }

  // ---- lines ----------------------------------------------------------------

  /**
   * The point on the segment `A`→`B` closest to `P`. With `clamp` false the
   * segment is treated as the infinite line through `A` and `B`.
   */
  static NearestPointOnLineSegment(A: VecLike, B: VecLike, P: VecLike, clamp = true): Vec {
    const ab = Vec.Sub(B, A)
    const l2 = Vec.Dpr(ab, ab)
    if (l2 === 0) return Vec.From(A)
    let t = Vec.Dpr(Vec.Sub(P, A), ab) / l2
    if (clamp) t = Math.max(0, Math.min(1, t))
    return Vec.Add(A, Vec.Mul(ab, t))
  }
  static DistanceToLineSegment(A: VecLike, B: VecLike, P: VecLike, clamp = true): number {
    return Vec.Dist(P, Vec.NearestPointOnLineSegment(A, B, P, clamp))
  }
  /** The point closest to `P` on the infinite line through `A` in direction `u`. */
  static NearestPointOnLineThroughPoint(A: VecLike, u: VecLike, P: VecLike): Vec {
    return Vec.Add(A, Vec.Mul(u, Vec.Dpr(Vec.Sub(P, A), u)))
  }
  static DistanceToLineThroughPoint(A: VecLike, u: VecLike, P: VecLike): number {
    return Vec.Dist(P, Vec.NearestPointOnLineThroughPoint(A, u, P))
  }

  // ---- snapping and rounding ------------------------------------------------

  /** Both components rounded to the nearest multiple of `step`. */
  static Snap(A: VecLike, step = 1): Vec {
    return new Vec(Math.round(A.x / step) * step, Math.round(A.y / step) * step)
  }
  static SnapToGrid(A: VecLike, gridSize = 8): Vec {
    return Vec.Snap(A, gridSize)
  }
  static ToFixed(A: VecLike, precision = 2): Vec {
    return new Vec(Number(A.x.toFixed(precision)), Number(A.y.toFixed(precision)))
  }
  /** Both components truncated towards zero. */
  static ToInt(A: VecLike): Vec {
    return new Vec(Math.trunc(A.x), Math.trunc(A.y))
  }

  // ---- predicates -----------------------------------------------------------

  static Equals(A: VecLike, B: VecLike): boolean {
    return A.x === B.x && A.y === B.y
  }
  static EqualsXY(A: VecLike, x: number, y: number): boolean {
    return A.x === x && A.y === y
  }
  static IsNaN(A: VecLike): boolean {
    return Number.isNaN(A.x) || Number.isNaN(A.y)
  }
  static IsFinite(A: VecLike): boolean {
    return Number.isFinite(A.x) && Number.isFinite(A.y)
  }

  // ---- conversion -----------------------------------------------------------

  static ToArray(A: VecLike): number[] {
    return [A.x, A.y]
  }
  static ToJson(A: VecLike): VecModel {
    return A.z === undefined ? { x: A.x, y: A.y } : { x: A.x, y: A.y, z: A.z }
  }
  static ToString(A: VecLike): string {
    return `${A.x}, ${A.y}`
  }
  /**
   * The vector as a CSS `translate()`.
   *
   * SEMANTICS-ASSUMED: the docs give only `(A: VecLike) => string`. A ready-to-use
   * transform is the only form that earns the "Css" in the name; a bare
   * `"x,y"` pair is already {@link Vec.ToString}.
   */
  static ToCss(A: VecLike): string {
    return `translate(${A.x}px, ${A.y}px)`
  }

  // ---- instance: transforms (mutate, return `this`) -------------------------

  add(V: VecLike): this {
    this.x += V.x
    this.y += V.y
    return this
  }
  addXY(x: number, y: number): this {
    this.x += x
    this.y += y
    return this
  }
  addScalar(n: number): this {
    this.x += n
    this.y += n
    return this
  }
  sub(V: VecLike): this {
    this.x -= V.x
    this.y -= V.y
    return this
  }
  subXY(x: number, y: number): this {
    this.x -= x
    this.y -= y
    return this
  }
  subScalar(n: number): this {
    this.x -= n
    this.y -= n
    return this
  }
  mul(t: number): this {
    this.x *= t
    this.y *= t
    return this
  }
  mulV(V: VecLike): this {
    this.x *= V.x
    this.y *= V.y
    return this
  }
  div(t: number): this {
    this.x /= t
    this.y /= t
    return this
  }
  divV(V: VecLike): this {
    this.x /= V.x
    this.y /= V.y
    return this
  }
  neg(): this {
    this.x = -this.x
    this.y = -this.y
    return this
  }
  abs(): this {
    this.x = Math.abs(this.x)
    this.y = Math.abs(this.y)
    return this
  }
  /** Clamp both components into `[min, max]`; with no `max`, a floor only. */
  clamp(min: number, max?: number): this {
    const c = Vec.Clamp(this, min, max)
    this.x = c.x
    this.y = c.y
    return this
  }
  /** Scale to unit length. A zero vector has no direction and stays at zero. */
  uni(): this {
    const l = this.len()
    if (l !== 0) {
      this.x /= l
      this.y /= l
    }
    return this
  }
  /** Rotate a quarter turn: `(x, y)` becomes `(-y, x)`. */
  per(): this {
    const x = this.x
    this.x = -this.y
    this.y = x
    return this
  }
  rot(r: number): this {
    const s = Math.sin(r)
    const c = Math.cos(r)
    const x = this.x
    this.x = x * c - this.y * s
    this.y = x * s + this.y * c
    return this
  }
  rotWith(C: VecLike, r: number): this {
    const p = Vec.RotWith(this, C, r)
    this.x = p.x
    this.y = p.y
    return this
  }
  /** Move this point `distance` units towards `B`. */
  nudge(B: VecLike, distance: number): this {
    const p = Vec.Nudge(this, B, distance)
    this.x = p.x
    this.y = p.y
    return this
  }
  /** The full 3D cross product with `V`, written back into this vector. */
  cross(V: VecLike): this {
    const c = Vec.Cross(this, V)
    this.x = c.x
    this.y = c.y
    this.z = c.z
    return this
  }
  lrp(B: VecLike, t: number): this {
    this.x += (B.x - this.x) * t
    this.y += (B.y - this.y) * t
    return this
  }
  setTo(B: VecLike): this {
    this.x = B.x
    this.y = B.y
    if (B.z !== undefined) this.z = B.z
    return this
  }
  set(x = this.x, y = this.y, z: number | undefined = this.z): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  /** Round each axis to the nearest multiple of `gridSize`. */
  snapToGrid(gridSize: number): this {
    if (gridSize > 0) {
      this.x = Math.round(this.x / gridSize) * gridSize
      this.y = Math.round(this.y / gridSize) * gridSize
    }
    return this
  }
  /** Round each axis to `precision` decimal places, in place. */
  toFixed(precision = 2): this {
    this.x = Number(this.x.toFixed(precision))
    this.y = Number(this.y.toFixed(precision))
    return this
  }

  // ---- instance: questions (pure) -------------------------------------------

  len(): number {
    return Math.hypot(this.x, this.y)
  }
  /** Squared length — the comparison you want when you do not need the root. */
  len2(): number {
    return this.x * this.x + this.y * this.y
  }
  dist(V: VecLike): number {
    return Math.hypot(this.x - V.x, this.y - V.y)
  }
  dist2(V: VecLike): number {
    const dx = this.x - V.x
    const dy = this.y - V.y
    return dx * dx + dy * dy
  }
  distanceToLineSegment(A: VecLike, B: VecLike): number {
    return Vec.DistanceToLineSegment(A, B, this)
  }
  /** The dot product. */
  dpr(V: VecLike): number {
    return this.x * V.x + this.y * V.y
  }
  /**
   * The dot product, under its older name.
   *
   * @deprecated Use {@link Vec.dpr}, the documented name.
   */
  dot(V: VecLike): number {
    return this.dpr(V)
  }
  /** The scalar cross product — see {@link Vec.Cpr}. */
  cpr(V: VecLike): number {
    return this.x * V.y - this.y * V.x
  }
  /** How far along `V` the projection of this vector lands. */
  pry(V: VecLike): number {
    return Vec.Pry(this, V)
  }
  /** The angle from this point to `B`, in radians. */
  angle(B: VecLike): number {
    return Math.atan2(B.y - this.y, B.x - this.x)
  }
  /** The direction this vector points in, normalized to `[0, 2π)`. */
  toAngle(): number {
    return Vec.ToAngle(this)
  }
  /** The gradient of the line to `B`; `NaN` for a vertical one. */
  slope(B: VecLike): number {
    return Vec.Slope(this, B)
  }
  /** The unit direction from `V` towards this point. */
  tan(V: VecLike): Vec {
    return Vec.Tan(this, V)
  }
  equals(B: VecLike): boolean {
    return this.x === B.x && this.y === B.y
  }
  equalsXY(x: number, y: number): boolean {
    return this.x === x && this.y === y
  }
  /** Equality with a tolerance, for values that have been through a transform. */
  equalsApprox(B: VecLike, epsilon = 0.0001): boolean {
    return Math.abs(this.x - B.x) <= epsilon && Math.abs(this.y - B.y) <= epsilon
  }
  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y)
  }
  toArray(): number[] {
    return [this.x, this.y]
  }
  toString(): string {
    return `${this.x}, ${this.y}`
  }
  clone(): Vec {
    return new Vec(this.x, this.y, this.z)
  }
  /**
   * The serialized form. `z` is omitted unless a real pressure was recorded, so
   * geometry-derived points round-trip as the plain `{ x, y }` they have always
   * been stored as.
   */
  toJson(): VecModel {
    return this.z === undefined ? { x: this.x, y: this.y } : { x: this.x, y: this.y, z: this.z }
  }
}
