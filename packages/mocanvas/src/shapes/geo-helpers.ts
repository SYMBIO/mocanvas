/**
 * Outline math for the `geo` shape. Every polygon is inscribed in the w×h box
 * so that its bounds are exactly the shape's bounds.
 */
import {
  CubicSpline2d,
  Ellipse2d,
  Group2d,
  Polygon2d,
  Polyline2d,
  Vec,
  type GeoShapeKind,
  type Geometry2d,
  type VecLike,
} from "@mocanvas/editor"
import { arcToCubicSegments, lineSegment, type CubicSegment } from "./spline-helpers"

const TAU = Math.PI * 2

/**
 * Inner radius of the five-pointed star, as a fraction of the outer radius.
 * Measured off a reference render (interior-IoU and outline least-squares fits
 * of the same star both put it at 0.51 ± 0.02, calibrated against a render of
 * known ratio); a plain half reads the same to well under a pixel at any
 * sensible size. A smaller ratio makes the arms too thin.
 */
export const STAR_INNER_RATIO = 0.5

/**
 * Angle of the hexagon's first vertex. A vertex sits at the top and one at the
 * bottom, which leaves the left and right sides vertical and running the full
 * width of the box — that is the orientation the reference draws, and it is
 * what `HEXAGON_FLAT_SIDE_SPAN` describes.
 */
const HEXAGON_START_ANGLE = -Math.PI / 2

/**
 * Fraction of the box height spanned by the hexagon's two vertical sides. They
 * are centred, so they run from `(1 - span) / 2` to `(1 + span) / 2` of the
 * height, and the distance across them is the full box width.
 */
export const HEXAGON_FLAT_SIDE_SPAN = 0.5

/** Affinely stretch points so their bounding box becomes exactly [0,w]×[0,h]. */
export function fitPointsToBox(points: readonly VecLike[], w: number, h: number): VecLike[] {
  if (points.length === 0) return []
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
  const sx = maxX - minX > 0 ? w / (maxX - minX) : 0
  const sy = maxY - minY > 0 ? h / (maxY - minY) : 0
  return points.map((p) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }))
}

/**
 * Regular polygon (or star when `innerRatio` is given) with `sides` outer
 * vertices, first vertex at `startAngle`, stretched to fill the box.
 */
function regularPolygon(sides: number, startAngle: number, w: number, h: number, innerRatio?: number): VecLike[] {
  const count = innerRatio === undefined ? sides : sides * 2
  const raw: VecLike[] = []
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i / count) * TAU
    const r = innerRatio !== undefined && i % 2 === 1 ? innerRatio : 1
    raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return fitPointsToBox(raw, w, h)
}

/** Block arrow pointing +x inside a w×h box (7 vertices). */
function blockArrowRight(w: number, h: number): VecLike[] {
  const headLen = Math.min(w / 2, h / 2)
  const shaftTop = h / 4
  const shaftBottom = (3 * h) / 4
  return [
    { x: 0, y: shaftTop },
    { x: w - headLen, y: shaftTop },
    { x: w - headLen, y: 0 },
    { x: w, y: h / 2 },
    { x: w - headLen, y: h },
    { x: w - headLen, y: shaftBottom },
    { x: 0, y: shaftBottom },
  ]
}

/**
 * Polygon vertices for the polygonal geo kinds, or `null` for the curved kinds
 * (ellipse, oval, cloud, heart). `x-box` and `check-box` return their frame;
 * see `getGeoDecorations` for the marks inside.
 */
export function getGeoPolygonPoints(kind: GeoShapeKind, w: number, h: number): VecLike[] | null {
  switch (kind) {
    case "rectangle":
    case "x-box":
    case "check-box":
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]
    case "triangle":
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]
    case "diamond":
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]
    case "pentagon":
      return regularPolygon(5, -Math.PI / 2, w, h)
    case "hexagon":
      return regularPolygon(6, HEXAGON_START_ANGLE, w, h)
    case "octagon":
      return regularPolygon(8, Math.PI / 8, w, h)
    case "star":
      return regularPolygon(5, -Math.PI / 2, w, h, STAR_INNER_RATIO)
    case "rhombus": {
      const off = Math.min(w / 3, h)
      return [
        { x: off, y: 0 },
        { x: w, y: 0 },
        { x: w - off, y: h },
        { x: 0, y: h },
      ]
    }
    case "rhombus-2": {
      const off = Math.min(w / 3, h)
      return [
        { x: 0, y: 0 },
        { x: w - off, y: 0 },
        { x: w, y: h },
        { x: off, y: h },
      ]
    }
    case "trapezoid": {
      const off = Math.min(w / 4, h / 2)
      return [
        { x: off, y: 0 },
        { x: w - off, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]
    }
    case "arrow-right":
      return blockArrowRight(w, h)
    case "arrow-left":
      return blockArrowRight(w, h).map((p) => ({ x: w - p.x, y: p.y }))
    case "arrow-down":
      return blockArrowRight(h, w).map((p) => ({ x: p.y, y: p.x }))
    case "arrow-up":
      return blockArrowRight(h, w).map((p) => ({ x: p.y, y: h - p.x }))
    case "ellipse":
    case "oval":
    case "cloud":
    case "heart":
      return null
  }
}

