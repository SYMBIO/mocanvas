/**
 * A 2D affine transform, stored as the six values of the matrix
 *
 * ```
 * | a  c  e |
 * | b  d  f |
 * | 0  0  1 |
 * ```
 *
 * This is what turns shape-local coordinates into page coordinates and back, so
 * nothing about nesting, rotation or flipping is correct without it. The
 * components are plain fields, so anything that already reads `.a`…`.f` off a
 * transform object keeps working; the methods are what let a caller push a point
 * through one without unpacking it by hand.
 *
 * Like {@link Vec} and {@link Box}, the instance methods that *change* the
 * matrix mutate and return `this`, and the capitalised statics are their pure
 * counterparts.
 */
import { Box, type BoxLike } from "./Box"
import { Vec, type VecLike } from "./Vec"

/** The structural form of a {@link Mat}: any object carrying the six components. */
export interface MatLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** A `Mat` compatible alias, matching the name transforms are usually given. */
export type MatModel = MatLike

/** The translation, rotation and per-axis scale a transform is made of. */
export interface DecomposedMat {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export class Mat {
  constructor(
    public a: number,
    public b: number,
    public c: number,
    public d: number,
    public e: number,
    public f: number,
  ) {}

  // ---- construction ---------------------------------------------------------

  static Identity(): Mat {
    return new Mat(1, 0, 0, 1, 0, 0)
  }

  /** Adopt any `{a,b,c,d,e,f}` — including the plain literals used internally. */
  static From(m: MatLike): Mat {
    return new Mat(m.a, m.b, m.c, m.d, m.e, m.f)
  }

  /** `m` itself when it is already a `Mat`, otherwise a `Mat` copy of it. */
  static Cast(m: MatLike): Mat {
    return m instanceof Mat ? m : Mat.From(m)
  }

  /** A pure translation. */
  static Translate(x: number, y: number): Mat {
    return new Mat(1, 0, 0, 1, x, y)
  }

  /** A pure rotation, about the origin or about `(cx, cy)` when given. */
  static Rotate(r: number, cx?: number, cy?: number): Mat {
    if (r === 0) return Mat.Identity()
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    if (cx === undefined) return new Mat(cos, sin, -sin, cos, 0, 0)
    const py = cy ?? 0
    return new Mat(cos, sin, -sin, cos, cx - cx * cos + py * sin, py - cx * sin - py * cos)
  }

  /** A pure scale. */
  static Scale(x: number, y: number): Mat {
    return new Mat(x, 0, 0, y, 0, 0)
  }

  /**
   * The product of every transform given, left to right — `Compose(parent, child)`
   * is the parent's transform followed by the child's, which is the order a
   * shape hierarchy composes in. With no arguments this is the identity.
   */
  static Compose(...matrices: MatLike[]): Mat {
    const result = Mat.Identity()
    for (const m of matrices) result.multiply(m)
    return result
  }

  /** `m` then `n`, i.e. the matrix product `m × n`. */
  static Multiply(m: MatLike, n: MatLike): Mat {
    return new Mat(
      m.a * n.a + m.c * n.b,
      m.b * n.a + m.d * n.b,
      m.a * n.c + m.c * n.d,
      m.b * n.c + m.d * n.d,
      m.a * n.e + m.c * n.f + m.e,
      m.b * n.e + m.d * n.f + m.f,
    )
  }

  /** The inverse of any `{a…f}`, as a new `Mat`. See {@link Mat.invert}. */
  static Inverse(m: MatLike): Mat {
    return Mat.From(m).invert()
  }

  /**
   * The transform with any reflection taken out of it, so that both axes scale
   * positively and only the rotation carries the orientation.
   *
   * SEMANTICS-ASSUMED: the docs give the name and signature only. "Absolute"
   * reading as "absolute scale" is the interpretation that makes it useful —
   * it is what lets a mirrored shape be measured without its own flip
   * confusing the measurement.
   */
  static Absolute(m: MatLike): Mat {
    const d = Mat.Decompose(m)
    return Mat.Compose(Mat.Translate(d.x, d.y), Mat.Rotate(d.rotation), Mat.Scale(Math.abs(d.scaleX), Math.abs(d.scaleY)))
  }

  /** Every component rounded, to keep float dust out of a serialized transform. */
  static Smooth(m: MatLike, precision = 10000): Mat {
    const round = (n: number) => Math.round(n * precision) / precision
    return new Mat(round(m.a), round(m.b), round(m.c), round(m.d), round(m.e), round(m.f))
  }

  // ---- statics: application -------------------------------------------------

  /** Where `m` sends the origin, i.e. its translation component. */
  static Point(m: MatLike): Vec {
    return new Vec(m.e, m.f)
  }

  /** Push `(x, y)` through `m`, as a bare pair. */
  static applyToXY(m: MatLike, x: number, y: number): number[] {
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
  }

  /**
   * The axis-aligned box containing `box` after `m` is applied. A rotation makes
   * this larger than the original — it is the bounding box of the transformed
   * rectangle, not the transformed rectangle.
   */
  static applyToBounds(m: MatLike, box: BoxLike): Box {
    return Box.FromPoints(Box.From(box).corners.map((p) => new Vec(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f)))
  }

  // ---- statics: decomposition -----------------------------------------------

  static Decompose(m: MatLike): DecomposedMat {
    return {
      x: m.e,
      y: m.f,
      scaleX: Math.hypot(m.a, m.b),
      scaleY: Math.hypot(m.c, m.d),
      rotation: Math.atan2(m.b, m.a),
    }
  }

