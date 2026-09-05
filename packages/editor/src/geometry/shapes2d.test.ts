import { describe, expect, it } from "vitest"
import { PATH_OP } from "@mocanvas/wasm"
import {
  Arc2d,
  Box,
  Circle2d,
  CubicBezier2d,
  CubicSpline2d,
  Edge2d,
  Ellipse2d,
  Geometry2dFilters,
  Group2d,
  Mat,
  Point2d,
  Polygon2d,
  Polyline2d,
  Rectangle2d,
  Stadium2d,
  TransformedGeometry2d,
  Vec,
} from "./index"

describe("Geometry2d base contract", () => {
  const rect = new Rectangle2d({ width: 100, height: 50, isFilled: true })

  it("reports area, length and bounds vertices", () => {
    expect(rect.area).toBe(5000)
    expect(rect.length).toBe(300)
    expect(rect.boundsVertices).toHaveLength(4)
    expect(rect.getBounds().toJson()).toEqual({ x: 0, y: 0, w: 100, h: 50 })
  })

  it("an open geometry encloses nothing", () => {
    const line = new Polyline2d({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    expect(line.area).toBe(0)
    expect(line.length).toBe(10)
  })

  it("walks its own outline and back again", () => {
    // A quarter of the way round a 100x50 rectangle starting at the top left.
    const quarter = rect.interpolateAlongEdge(0.25)
    expect(quarter.toJson()).toEqual({ x: 75, y: 0 })
    expect(rect.uninterpolateAlongEdge(quarter)).toBeCloseTo(0.25, 9)
  })

  it("answers segment queries", () => {
    expect(rect.hitTestLineSegment({ x: -10, y: 25 }, { x: 200, y: 25 })).toBe(true)
    expect(rect.hitTestLineSegment({ x: -10, y: 500 }, { x: 200, y: 500 })).toBe(false)
    expect(rect.distanceToLineSegment({ x: -10, y: 500 }, { x: 200, y: 500 })).toBeCloseTo(450, 9)
  })

  it("answers intersection queries against its own outline", () => {
    expect(rect.intersectLineSegment({ x: -10, y: 25 }, { x: 200, y: 25 })).toHaveLength(2)
    expect(rect.intersectCircle({ x: 0, y: 0 }, 10)).toHaveLength(2)
    expect(rect.intersectPolygon(new Box(50, 0, 200, 200).corners)).not.toHaveLength(0)
    expect(rect.overlapsPolygon(new Box(10, 10, 5, 5).corners)).toBe(true)
    expect(rect.overlapsPolygon(new Box(500, 500, 5, 5).corners)).toBe(false)
  })

  it("isPointInBounds is the cheap pre-test", () => {
    expect(rect.isPointInBounds({ x: 50, y: 25 })).toBe(true)
    expect(rect.isPointInBounds({ x: 101, y: 25 })).toBe(false)
    expect(rect.isPointInBounds({ x: 101, y: 25 }, 2)).toBe(true)
  })

  it("emits an SVG path, joined or lifted", () => {
    expect(rect.toSimpleSvgPath()).toBe("M0,0L100,0L100,50L0,50Z")
    expect(rect.getSvgPathData(false).startsWith("L")).toBe(true)
  })

  it("ignore and the filter flags", () => {
    expect(rect.ignoreHit({ x: 0, y: 0 })).toBe(false)
    const ignored = new Rectangle2d({ width: 1, height: 1, isFilled: true, ignore: true })
    expect(ignored.ignoreHit({ x: 0, y: 0 })).toBe(true)
    const label = new Rectangle2d({ width: 1, height: 1, isFilled: true, isLabel: true })
    expect(label.isExcludedByFilter(Geometry2dFilters.EXCLUDE_LABELS)).toBe(true)
    expect(label.isExcludedByFilter(Geometry2dFilters.INCLUDE_ALL)).toBe(false)
    const internal = new Rectangle2d({ width: 1, height: 1, isFilled: true, isInternal: true })
    expect(internal.isExcludedByFilter(Geometry2dFilters.EXCLUDE_INTERNAL)).toBe(true)
    expect(internal.isExcludedByFilter(Geometry2dFilters.EXCLUDE_NON_STANDARD)).toBe(true)
    expect(internal.isExcludedByFilter()).toBe(false)
  })
})

describe("TransformedGeometry2d", () => {
  const rect = new Rectangle2d({ width: 100, height: 50, isFilled: true })

  it("moves the outline into the transform's space", () => {
    const moved = rect.transform(Mat.Translate(10, 20))
    expect(moved.bounds.toJson()).toEqual({ x: 10, y: 20, w: 100, h: 50 })
    expect(moved.hitTestPoint({ x: 50, y: 40 }, 0, true)).toBe(true)
    expect(moved.hitTestPoint({ x: 50, y: 10 }, 0, true)).toBe(false)
  })

  it("measures distance in its own space, not the source's", () => {
    const scaled = rect.transform(Mat.Identity().scale(2, 2))
    expect(scaled.distanceToPoint({ x: 210, y: 0 })).toBeCloseTo(10, 9)
  })

  it("rewrites the path encoding rather than re-flattening it", () => {
    const words = new Ellipse2d({ width: 100, height: 100, isFilled: true }).transform(Mat.Translate(5, 5)).toPathWords()
    expect(words[0]).toBe(PATH_OP.MOVE)
    expect(words.filter((w, i) => i % 7 === 3 && w === PATH_OP.CUBIC)).toHaveLength(4)
    expect(words[1]).toBe(105)
    expect(words[2]).toBe(55)
  })

  it("can override the presentation flags of its source", () => {
    const t = rect.transform(Mat.Identity(), { isLabel: true, excludeFromShapeBounds: true })
    expect(t).toBeInstanceOf(TransformedGeometry2d)
    expect(t.isLabel).toBe(true)
    expect(t.excludeFromShapeBounds).toBe(true)
  })
})

describe("Point2d", () => {
  it("is hit within its margin and nowhere else", () => {
    const p = new Point2d({ point: { x: 10, y: 10 }, margin: 4 })
    expect(p.hitTestPoint({ x: 12, y: 10 })).toBe(true)
    expect(p.hitTestPoint({ x: 20, y: 10 })).toBe(false)
    expect(p.hitTestLineSegment({ x: 0, y: 12 }, { x: 100, y: 12 })).toBe(true)
    expect(p.bounds.toJson()).toEqual({ x: 10, y: 10, w: 0, h: 0 })
    expect(p.nearestPoint().toJson()).toEqual({ x: 10, y: 10 })
  })
})

describe("Stadium2d", () => {
  it("fills its box and rounds the shorter axis", () => {
    const s = new Stadium2d({ width: 200, height: 100, isFilled: true })
    expect(s.radius).toBe(50)
    expect(s.bounds.toJson()).toEqual({ x: 0, y: 0, w: 200, h: 100 })
    // Straight top and bottom, semicircular ends.
    expect(s.getLength()).toBeCloseTo(Math.PI * 100 + 200, 6)
    expect(s.hitTestPoint({ x: 100, y: 50 }, 0, true)).toBe(true)
    // Just outside the rounded end, still inside the bounding box.
    expect(s.hitTestPoint({ x: 4, y: 4 }, 0, true)).toBe(false)
  })

  it("a square stadium is a circle", () => {
    const s = new Stadium2d({ width: 100, height: 100, isFilled: true })
    expect(s.radius).toBe(50)
    for (const v of s.vertices) expect(Math.hypot(v.x - 50, v.y - 50)).toBeCloseTo(50, 9)
  })

  it("is oriented the tall way when it is taller than it is wide", () => {
    const s = new Stadium2d({ width: 100, height: 200, isFilled: true })
    expect(s.bounds.toJson()).toEqual({ x: 0, y: 0, w: 100, h: 200 })
  })
})

describe("Arc2d", () => {
  // A quarter turn of a radius-100 circle about the origin, clockwise.
  const arc = new Arc2d({
    center: { x: 0, y: 0 },
    start: { x: 100, y: 0 },
    end: { x: 0, y: 100 },
    largeArcFlag: 0,
    sweepFlag: 1,
  })

  it("knows its radius, sweep and length", () => {
    expect(arc.radius).toBe(100)
    expect(arc.measure).toBeCloseTo(Math.PI / 2, 9)
    expect(arc.getLength()).toBeCloseTo((Math.PI / 2) * 100, 9)
  })

  it("every vertex sits on the circle, and the ends are the terminals", () => {
    for (const v of arc.vertices) expect(Math.hypot(v.x, v.y)).toBeCloseTo(100, 9)
    expect(arc.vertices[0]!.toJson()).toEqual({ x: 100, y: 0 })
    const last = arc.vertices.at(-1)!
    expect(last.x).toBeCloseTo(0, 9)
    expect(last.y).toBeCloseTo(100, 9)
  })

  it("projects a point onto the sweep, or onto the nearer end when it is outside", () => {
    const mid = arc.nearestPoint({ x: 200, y: 200 })
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100, 9)
    expect(arc.nearestPoint({ x: 200, y: -200 }).toJson()).toEqual({ x: 100, y: 0 })
  })

  it("serializes as cubics whose ends land on the arc", () => {
    const words = arc.toPathWords()
    expect(words[0]).toBe(PATH_OP.MOVE)
    expect(words[3]).toBe(PATH_OP.CUBIC)
    expect(words.at(-2)).toBeCloseTo(0, 9)
    expect(words.at(-1)).toBeCloseTo(100, 9)
  })
})

describe("CubicBezier2d and CubicSpline2d", () => {
  it("a bézier exposes both the terminal names and the segment names", () => {
    const b = new CubicBezier2d({
      start: { x: 0, y: 0 },
      cp1: { x: 0, y: 100 },
      cp2: { x: 100, y: 100 },
      end: { x: 100, y: 0 },
    })
    expect(b.p0).toBe(b.start)
    expect(b.c1).toBe(b.cp1)
    expect(b.c2).toBe(b.cp2)
    expect(b.p1).toBe(b.end)
    expect(CubicBezier2d.GetAtT(b, 0.5).toJson()).toEqual(b.getPointAt(0.5).toJson())
    expect(b.resolution).toBe(24)
    expect(b.vertices).toHaveLength(25)
  })

  it("a spline built from segments is unchanged, and its segments are béziers", () => {
    const spline = new CubicSpline2d({
      segments: [{ p0: { x: 0, y: 0 }, c1: { x: 0, y: 50 }, c2: { x: 50, y: 100 }, p1: { x: 100, y: 100 } }],
      isClosed: false,
    })
    expect(spline.segments[0]).toBeInstanceOf(CubicBezier2d)
    expect(spline.segments[0]!.p1.toJson()).toEqual({ x: 100, y: 100 })
    // 12 samples per segment plus the final point.
    expect(spline.vertices).toHaveLength(13)
    expect(spline.toPathWords()).toEqual([PATH_OP.MOVE, 0, 0, PATH_OP.CUBIC, 0, 50, 50, 100, 100, 100])
  })

  it("a spline built from points passes through every one of them", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
      { x: 150, y: 100 },
    ]
    const spline = new CubicSpline2d({ points })
    expect(spline.segments).toHaveLength(3)
    for (const [i, p] of points.entries()) {
      const seg = spline.segments[Math.min(i, 2)]!
      const end = i === 0 ? seg.p0 : spline.segments[i - 1]!.p1
      expect(end.toJson()).toEqual(p)
    }
    // Collinear input gives a straight line, not a wobble.
    const straight = new CubicSpline2d({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
    })
    for (const v of straight.vertices) expect(v.y).toBeCloseTo(0, 9)
  })
})

