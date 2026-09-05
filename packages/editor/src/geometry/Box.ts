/**
 * An axis-aligned rectangle: the currency of bounds, viewports, selections and
 * brushes.
 *
 * `Box` follows the same split as {@link Vec}. A method that *changes* the box
 * mutates it and returns `this`; a method that only *asks* something is pure.
 * The capitalised statics are the pure form of each mutator, for when the input
 * must not be touched.
 */
import { Vec, type VecLike } from "./Vec"
import { approximately } from "./utils"
import { ROTATE_CORNER_TO_SELECTION_CORNER, type RotateCorner, type SelectionCorner, type SelectionEdge } from "./handles"

/** Anything with an `x`, `y`, `w` and `h`. */
export interface BoxLike {
  x: number
  y: number
  w: number
  h: number
}

/** The serialized form of a {@link Box}, as it is stored in records. */
export type BoxModel = BoxLike

/** A handle name `Box.Resize` and `Box.getHandlePoint` accept. */
export type BoxHandle = SelectionCorner | SelectionEdge

export class Box {
  constructor(
    public x = 0,
    public y = 0,
    public w = 0,
    public h = 0,
  ) {}

  // ---- construction ---------------------------------------------------------

  static From(box: BoxModel): Box {
    return new Box(box.x, box.y, box.w, box.h)
  }

  /** The box of the given size centred on `center`. */
  static FromCenter(center: VecLike, size: VecLike): Box {
    return new Box(center.x - size.x / 2, center.y - size.y / 2, size.x, size.y)
  }

  /** The smallest box containing every point. Empty input gives an empty box. */
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

  /** The smallest box containing every box given. */
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

  // ---- statics: predicates --------------------------------------------------

  /** Whether `B` lies entirely inside `A`. Touching edges count as inside. */
  static Contains(A: BoxLike, B: BoxLike): boolean {
    return B.x >= A.x && B.y >= A.y && B.x + B.w <= A.x + A.w && B.y + B.h <= A.y + A.h
  }

  /** {@link Box.Contains}, but tolerant of float dust from a transform. */
  static ContainsApproximately(A: BoxLike, B: BoxLike, precision = 0.000001): boolean {
    return (
      (B.x > A.x || approximately(B.x, A.x, precision)) &&
      (B.y > A.y || approximately(B.y, A.y, precision)) &&
      (B.x + B.w < A.x + A.w || approximately(B.x + B.w, A.x + A.w, precision)) &&
      (B.y + B.h < A.y + A.h || approximately(B.y + B.h, A.y + A.h, precision))
    )
  }

  static ContainsPoint(A: BoxLike, B: VecLike, margin = 0): boolean {
    return B.x >= A.x - margin && B.y >= A.y - margin && B.x <= A.x + A.w + margin && B.y <= A.y + A.h + margin
  }

  /** Whether `A` and `B` overlap at all. Touching edges count as colliding. */
  static Collides(A: BoxLike, B: BoxLike): boolean {
    return A.x <= B.x + B.w && A.x + A.w >= B.x && A.y <= B.y + B.h && A.y + A.h >= B.y
  }

  /**
   * Whether `A` either contains `B` or overlaps it — i.e. whether `B` has any
   * part in `A` at all. This is what a marquee uses when it selects on touch
   * rather than on enclosure.
   */
  static Includes(A: BoxLike, B: BoxLike): boolean {
    return Box.Contains(A, B) || Box.Collides(A, B)
  }

