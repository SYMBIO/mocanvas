/**
 * The scalar, angular and arc maths the geometry classes are built on.
 *
 * Everything here is pure and allocation-light: these are the functions called
 * once per vertex per frame, so they take and return numbers wherever a number
 * will do.
 */
import { Vec, type VecLike } from "./Vec"

/** π. Re-exported so a caller can write geometry without reaching for `Math`. */
export const PI = Math.PI
/** A full turn in radians. */
export const PI2 = Math.PI * 2
/** A quarter turn in radians. */
export const HALF_PI = Math.PI / 2
/** `Math.sin`, under the name the geometry code refers to it by. */
export const SIN = Math.sin

/**
 * The easing curves available to camera moves, animated nudges and anything
 * else that tweens. Every one maps `[0, 1]` onto `[0, 1]`.
 */
export const EASINGS = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),
  easeInQuint: (t: number) => t * t * t * t * t,
  easeOutQuint: (t: number) => 1 + --t * t * t * t * t,
  easeInOutQuint: (t: number) => (t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t),
  easeInSine: (t: number) => 1 - Math.cos((t * PI) / 2),
  easeOutSine: (t: number) => Math.sin((t * PI) / 2),
  easeInOutSine: (t: number) => -(Math.cos(PI * t) - 1) / 2,
  easeInExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
} as const satisfies Record<string, (t: number) => number>

/** The name of one of the {@link EASINGS}. */
export type TLEasingType = keyof typeof EASINGS

// ---- scalars ----------------------------------------------------------------

/**
 * Clamp a value into a range. With no `max`, `min` is a floor only.
 *
 * @example
 * ```ts
 * clamp(0, 1, 10) // 1
 * clamp(11, 1, 10) // 10
 * ```
 */
export function clamp(n: number, min: number, max?: number): number {
  return max === undefined ? Math.max(min, n) : Math.min(Math.max(n, min), max)
}

/**
 * Whether two numbers are equal to within `precision`. Use this rather than
 * `===` on anything that has been through a transform.
 */
export function approximately(a: number, b: number, precision = 0.000001): boolean {
  return Math.abs(a - b) <= precision
}

/**
 * Round to a sensible number of decimal places for the DOM. Sub-pixel detail
 * beyond four places changes nothing on screen and only bloats the markup.
 *
 * SEMANTICS-ASSUMED: four places. The docs name the function but not the
 * precision; four is the finest that still collapses float dust.
 */
export function toDomPrecision(v: number): number {
  return +v.toFixed(4)
}

/** Round to a fixed number of decimal places, returning a number. */
export function toPrecision(v: number, precision = 4): number {
  return +v.toFixed(precision)
}

/** A point written for an SVG path `d`, rounded to DOM precision. */
export function precise(A: VecLike): string {
  return `${toDomPrecision(A.x)},${toDomPrecision(A.y)} `
}

/**
 * The midpoint of two points written for an SVG path `d`. Quadratic smoothing
 * of a polyline is a run of `Q <point> <average of this point and the next>`,
 * which is what this is for.
 */
export function average(A: VecLike, B: VecLike): string {
  return `${toDomPrecision((A.x + B.x) / 2)},${toDomPrecision((A.y + B.y) / 2)} `
}

/**
 * The overlap of the ranges `[a0, a1]` and `[b0, b1]`, or null when they do not
 * meet. The endpoints of each range may be given in either order.
 */
export function rangeIntersection(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const min = Math.max(Math.min(a0, a1), Math.min(b0, b1))
  const max = Math.min(Math.max(a0, a1), Math.max(b0, b1))
  return min <= max ? [min, max] : null
}

// ---- angles -----------------------------------------------------------------

export function degreesToRadians(d: number): number {
  return (d * PI) / 180
}

export function radiansToDegrees(r: number): number {
  return (r * 180) / PI
}

/** An angle brought into `[0, 2π)`, whatever it started as. */
export function canonicalizeRotation(a: number): number {
  const r = a % PI2
  return r < 0 ? r + PI2 : r
}

/** An angle brought into `[0, 2π)`. An alias of {@link canonicalizeRotation}. */
export function clampRadians(r: number): number {
  return (PI2 + r) % PI2
}

/**
 * The shortest signed turn from `a0` to `a1`, in `(-π, π]`. Use this rather
 * than `a1 - a0` whenever an angle may have wrapped.
 */
export function shortAngleDist(a0: number, a1: number): number {
  const da = (a1 - a0) % PI2
  return ((2 * da) % PI2) - da
}

/** The turn from `a0` to `a1` going clockwise (increasing angle), in `[0, 2π)`. */
export function clockwiseAngleDist(a0: number, a1: number): number {
  a0 = canonicalizeRotation(a0)
  a1 = canonicalizeRotation(a1)
  if (a0 > a1) a1 += PI2
  return a1 - a0
}

/** The turn from `a0` to `a1` going anti-clockwise, in `[0, 2π)`. */
export function counterClockwiseAngleDist(a0: number, a1: number): number {
  return PI2 - clockwiseAngleDist(a0, a1)
}

/**
 * The turn from `fromAngle` to `toAngle` in the given direction: `1` for
 * anti-clockwise, `-1` for clockwise.
 */