describe("Polyline2d, Edge2d and the rest", () => {
  it("a polyline splits into edges", () => {
    const line = new Polyline2d({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    })
    expect(line.segments).toHaveLength(2)
    expect(line.segments[0]).toBeInstanceOf(Edge2d)
    expect(line.segments[0]!.getLength()).toBe(10)
    expect(line.getLength()).toBe(20)
  })

  it("an edge knows its direction and its own nearest point", () => {
    const e = new Edge2d({ start: { x: 0, y: 0 }, end: { x: 0, y: 10 } })
    expect(e.direction.toJson()).toEqual({ x: 0, y: 1 })
    expect(e.nearestPoint({ x: 5, y: 5 }).toJson()).toEqual({ x: 0, y: 5 })
  })

  it("a circle reports its radius and its exact perimeter", () => {
    const c = new Circle2d({ radius: 10, isFilled: true })
    expect(c.radius).toBe(10)
    expect(c.getLength()).toBeCloseTo(Math.PI * 20, 9)
    expect(c.getArea()).toBeCloseTo(Math.PI * 100, 9)
    expect(c.bounds.toJson()).toEqual({ x: 0, y: 0, w: 20, h: 20 })
  })

  it("a polygon is closed and encloses its shoelace area", () => {
    const p = new Polygon2d({ points: new Box(0, 0, 10, 10).corners, isFilled: true })
    expect(p.isClosed).toBe(true)
    expect(p.area).toBe(100)
  })
})