/**
 * Open polylines drawn inside the outline (the X of an x-box, the tick of a
 * check-box).
 *
 * `strokeWidth` shortens the marks that end *on* the outline. A stroke is
 * centred on its path and its round cap reaches half a width beyond the last
 * point, so diagonals running corner to corner of the box came out as four
 * spikes sticking through the very outline they belong inside. Pulling each end
 * back by half a width lands the cap on the corner instead of past it. The
 * check-box's tick sits well clear of the edge and is left alone.
 */
export function getGeoDecorations(kind: GeoShapeKind, w: number, h: number, strokeWidth = 0): VecLike[][] {
  switch (kind) {
    case "x-box": {
      // Along the diagonal, not along an axis: the cap sticks out the way the
      // line is pointing.
      const d = Math.hypot(w, h)
      const t = d > 0 ? Math.min(strokeWidth / 2 / d, 0.4) : 0
      const [dx, dy] = [w * t, h * t]
      return [
        [
          { x: dx, y: dy },
          { x: w - dx, y: h - dy },
        ],
        [
          { x: w - dx, y: dy },
          { x: dx, y: h - dy },
        ],
      ]
    }
    case "check-box":
      return [
        [
          { x: w * 0.25, y: h * 0.52 },
          { x: w * 0.43, y: h * 0.72 },
          { x: w * 0.76, y: h * 0.3 },
        ],
      ]
    default:
      return []
  }
}

/** Stadium / capsule: two semicircles joined by straight sides. */
export function getStadiumSegments(w: number, h: number): CubicSegment[] {
  if (w >= h) {
    const r = h / 2
    return [
      lineSegment({ x: r, y: 0 }, { x: w - r, y: 0 }),
      ...arcToCubicSegments({ x: w - r, y: r }, r, -Math.PI / 2, Math.PI, 2),
      lineSegment({ x: w - r, y: h }, { x: r, y: h }),
      ...arcToCubicSegments({ x: r, y: r }, r, Math.PI / 2, Math.PI, 2),
    ]
  }
  const r = w / 2
  return [
    ...arcToCubicSegments({ x: r, y: r }, r, Math.PI, Math.PI, 2),
    lineSegment({ x: w, y: r }, { x: w, y: h - r }),
    ...arcToCubicSegments({ x: r, y: h - r }, r, 0, Math.PI, 2),
    lineSegment({ x: 0, y: h - r }, { x: 0, y: r }),
  ]
}

/** Stretch closed spline control points so the sampled outline fills [0,w]×[0,h]. */
function fitSegmentsToBox(segments: CubicSegment[], w: number, h: number): CubicSegment[] {
  const b = new CubicSpline2d({ segments, isClosed: true }).bounds
  const sx = b.w > 0 ? w / b.w : 0
  const sy = b.h > 0 ? h / b.h : 0
  const map = (p: VecLike): VecLike => ({ x: (p.x - b.x) * sx, y: (p.y - b.y) * sy })
  return segments.map((s) => ({ p0: map(s.p0), c1: map(s.c1), c2: map(s.c2), p1: map(s.p1) }))
}

/** A ring of round bumps around an inner ellipse, fitted to the box. */
export function getCloudSegments(w: number, h: number): CubicSegment[] {
  const bumps = Math.max(5, Math.min(12, Math.round((w + h) / 40)))
  const center = { x: w / 2, y: h / 2 }
  const rx = (w / 2) * 0.75
  const ry = (h / 2) * 0.7
  const anchors: VecLike[] = []
  for (let i = 0; i < bumps; i++) {
    const a = -Math.PI / 2 + (i / bumps) * TAU
    anchors.push({ x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) })
  }
  const segments: CubicSegment[] = []
  for (let i = 0; i < bumps; i++) {
    const a = anchors[i]!
    const b = anchors[(i + 1) % bumps]!
    const chord = Vec.Sub(b, a)
    const len = Vec.Len(chord)
    const mid = Vec.Lrp(a, b, 0.5)
    let outward = Vec.Per(Vec.Uni(chord))
    if (Vec.Dot(outward, Vec.Sub(mid, center)) < 0) outward = Vec.Mul(outward, -1)
    const k = len * 0.55
    segments.push({
      p0: a,
      c1: Vec.Add(a, Vec.Mul(outward, k)),
      c2: Vec.Add(b, Vec.Mul(outward, k)),
      p1: b,
    })
  }
  return fitSegmentsToBox(segments, w, h)
}

