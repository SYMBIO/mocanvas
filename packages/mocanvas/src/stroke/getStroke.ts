/**
 * Turning a stream of pointer samples into a stroke you can fill.
 *
 * A freehand line is drawn as a *polygon*, not as a stroked polyline: that is
 * the only way the line can get thicker where the pen pressed harder and taper
 * at its ends. The pipeline is three steps, each exported on its own because
 * different callers stop at different points:
 *
 * 1. {@link getStrokePoints} — resample and smooth the raw input, and work out
 *    how wide the line should be at each sample.
 * 2. {@link getStrokeOutlinePoints} — walk those samples' left and right sides
 *    to produce the polygon.
 * 3. {@link getStroke} — both of the above, for a caller that just wants the
 *    outline.
 *
 * A lasso or a laser pointer stops after step 1 and calls
 * {@link getSvgPathFromStrokePoints} instead, because it wants a centreline it
 * can stroke with a round cap rather than a filled shape.
 */

import { Vec, type VecLike } from "@mocanvas/editor"

/** How a stroke's start or end is shaped. */
export interface StrokeTerminalOptions {
  /** Round the terminal off, instead of cutting it square. */
  cap?: boolean
  /** Reshapes the taper over its length; `distance` runs `0`→`1`. */
  easing?(distance: number): number
  /** `true` for a taper as long as the stroke's own width, or an explicit length. */
  taper?: boolean | number
}

/** Everything the stroke pipeline can be tuned by. */
export interface StrokeOptions {
  /** Shaping for the end of the stroke. */
  end?: StrokeTerminalOptions
  /** Whether these are the final points of the stroke, rather than a live prefix. */
  last?: boolean
  /** Derive pressure from speed when the input device reports none. */
  simulatePressure?: boolean
  /** The base width of the stroke, in the points' own units. */
  size?: number
  /** How strongly the width is averaged along the stroke, `0`–`1`. */
  smoothing?: number
  /** Shaping for the start of the stroke. */
  start?: StrokeTerminalOptions
  /** How strongly the input points are pulled towards the previous one, `0`–`1`. */
  streamline?: number
  /** How much pressure changes the width, `0`–`1`. Negative inverts it. */
  thinning?: number
  /** Reshapes how pressure maps to width. */
  easing?: (pressure: number) => number
}

/** One resampled point of a stroke: where it is, how wide, and how far along. */
export interface StrokePoint {
  /** Distance from the previous stroke point. */
  distance: number
  /** The raw input sample this came from. */
  input: Vec
  /** The smoothed position. */
  point: Vec
  /** Pressure at this point, `0`–`1`. */
  pressure: number
  /** Half-width of the stroke here. */
  radius: number
  /** Distance from the start of the stroke, along it. */
  runningLength: number
}

const DEFAULT_SIZE = 16
const DEFAULT_THINNING = 0.5
const DEFAULT_SMOOTHING = 0.5
const DEFAULT_STREAMLINE = 0.5
const DEFAULT_PRESSURE = 0.5
const RATE_OF_PRESSURE_CHANGE = 0.275

const identity = (t: number): number => t
const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2)

/** Pressure of a sample, from a `z`/pressure component when the input carries one. */
function pressureOf(point: VecLike): number | undefined {
  const z = (point as { z?: number | undefined }).z
  return typeof z === "number" ? z : undefined
}

/**
 * Resample and smooth raw input into the points the outline is built from.
 *
 * Two things happen here. Streamlining pulls each sample towards the previous
 * one, which removes the jitter a trackpad or a shaky hand puts into the
 * stream. Then each point is given a radius from its pressure — real pressure
 * from a pen, or pressure simulated from how fast the pointer was moving, on
 * the observation that a fast stroke is a light one.
 */
export function getStrokePoints(rawInputPoints: VecLike[], options: StrokeOptions = {}): StrokePoint[] {
  const { streamline = DEFAULT_STREAMLINE, size = DEFAULT_SIZE, simulatePressure = true, last = false } = options
  if (rawInputPoints.length === 0) return []

  const t = 0.15 + (1 - streamline) * 0.85
  const points: StrokePoint[] = []

  const first = rawInputPoints[0]!
  let previous = new Vec(first.x, first.y)
  const firstPressure = pressureOf(first) ?? DEFAULT_PRESSURE
  points.push({
    input: new Vec(first.x, first.y),
    point: previous,
    pressure: simulatePressure ? DEFAULT_PRESSURE : firstPressure,
    distance: 0,
    runningLength: 0,
    radius: size / 2,
  })

  let runningLength = 0
  for (let i = 1; i < rawInputPoints.length; i++) {
    const raw = rawInputPoints[i]!
    const input = new Vec(raw.x, raw.y)
    // The last point is used as it arrived: rounding the very end of a live
    // stroke towards its predecessor makes the line visibly lag the cursor.
    const point = last && i === rawInputPoints.length - 1 ? input : Vec.Lrp(previous, input, t)
    const distance = Vec.Dist(point, previous)
    // Points that land on top of each other carry no direction, and a zero
    // vector would put a spike in the outline.
    if (distance < 0.001 && i < rawInputPoints.length - 1) continue
    runningLength += distance
    points.push({
      input,
      point,
      pressure: pressureOf(raw) ?? DEFAULT_PRESSURE,
      distance,
      runningLength,
      radius: size / 2,
    })
    previous = point
  }

  return applyRadii(points, options)
}