describe("Group2d filtering", () => {
  const group = new Group2d({
    children: [
      new Rectangle2d({ width: 100, height: 100, isFilled: true }),
      new Rectangle2d({ x: 10, y: 10, width: 20, height: 20, isFilled: true, isLabel: true }),
      new Rectangle2d({ x: 40, y: 40, width: 20, height: 20, isFilled: true, isInternal: true }),
    ],
  })

  it("getVertices honours the filter presets", () => {
    expect(group.getVertices(Geometry2dFilters.INCLUDE_ALL)).toHaveLength(12)
    expect(group.getVertices(Geometry2dFilters.EXCLUDE_LABELS)).toHaveLength(8)
    expect(group.getVertices(Geometry2dFilters.EXCLUDE_INTERNAL)).toHaveLength(8)
    expect(group.getVertices(Geometry2dFilters.EXCLUDE_NON_STANDARD)).toHaveLength(4)
  })

  it("hit testing skips filtered children", () => {
    const inLabel = { x: 15, y: 15 }
    expect(group.hitTestPoint(inLabel, 0, true, Geometry2dFilters.INCLUDE_ALL)).toBe(true)
    // Excluding the label still hits, because the outline is underneath it.
    expect(group.hitTestPoint(inLabel, 0, true, Geometry2dFilters.EXCLUDE_LABELS)).toBe(true)
    const outside = { x: 500, y: 500 }
    expect(group.hitTestPoint(outside, 0, true)).toBe(false)
  })

  it("area and length add the children up", () => {
    expect(group.getArea()).toBe(100 * 100 + 20 * 20 + 20 * 20)
    expect(group.getLength(Geometry2dFilters.EXCLUDE_NON_STANDARD)).toBe(400)
  })

  it("its svg path is every child's subpath, each with its own move", () => {
    const d = group.getSvgPathData()
    expect(d.split("M")).toHaveLength(4)
  })

  it("nearestPoint reaches into the closest child", () => {
    expect(group.nearestPoint({ x: -10, y: 50 }).toJson()).toEqual({ x: 0, y: 50 })
  })
})

describe("geometry vertices are Vecs, not bare points", () => {
  it("so a caller can chain off one", () => {
    const v = new Rectangle2d({ width: 10, height: 10, isFilled: true }).vertices[2]!
    expect(v).toBeInstanceOf(Vec)
    expect(v.clone().sub({ x: 10, y: 10 }).toJson()).toEqual({ x: 0, y: 0 })
  })
})