  /** The rotation `m` encodes, in radians, normalized to `[0, 2π)`. */
  static Rotation(m: MatLike): number {
    let rotation: number
    if (m.a !== 0 || m.c !== 0) {
      const hypotAc = Math.hypot(m.a, m.c)
      rotation = Math.acos(m.a / hypotAc) * (m.c > 0 ? -1 : 1)
    } else if (m.b !== 0 || m.d !== 0) {
      const hypotBd = Math.hypot(m.b, m.d)
      rotation = Math.PI / 2 + Math.acos(m.b / hypotBd) * (m.d > 0 ? -1 : 1)
    } else {
      // A fully degenerate matrix encodes no angle at all; 0 keeps callers out of NaN.
      rotation = 0
    }
    const tau = Math.PI * 2
    return (tau + rotation) % tau
  }

  // ---- instance: builders (mutate, return `this`) ---------------------------

  /**
   * Post-multiply this transform by `m`, in place.
   *
   * SEMANTICS-ASSUMED: the chainable builders (`multiply`, `translate`,
   * `rotate`, `scale`) mutate and return `this` rather than returning a copy.
   * The call sites are all of the form `Mat.Identity().translate(x, y).rotate(r)`
   * — a fresh matrix built up in one expression — which reads the same either
   * way, and mutating matches how `Vec.add`/`Vec.mul` behave. Callers holding a
   * matrix they did not create should `clone()` first.
   */
  multiply(m: MatLike): this {
    const { a, b, c, d, e, f } = this
    this.a = a * m.a + c * m.b
    this.b = b * m.a + d * m.b
    this.c = a * m.c + c * m.d
    this.d = b * m.c + d * m.d
    this.e = a * m.e + c * m.f + e
    this.f = b * m.e + d * m.f + f
    return this
  }

  /**
   * Post-multiply this transform by `m`, in place.
   *
   * @deprecated Use {@link Mat.multiply}, the documented name.
   */
  multiplyBy(m: MatLike): this {
    return this.multiply(m)
  }

  /** Translate by `(x, y)` in this transform's own space, in place. */
  translate(x: number, y: number): this {
    this.e += this.a * x + this.c * y
    this.f += this.b * x + this.d * y
    return this
  }

  /**
   * Rotate by `r` radians about this transform's own origin, or about
   * `(cx, cy)` in its own space when given. A zero angle short-circuits, so an
   * unrotated shape's transform stays free of `cos`/`sin` float dust.
   */
  rotate(r: number, cx?: number, cy?: number): this {
    if (r === 0) return this
    if (cx !== undefined) return this.multiply(Mat.Rotate(r, cx, cy))
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    const { a, b, c, d } = this
    this.a = a * cos + c * sin
    this.b = b * cos + d * sin
    this.c = c * cos - a * sin
    this.d = d * cos - b * sin
    return this
  }

  /** Scale by `(x, y)` in this transform's own space, in place. */
  scale(x: number, y: number = x): this {
    this.a *= x
    this.b *= x
    this.c *= y
    this.d *= y
    return this
  }

  /** Reset to the identity, in place. */
  identity(): this {
    this.a = 1
    this.b = 0
    this.c = 0
    this.d = 1
    this.e = 0
    this.f = 0
    return this
  }

  /** Adopt every component of `model`, in place. */
  setTo(model: MatLike): this {
    this.a = model.a
    this.b = model.b
    this.c = model.c
    this.d = model.d
    this.e = model.e
    this.f = model.f
    return this
  }

  /**
   * Invert this transform in place, for going from page space back into shape
   * space. A singular matrix (a zero-scale shape) has no inverse; it becomes the
   * identity rather than a field of `NaN`s, so a degenerate shape maps points to
   * themselves instead of poisoning everything downstream.
   */
  invert(): this {
    const { a, b, c, d, e, f } = this
    const det = a * d - b * c
    if (det === 0 || !Number.isFinite(det)) return this.identity()
    this.a = d / det
    this.b = -b / det
    this.c = -c / det
    this.d = a / det
    this.e = (c * f - d * e) / det
    this.f = (b * e - a * f) / det
    return this
  }

  // ---- instance: questions --------------------------------------------------

  /** Push a point through the transform. */
  applyToPoint(point: VecLike): Vec {
    return new Vec(this.a * point.x + this.c * point.y + this.e, this.b * point.x + this.d * point.y + this.f)
  }

  applyToPoints(points: readonly VecLike[]): Vec[] {
    return points.map((p) => this.applyToPoint(p))
  }

  /** The translation component, i.e. where this transform sends the origin. */
  point(): Vec {
    return new Vec(this.e, this.f)
  }

  /** The rotation this transform encodes, in radians, normalized to `[0, 2π)`. */
  rotation(): number {
    return Mat.Rotation(this)
  }

  decompose(): DecomposedMat {
    return Mat.Decompose(this)
  }

  /** An alias of {@link Mat.decompose}. */
  decomposed(): DecomposedMat {
    return Mat.Decompose(this)
  }

  equals(m: MatLike): boolean {
    return this.a === m.a && this.b === m.b && this.c === m.c && this.d === m.d && this.e === m.e && this.f === m.f
  }

  /** The uniform scale this transform applies, as the mean of its two axes. */
  getScale(): number {
    return (Math.hypot(this.a, this.b) + Math.hypot(this.c, this.d)) / 2
  }

  /** The rotation this transform applies, in radians, signed. */
  getRotation(): number {
    return Math.atan2(this.b, this.a)
  }

  clone(): Mat {
    return new Mat(this.a, this.b, this.c, this.d, this.e, this.f)
  }

  toCssString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
  }

  /** The six components as a plain object. */
  toJson(): MatModel {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f }
  }
}