/** Classic two-lobed heart, six cubics, bounds exactly w×h. */
export function getHeartSegments(w: number, h: number): CubicSegment[] {
  const P = (x: number, y: number): VecLike => ({ x: x * w, y: y * h })
  return [
    { p0: P(0.5, 0.25), c1: P(0.5, 0.1), c2: P(0.35, 0), p1: P(0.25, 0) },
    { p0: P(0.25, 0), c1: P(0.1, 0), c2: P(0, 0.15), p1: P(0, 0.3) },
    { p0: P(0, 0.3), c1: P(0, 0.55), c2: P(0.25, 0.75), p1: P(0.5, 1) },
    { p0: P(0.5, 1), c1: P(0.75, 0.75), c2: P(1, 0.55), p1: P(1, 0.3) },
    { p0: P(1, 0.3), c1: P(1, 0.15), c2: P(0.9, 0), p1: P(0.75, 0) },
    { p0: P(0.75, 0), c1: P(0.65, 0), c2: P(0.5, 0.1), p1: P(0.5, 0.25) },
  ]
}

/**
 * Which axes a silhouette is mirrored about, inside its own `w × h` box.
 *
 * A flip is a property of the *outline*, not of the shape's transform: the box
 * and the label stay where they are, and only the drawing inside them turns
 * over. That is what makes a flipped triangle still occupy exactly its own
 * bounds, and what keeps its label upright.
 */
export interface GeoFlip {
  flipX?: boolean | undefined
  flipY?: boolean | undefined
}

/** Whether `flip` asks for anything at all. */
export function hasGeoFlip(flip: GeoFlip | undefined): boolean {
  return flip !== undefined && (flip.flipX === true || flip.flipY === true)
}

/** Mirror `points` about the centre of the `w × h` box on the requested axes. */
export function mirrorPointsInBox(points: readonly VecLike[], w: number, h: number, flip: GeoFlip | undefined): VecLike[] {
  if (!hasGeoFlip(flip)) return points.map((p) => ({ x: p.x, y: p.y }))
  const fx = flip!.flipX === true
  const fy = flip!.flipY === true
  return points.map((p) => ({ x: fx ? w - p.x : p.x, y: fy ? h - p.y : p.y }))
}

/** {@link mirrorPointsInBox} for cubic segments: every control point moves with its anchors. */
export function mirrorSegmentsInBox(segments: readonly CubicSegment[], w: number, h: number, flip: GeoFlip | undefined): CubicSegment[] {
  if (!hasGeoFlip(flip)) return segments.map((s) => ({ ...s }))
  const fx = flip!.flipX === true
  const fy = flip!.flipY === true
  const map = (p: VecLike): VecLike => ({ x: fx ? w - p.x : p.x, y: fy ? h - p.y : p.y })
  return segments.map((s) => ({ p0: map(s.p0), c1: map(s.c1), c2: map(s.c2), p1: map(s.p1) }))
}

/**
 * Build the outline geometry for a geo kind inside a w×h box.
 *
 * `flip` mirrors the silhouette in place — see {@link GeoFlip}. It is applied
 * to the *source* points and control points rather than to the finished
 * geometry, so a curved outline keeps its curves instead of being flattened
 * into a mirrored polygon.
 */
export function getGeoGeometry(kind: GeoShapeKind, w: number, h: number, isFilled: boolean, flip?: GeoFlip, strokeWidth = 0): Geometry2d {
  switch (kind) {
    case "ellipse":
      // An axis-aligned ellipse is its own mirror image on both axes.
      return new Ellipse2d({ width: w, height: h, isFilled })
    case "oval":
      // As is a stadium — but it is built from segments, so it goes through the
      // same path as the rest for the sake of one behaviour rather than two.
      return new CubicSpline2d({ segments: mirrorSegmentsInBox(getStadiumSegments(w, h), w, h, flip), isClosed: true, isFilled })
    case "cloud":
      return new CubicSpline2d({ segments: mirrorSegmentsInBox(getCloudSegments(w, h), w, h, flip), isClosed: true, isFilled })
    case "heart":
      return new CubicSpline2d({ segments: mirrorSegmentsInBox(getHeartSegments(w, h), w, h, flip), isClosed: true, isFilled })
    default: {
      const points = mirrorPointsInBox(getGeoPolygonPoints(kind, w, h) ?? [], w, h, flip)
      const body = new Polygon2d({ points, isFilled })
      const decorations = getGeoDecorations(kind, w, h, strokeWidth)
      if (decorations.length === 0) return body
      return new Group2d({
        children: [body, ...decorations.map((points) => new Polyline2d({ points: mirrorPointsInBox(points, w, h, flip) }))],
      })
    }
  }
}