/** Give every stroke point the radius its pressure implies. */
function applyRadii(points: StrokePoint[], options: StrokeOptions): StrokePoint[] {
  const {
    size = DEFAULT_SIZE,
    thinning = DEFAULT_THINNING,
    smoothing = DEFAULT_SMOOTHING,
    simulatePressure = true,
    easing = identity,
  } = options
  if (thinning === 0) {
    for (const p of points) p.radius = size / 2
    return points
  }

  let previousPressure = points[0]?.pressure ?? DEFAULT_PRESSURE
  for (const point of points) {
    let pressure = point.pressure
    if (simulatePressure) {
      // Faster travel between samples reads as a lighter touch. The step is
      // capped so one long jump — a dropped frame — cannot spike the width.
      const speed = Math.min(1, point.distance / size)
      const target = 1 - speed
      pressure = Math.min(1, previousPressure + (target - previousPressure) * (RATE_OF_PRESSURE_CHANGE * smoothing))
    }
    previousPressure = pressure
    point.pressure = pressure
    point.radius = (size * (0.5 + easing(pressure) * thinning - thinning / 2)) / 2
  }
  return points
}

/** The taper length for one terminal, resolved against the stroke's total length. */
function taperLength(terminal: StrokeTerminalOptions | undefined, size: number, totalLength: number): number {
  const taper = terminal?.taper
  if (taper === undefined || taper === false) return 0
  if (taper === true) return Math.max(size, totalLength * 0.1)
  return taper
}

/**
 * Walk the stroke points and produce the polygon that surrounds them.
 *
 * At each point the outline steps out perpendicular to the direction of travel
 * by that point's radius, once to the left and once to the right; the right
 * side is walked back in reverse so the result is a single closed ring. Tapers
 * shrink the radius near the ends, and a `cap` fans extra points around the
 * terminal so it reads as round rather than cut off.
 */
export function getStrokeOutlinePoints(strokePoints: StrokePoint[], options: StrokeOptions = {}): Vec[] {
  const { size = DEFAULT_SIZE, start, end } = options
  if (strokePoints.length === 0) return []

  const total = strokePoints[strokePoints.length - 1]!.runningLength
  const startTaper = taperLength(start, size, total)
  const endTaper = taperLength(end, size, total)
  const startEasing = start?.easing ?? easeOutSine
  const endEasing = end?.easing ?? easeOutSine

  if (strokePoints.length === 1) {
    // A dot: a ring around the single point, so a tap still draws something.
    const only = strokePoints[0]!
    const ring: Vec[] = []
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      ring.push(new Vec(only.point.x + Math.cos(angle) * only.radius, only.point.y + Math.sin(angle) * only.radius))
    }
    return ring
  }

  const left: Vec[] = []
  const right: Vec[] = []
  for (let i = 0; i < strokePoints.length; i++) {
    const point = strokePoints[i]!
    const next = strokePoints[i + 1] ?? point
    const previous = strokePoints[i - 1] ?? point
    const direction = Vec.Uni(Vec.Sub(next === point ? point.point : next.point, previous === point ? point.point : previous.point))
    if (direction.len() === 0) continue
    const normal = new Vec(-direction.y, direction.x)

    let radius = point.radius
    if (startTaper > 0 && point.runningLength < startTaper) radius *= startEasing(point.runningLength / startTaper)
    if (endTaper > 0 && total - point.runningLength < endTaper) radius *= endEasing((total - point.runningLength) / endTaper)

    left.push(new Vec(point.point.x + normal.x * radius, point.point.y + normal.y * radius))
    right.push(new Vec(point.point.x - normal.x * radius, point.point.y - normal.y * radius))
  }

  const outline = [...left]
  if (end?.cap !== false) outline.push(...capAround(strokePoints[strokePoints.length - 1]!, left[left.length - 1], right[right.length - 1]))
  outline.push(...right.reverse())
  if (start?.cap !== false) outline.push(...capAround(strokePoints[0]!, right[right.length - 1], left[0]))
  return outline
}

/** A short arc of points from `from` to `to` around `point`, for a round terminal. */
function capAround(point: StrokePoint, from: Vec | undefined, to: Vec | undefined): Vec[] {
  if (!from || !to || point.radius <= 0) return []
  const startAngle = Math.atan2(from.y - point.point.y, from.x - point.point.x)
  const endAngle = Math.atan2(to.y - point.point.y, to.x - point.point.x)
  let sweep = endAngle - startAngle
  while (sweep <= 0) sweep += Math.PI * 2
  const steps = 6
  const out: Vec[] = []
  for (let i = 1; i < steps; i++) {
    const angle = startAngle + (sweep * i) / steps
    out.push(new Vec(point.point.x + Math.cos(angle) * point.radius, point.point.y + Math.sin(angle) * point.radius))
  }
  return out
}

/** The polygon surrounding `points` — {@link getStrokePoints} then {@link getStrokeOutlinePoints}. */
export function getStroke(points: VecLike[], options: StrokeOptions = {}): Vec[] {
  return getStrokeOutlinePoints(getStrokePoints(points, options), options)
}

/**
 * The centreline of a stroke as an SVG `d`, drawn with quadratic curves through
 * the midpoints between samples.
 *
 * Curving through midpoints rather than through the samples themselves is what
 * makes a hand-drawn line look smooth: every sample becomes a control point, so
 * the curve never has to turn a corner at one.
 */
export function getSvgPathFromStrokePoints(points: StrokePoint[], closed = false): string {
  if (points.length === 0) return ""
  const first = points[0]!.point
  if (points.length === 1) return `M${round(first.x)},${round(first.y)}`

  const parts = [`M${round(first.x)},${round(first.y)}`]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]!.point
    const b = points[i + 1]!.point
    parts.push(`Q${round(a.x)},${round(a.y)} ${round((a.x + b.x) / 2)},${round((a.y + b.y) / 2)}`)
  }
  const last = points[points.length - 1]!.point
  parts.push(`L${round(last.x)},${round(last.y)}`)
  if (closed) parts.push("Z")
  return parts.join(" ")
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