export function angleDistance(fromAngle: number, toAngle: number, direction: number): number {
  return direction < 0 ? clockwiseAngleDist(fromAngle, toAngle) : counterClockwiseAngleDist(fromAngle, toAngle)
}

/**
 * Whether two angles describe the same axis, i.e. differ by a whole number of
 * quarter turns. This is what decides whether two rotated shapes can share a
 * bounding box without one of them being resized off its own axes.
 */
export function areAnglesCompatible(a: number, b: number): boolean {
  return a === b || approximately(shortAngleDist(a, b) % HALF_PI, 0)
}

/**
 * Round `r` to the nearest of `segments` evenly spaced angles — what shift-drag
 * does to a rotation.
 */
export function snapAngle(r: number, segments: number): number {
  const seg = PI2 / segments
  return canonicalizeRotation(Math.round(r / seg) * seg)
}

// ---- circles and arcs -------------------------------------------------------

/** The point at angle `a` on the circle of radius `r` about `center`. */
export function getPointOnCircle(center: VecLike, r: number, a: number): Vec {
  return new Vec(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r)
}

/**
 * The signed sweep of the arc that runs from angle `A` to angle `B` with the
 * given SVG arc flags. Negative means anti-clockwise.
 */
export function getArcMeasure(A: number, B: number, sweepFlag: number, largeArcFlag: number): number {
  const m = shortAngleDist(A, B)
  if (!largeArcFlag) return m
  return (PI2 - Math.abs(m)) * (sweepFlag ? 1 : -1)
}

/**
 * Where the angle `P` falls along the arc from `A` to `B`, as a `t` in `[0, 1]`
 * for a point on the arc and outside it for a point that is not.
 *
 * SEMANTICS-ASSUMED: the docs pin `0` at the start and `1` at the end but say
 * nothing about points off the arc. Letting `t` run on past 1 (rather than
 * clamping) keeps it monotonic all the way round, which is what a caller
 * projecting a pointer onto an arc needs in order to tell which end it is past.
 */
export function getPointInArcT(mAB: number, A: number, B: number, P: number): number {
  if (mAB === 0) return 0
  const direction = mAB < 0 ? -1 : 1
  // Distance travelled from A towards P, always measured in the arc's own
  // direction so that t grows monotonically along it.
  const travelled = canonicalizeRotation((P - A) * direction)
  return travelled / Math.abs(mAB)
}

/**
 * `numPoints` points along the arc from `startPoint` to `endPoint`, inclusive.
 * A null `center` means there is no arc — the points are spread along the
 * straight line between the two instead.
 */
export function getPointsOnArc(
  startPoint: VecLike,
  endPoint: VecLike,
  center: null | VecLike,
  radius: number,
  numPoints: number,
): Vec[] {
  if (numPoints <= 0) return []
  if (center === null) return Vec.PointsBetween(startPoint, endPoint, numPoints)
  const results: Vec[] = []
  const startAngle = Vec.Angle(center, startPoint)
  const endAngle = Vec.Angle(center, endPoint)
  const l = clockwiseAngleDist(startAngle, endAngle)
  for (let i = 0; i < numPoints; i++) {
    const t = numPoints === 1 ? 0 : i / (numPoints - 1)
    results.push(getPointOnCircle(center, radius, startAngle + l * t))
  }
  return results
}

/**
 * The centre of the circle through three points, or null when they are
 * collinear and no such circle exists.
 */
export function centerOfCircleFromThreePoints(a: VecLike, b: VecLike, c: VecLike): null | Vec {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (d === 0 || !Number.isFinite(d)) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return new Vec(x, y)
}

/**
 * The perimeter of an ellipse, to Ramanujan's second approximation — accurate
 * to better than a part in ten thousand for any eccentricity a shape can have.
 */
export function perimeterOfEllipse(rx: number, ry: number): number {
  if (rx === ry) return PI2 * rx
  const h = Math.pow(rx - ry, 2) / Math.pow(rx + ry, 2)
  return PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/**
 * The vertices of a regular `sides`-gon scaled to exactly fill a `width × height`
 * box, starting at the apex (the `-π/2` angle) and running clockwise.
 *
 * This is the generator behind the triangle, diamond, pentagon, hexagon and
 * octagon outlines, exported so that anything drawing a preview of one of those
 * — a placement ghost, a custom geo type — calls it instead of restating the
 * trigonometry. The result always fills the box exactly, so its bounds are the
 * box.
 */
export function getPolygonVertices(width: number, height: number, sides: number): Vec[] {
  if (!Number.isFinite(sides) || sides < 3) return []
  const count = Math.floor(sides)
  // Lay the polygon out on the unit circle first, then map its own bounding box
  // onto the requested box — a raw `w/2 + w/2·cos θ` placement would leave the
  // flat sides short of the box on one axis.
  const unit: Vec[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    unit.push(new Vec(x, y))
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  return unit.map(
    (p) =>
      new Vec(
        spanX === 0 ? width / 2 : ((p.x - minX) / spanX) * width,
        spanY === 0 ? height / 2 : ((p.y - minY) / spanY) * height,
      ),
  )
}