  static Equals(a: BoxLike, b: BoxLike): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  }

  // ---- statics: derivation --------------------------------------------------

  /**
   * The smallest box containing both `A` and `B`.
   *
   * @param A - the box to grow
   * @param B - the box to grow it around, or, in the deprecated scalar form,
   * the amount to grow it by on every side.
   */
  static Expand(A: BoxLike, B: BoxLike): Box
  /** @deprecated Use {@link Box.ExpandBy}, which is what a number here means. */
  static Expand(A: BoxLike, n: number): Box
  static Expand(A: BoxLike, B: BoxLike | number): Box {
    if (typeof B === "number") return Box.ExpandBy(A, B)
    const minX = Math.min(A.x, B.x)
    const minY = Math.min(A.y, B.y)
    const maxX = Math.max(A.x + A.w, B.x + B.w)
    const maxY = Math.max(A.y + A.h, B.y + B.h)
    return Box.FromMinMax(minX, minY, maxX, maxY)
  }

  /** `A` grown by `n` on every side. A negative `n` shrinks it. */
  static ExpandBy(A: BoxLike, n: number): Box {
    return new Box(A.x - n, A.y - n, A.w + 2 * n, A.h + 2 * n)
  }

  /**
   * The four sides as point pairs, in clockwise order from the top edge. An
   * `inset` pulls each side's endpoints in along the edge, which is how an edge
   * handle avoids covering the corners next to it.
   */
  static Sides(A: BoxLike, inset = 0): [Vec, Vec][] {
    const tl = new Vec(A.x, A.y)
    const tr = new Vec(A.x + A.w, A.y)
    const br = new Vec(A.x + A.w, A.y + A.h)
    const bl = new Vec(A.x, A.y + A.h)
    if (inset === 0) {
      return [
        [tl, tr],
        [tr, br],
        [br, bl],
        [bl, tl],
      ]
    }
    const shrink = (a: Vec, b: Vec): [Vec, Vec] => {
      const d = Vec.Uni(Vec.Sub(b, a))
      return [Vec.Add(a, Vec.Mul(d, inset)), Vec.Sub(b, Vec.Mul(d, inset))]
    }
    return [shrink(tl, tr), shrink(tr, br), shrink(br, bl), shrink(bl, tl)]
  }

  /**
   * A copy of `other` with any negative width or height folded back into its
   * position, so that a box dragged up and to the left still reads left-to-right.
   */
  static ZeroFix(other: BoxLike): Box {
    return new Box(
      other.w < 0 ? other.x + other.w : other.x,
      other.h < 0 ? other.y + other.h : other.y,
      Math.abs(other.w),
      Math.abs(other.h),
    )
  }

  /**
   * `box` after dragging `handle` by `(dx, dy)`, as a fresh box. Dragging a side
   * past its opposite flips the box rather than producing a negative size, which
   * is what makes a resize feel like a resize rather than a stop.
   *
   * The `scaleX` / `scaleY` in the result are signed: `-1` means that axis was
   * flipped, which is what a shape needs in order to mirror its own contents.
   */
  static Resize(
    box: BoxLike,
    handle: BoxHandle | string,
    dx: number,
    dy: number,
    isAspectRatioLocked = false,
  ): { box: Box; scaleX: number; scaleY: number } {
    let minX = box.x
    let minY = box.y
    let maxX = box.x + box.w
    let maxY = box.y + box.h
    if (handle === "left" || handle === "top_left" || handle === "bottom_left") minX += dx
    if (handle === "right" || handle === "top_right" || handle === "bottom_right") maxX += dx
    if (handle === "top" || handle === "top_left" || handle === "top_right") minY += dy
    if (handle === "bottom" || handle === "bottom_left" || handle === "bottom_right") maxY += dy

    if (isAspectRatioLocked && box.w !== 0 && box.h !== 0) {
      // Keep the dragged handle's corner where the pointer put it on the axis it
      // moved furthest along, and derive the other axis from the aspect ratio.
      const ratio = box.w / box.h
      const w = maxX - minX
      const h = maxY - minY
      if (Math.abs(w / (h || 1)) > Math.abs(ratio)) {
        const nextH = w / ratio
        if (handle.startsWith("top")) minY = maxY - nextH
        else maxY = minY + nextH
      } else {
        const nextW = h * ratio
        if (handle.endsWith("left")) minX = maxX - nextW
        else maxX = minX + nextW
      }
    }

    const scaleX = box.w === 0 ? 1 : (maxX - minX) / box.w
    const scaleY = box.h === 0 ? 1 : (maxY - minY) / box.h
    return { box: Box.ZeroFix(Box.FromMinMax(minX, minY, maxX, maxY)), scaleX, scaleY }
  }

  // ---- derived ---------------------------------------------------------------

  get minX(): number {
    return this.x
  }
  set minX(n: number) {
    this.x = n
  }
  get minY(): number {
    return this.y
  }
  set minY(n: number) {
    this.y = n
  }
  get maxX(): number {
    return this.x + this.w
  }
  get maxY(): number {
    return this.y + this.h
  }
  get midX(): number {
    return this.x + this.w / 2
  }
  get midY(): number {
    return this.y + this.h / 2
  }
  get left(): number {
    return this.x
  }
  get right(): number {
    return this.x + this.w
  }
  get top(): number {
    return this.y
  }
  get bottom(): number {
    return this.y + this.h
  }
  get width(): number {
    return this.w
  }
  set width(n: number) {
    this.w = n
  }
  get height(): number {
    return this.h
  }
  set height(n: number) {
    this.h = n
  }
  /** The top-left corner. Setting it moves the box without resizing it. */
  get point(): Vec {
    return new Vec(this.x, this.y)
  }
  set point(v: VecLike) {
    this.x = v.x
    this.y = v.y
  }
  /** The box's size as a vector. */
  get size(): Vec {
    return new Vec(this.w, this.h)
  }
  set size(v: VecLike) {
    this.w = v.x
    this.h = v.y
  }
  /** The centre. Setting it moves the box without resizing it. */
  get center(): Vec {
    return new Vec(this.midX, this.midY)
  }
  set center(v: VecLike) {
    this.x = v.x - this.w / 2
    this.y = v.y - this.h / 2
  }
  /** Width over height. `Infinity` for a zero-height box. */
  get aspectRatio(): number {
    return this.w / this.h
  }
  /** The four corners, clockwise from the top left. */
  get corners(): Vec[] {
    return [
      new Vec(this.x, this.y),
      new Vec(this.maxX, this.y),
      new Vec(this.maxX, this.maxY),
      new Vec(this.x, this.maxY),
    ]
  }
  /** The four corners followed by the centre — the five snap points of a box. */
  get cornersAndCenter(): Vec[] {
    return [...this.corners, this.center]
  }
  /** The four sides as point pairs, clockwise from the top edge. */
  get sides(): [Vec, Vec][] {
    return Box.Sides(this)
  }

  // ---- questions -------------------------------------------------------------

  /** Whether `B` lies entirely inside this box (touching edges count as inside). */
  contains(B: BoxLike): boolean {
    return Box.Contains(this, B)
  }
  /** Whether `V` lies inside this box, optionally grown by `margin` on every side. */
  containsPoint(V: VecLike, margin = 0): boolean {
    return Box.ContainsPoint(this, V, margin)
  }
  /** Whether this box and `B` overlap at all. */
  collides(B: BoxLike): boolean {
    return Box.Collides(this, B)
  }
  /** Whether `B` has any part inside this box — contained or merely overlapping. */
  includes(B: BoxLike): boolean {
    return Box.Includes(this, B)
  }
  equals(other: BoxLike): boolean {
    return Box.Equals(this, other)
  }
  /** Whether this box has a real, finite, non-negative size. */
  isValid(): boolean {
    return this.w >= 0 && this.h >= 0 && Number.isFinite(this.w) && Number.isFinite(this.h)
  }
  /** The point at `handle` on this box's edge. */
  getHandlePoint(handle: BoxHandle | RotateCorner): Vec {
    switch (handle in ROTATE_CORNER_TO_SELECTION_CORNER ? ROTATE_CORNER_TO_SELECTION_CORNER[handle as RotateCorner] : handle) {
      case "top_left":
        return new Vec(this.minX, this.minY)
      case "top_right":
        return new Vec(this.maxX, this.minY)
      case "bottom_right":
        return new Vec(this.maxX, this.maxY)
      case "bottom_left":
        return new Vec(this.minX, this.maxY)
      case "top":
        return new Vec(this.midX, this.minY)
      case "right":
        return new Vec(this.maxX, this.midY)
      case "bottom":
        return new Vec(this.midX, this.maxY)
      case "left":
        return new Vec(this.minX, this.midY)
      default:
        return this.center
    }
  }

  // ---- changes (mutate, return `this`) --------------------------------------

  /** Grow this box to contain `A` as well. */
  expand(A: BoxLike): this {
    return this.setTo(Box.Expand(this, A))
  }
  /** Grow this box by `n` on every side. A negative `n` shrinks it. */
  expandBy(n: number): this {
    this.x -= n
    this.y -= n
    this.w += 2 * n
    this.h += 2 * n
    return this
  }
  /** Grow this box to contain `box` as well. An alias of {@link Box.expand}. */
  union(box: BoxModel): this {
    return this.expand(box)
  }
  /** Move this box by `delta`. */
  translate(delta: VecLike): this {
    this.x += delta.x
    this.y += delta.y
    return this
  }
  /** Scale this box about the page origin. */
  scale(n: number): this {
    this.x *= n
    this.y *= n
    this.w *= n
    this.h *= n
    return this
  }
  /** Apply a resize in place. See {@link Box.Resize}. */
  resize(handle: BoxHandle | string, dx: number, dy: number): void {
    this.setTo(Box.Resize(this, handle, dx, dy).box)
  }
  set(x = this.x, y = this.y, w = this.w, h = this.h): this {
    this.x = x
    this.y = y
    this.w = w
    this.h = h
    return this
  }
  setTo(B: BoxLike): this {
    this.x = B.x
    this.y = B.y
    this.w = B.w
    this.h = B.h
    return this
  }
  /** Snap every edge to the grid, so the box stays whole cells wide. */
  snapToGrid(size: number): void {
    if (size <= 0) return
    const minX = Math.round(this.x / size) * size
    const minY = Math.round(this.y / size) * size
    const maxX = Math.round((this.x + this.w) / size) * size
    const maxY = Math.round((this.y + this.h) / size) * size
    this.x = minX
    this.y = minY
    this.w = Math.max(maxX - minX, size)
    this.h = Math.max(maxY - minY, size)
  }
  /** Round every component to `precision` decimal places. */
  toFixed(precision = 2): this {
    this.x = Number(this.x.toFixed(precision))
    this.y = Number(this.y.toFixed(precision))
    this.w = Number(this.w.toFixed(precision))
    this.h = Number(this.h.toFixed(precision))
    return this
  }
  /** Fold a negative width or height back into the position. See {@link Box.ZeroFix}. */
  zeroFix(): this {
    return this.setTo(Box.ZeroFix(this))
  }

  clone(): Box {
    return new Box(this.x, this.y, this.w, this.h)
  }
  toJson(): BoxModel {
    return { x: this.x, y: this.y, w: this.w, h: this.h }
  }
}
