import { describe, expect, it } from "vitest"
import { PATH_OP } from "@mocanvas/wasm"
import { Box, CubicBezier2d, Ellipse2d, Group2d, Mat, Polyline2d, Rectangle2d, Vec, getPolygonVertices } from "./index"

describe("geometry", () => {
  it("rectangle serializes to a closed polygon", () => {
    const r = new Rectangle2d({ width: 10, height: 5, isFilled: true })
    expect(r.toPathWords()).toEqual([PATH_OP.MOVE, 0, 0, PATH_OP.LINE, 10, 0, PATH_OP.LINE, 10, 5, PATH_OP.LINE, 0, 5, PATH_OP.CLOSE])
    expect(r.bounds).toEqual(new Box(0, 0, 10, 5))
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, true)).toBe(true)
    // Filled, so its middle answers WITHOUT the caller asking for `hitInside`.
    // This line used to expect `false`, which is the bug it was written around:
    // a solid shape could not be selected by clicking the middle of it.
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, false)).toBe(true)
    expect(r.hitTestPoint({ x: 5, y: 0.5 }, 1, false)).toBe(true)
  })

  it("leaves a HOLLOW rectangle's middle alone unless asked", () => {
    // The other half of the rule, and the reason it is a disjunction rather
    // than "always hit the inside": an unfilled rectangle is a frame around
    // empty space, and clicking that space should reach what is behind it.
    const r = new Rectangle2d({ width: 10, height: 5, isFilled: false })
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, false)).toBe(false)
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, true)).toBe(true)
    expect(r.hitTestPoint({ x: 5, y: 0.5 }, 1, false), "the outline still answers").toBe(true)
  })

  it("ellipse uses cubics and tight bounds", () => {
    const e = new Ellipse2d({ width: 100, height: 40, isFilled: false })
    const w = e.toPathWords()
    expect(w[0]).toBe(PATH_OP.MOVE)
    expect(w.filter((x, i) => i % 7 === 3 && x === PATH_OP.CUBIC).length).toBe(4)
    expect(Math.round(e.bounds.w)).toBe(100)
  })

  it("polyline is open and nearest point works", () => {
    const l = new Polyline2d({ points: [new Vec(0, 0), new Vec(10, 0)] })
    expect(l.isClosed).toBe(false)
    expect(l.nearestPoint({ x: 5, y: 3 })).toEqual(new Vec(5, 0))
    expect(l.distanceToPoint({ x: 5, y: 3 })).toBe(3)
  })

  it("group skips labels in path words", () => {
    const g = new Group2d({
      children: [
        new Rectangle2d({ width: 10, height: 10, isFilled: true }),
        new Rectangle2d({ width: 4, height: 4, isFilled: false, isLabel: true }),
      ],
    })
    expect(g.toPathWords().length).toBe(13)
  })
})

describe("Box instance predicates", () => {
  it("contains is the instance form of Box.Contains, touching edges included", () => {
    const outer = new Box(0, 0, 100, 100)
    expect(outer.contains(new Box(10, 10, 10, 10))).toBe(true)
    expect(outer.contains(new Box(0, 0, 100, 100))).toBe(true)
    expect(outer.contains(new Box(-1, 10, 10, 10))).toBe(false)
    expect(outer.contains(new Box(95, 10, 10, 10))).toBe(false)
  })

  it("containsPoint honours a margin and collides is symmetric", () => {
    const b = new Box(0, 0, 10, 10)
    expect(b.containsPoint({ x: 11, y: 5 })).toBe(false)
    expect(b.containsPoint({ x: 11, y: 5 }, 2)).toBe(true)
    expect(b.collides(new Box(5, 5, 10, 10))).toBe(true)
    expect(b.collides(new Box(20, 20, 1, 1))).toBe(false)
  })

  it("expandBy grows in place and translate moves in place", () => {
    const b = new Box(10, 10, 10, 10)
    expect(b.expandBy(5)).toBe(b)
    expect(b.toJson()).toEqual({ x: 5, y: 5, w: 20, h: 20 })
    // Box.ExpandBy is the pure form, for when the input must not be touched.
    const source = new Box(10, 10, 10, 10)
    expect(Box.ExpandBy(source, 5).toJson()).toEqual({ x: 5, y: 5, w: 20, h: 20 })
    expect(source.toJson()).toEqual({ x: 10, y: 10, w: 10, h: 10 })
    expect(b.translate({ x: 1, y: 2 })).toBe(b)
    expect(b.toJson()).toEqual({ x: 6, y: 7, w: 20, h: 20 })
  })
})

describe("excludeFromShapeBounds", () => {
  it("keeps an overhanging label out of the group's bounds but not its hit test", () => {
    const g = new Group2d({
      children: [
        new Rectangle2d({ width: 100, height: 100, isFilled: true }),
        new Rectangle2d({
          y: -20,
          width: 60,
          height: 20,
          isFilled: true,
          isLabel: true,
          excludeFromShapeBounds: true,
        }),
      ],
    })
    expect(g.bounds.toJson()).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    expect(g.hitTestPoint({ x: 30, y: -10 }, 0, true)).toBe(true)
  })

  it("falls back to every child when they are all excluded", () => {
    const g = new Group2d({
      children: [new Rectangle2d({ width: 10, height: 10, isFilled: true, excludeFromShapeBounds: true })],
    })
    expect(g.bounds.toJson()).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })

  it("defaults to false", () => {
    expect(new Rectangle2d({ width: 1, height: 1, isFilled: true }).excludeFromShapeBounds).toBe(false)
  })
})

describe("getPolygonVertices", () => {
  it("emits `sides` vertices that exactly fill the box", () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      const points = getPolygonVertices(200, 180, sides)
      expect(points).toHaveLength(sides)
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      expect(Math.min(...xs)).toBeCloseTo(0, 9)
      expect(Math.max(...xs)).toBeCloseTo(200, 9)
      expect(Math.min(...ys)).toBeCloseTo(0, 9)
      expect(Math.max(...ys)).toBeCloseTo(180, 9)
    }
  })

  it("starts at the apex and runs clockwise", () => {
    const points = getPolygonVertices(200, 200, 6)
    expect(points[0]!.x).toBeCloseTo(100, 9)
    expect(points[0]!.y).toBeCloseTo(0, 9)
    // The next vertex is to the right of the apex, i.e. clockwise in screen space.
    expect(points[1]!.x).toBeGreaterThan(points[0]!.x)
  })

  it("is the diamond for 4 sides and the triangle for 3", () => {
    const diamond = getPolygonVertices(100, 60, 4)
    for (const [i, expected] of (
      [
        { x: 50, y: 0 },
        { x: 100, y: 30 },
        { x: 50, y: 60 },
        { x: 0, y: 30 },
      ] as const
    ).entries()) {
      expect(diamond[i]!.x).toBeCloseTo(expected.x, 9)
      expect(diamond[i]!.y).toBeCloseTo(expected.y, 9)
    }
    const tri = getPolygonVertices(100, 60, 3).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
    expect(tri).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ])
  })

  it("refuses degenerate polygons", () => {
    expect(getPolygonVertices(100, 100, 2)).toEqual([])
    expect(getPolygonVertices(100, 100, Number.NaN)).toEqual([])
  })
})

describe("CubicBezier2d", () => {
  it("starts and ends at its terminals", () => {
    const b = new CubicBezier2d({
      start: { x: 0, y: 0 },
      cp1: { x: 50, y: 0 },
      cp2: { x: 50, y: 100 },
      end: { x: 100, y: 100 },
    })
    expect(b.getPointAt(0).toJson()).toEqual({ x: 0, y: 0 })
    expect(b.getPointAt(1).toJson()).toEqual({ x: 100, y: 100 })
    expect(b.getPointAt(0.5).x).toBeCloseTo(50, 9)
    expect(b.getPointAt(0.5).y).toBeCloseTo(50, 9)
    expect(b.isClosed).toBe(false)
    expect(b.isFilled).toBe(false)
  })

  it("serializes as one move plus one cubic", () => {
    const b = new CubicBezier2d({
      start: { x: 1, y: 2 },
      cp1: { x: 3, y: 4 },
      cp2: { x: 5, y: 6 },
      end: { x: 7, y: 8 },
    })
    expect(b.toPathWords()).toEqual([PATH_OP.MOVE, 1, 2, PATH_OP.CUBIC, 3, 4, 5, 6, 7, 8])
  })

  it("hit-tests along the curve rather than the chord", () => {
    const b = new CubicBezier2d({
      start: { x: 0, y: 0 },
      cp1: { x: 0, y: 100 },
      cp2: { x: 100, y: 100 },
      end: { x: 100, y: 0 },
    })
    // The chord is the x axis; the curve bulges to y = 75 at its midpoint.
    expect(b.nearestPoint({ x: 50, y: 75 }).y).toBeCloseTo(75, 1)
    expect(b.hitTestPoint({ x: 50, y: 0 }, 2)).toBe(false)
  })
})

describe("Mat", () => {
  const cases: [number, number, number][] = [
    [0, 0, 0],
    [12, 34, 0],
    [100, 50, Math.PI / 2],
    [-40, 8, -Math.PI / 3],
    [7.5, -2.25, 2.4],
  ]

  it("translate on an unrotated matrix is a pure translation with no float dust", () => {
    expect(Mat.Identity().translate(12, 34).toJson()).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 12, f: 34 })
  })

  it("rotate(0) short-circuits", () => {
    expect(Mat.Identity().translate(12, 34).rotate(0).toJson()).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 12, f: 34 })
  })

  it("translate then rotate rotates ABOUT the translated origin", () => {
    const m = Mat.Identity().translate(10, 0).rotate(Math.PI / 2)
    expect(m.e).toBeCloseTo(10, 12)
    expect(m.f).toBeCloseTo(0, 12)
    expect(m.point().toJson()).toEqual({ x: m.e, y: m.f })
  })

  it("the builders mutate and return the same matrix", () => {
    const m = Mat.Identity()
    expect(m.translate(1, 2)).toBe(m)
    expect(m.rotate(0.5)).toBe(m)
    expect(m.scale(2, 3)).toBe(m)
  })

  it.each(cases)("rotation() of translate(%s, %s).rotate(%s) recovers the angle in [0, 2π)", (x, y, r) => {
    const tau = Math.PI * 2
    expect(Mat.Identity().translate(x, y).rotate(r).rotation()).toBeCloseTo((tau + r) % tau, 12)
  })

  it("rotation() reads the b/d column when a and c are exactly zero", () => {
    expect(Mat.Rotation({ a: 0, b: 1, c: 0, d: 0, e: 0, f: 0 })).toBeCloseTo(Math.PI / 2, 12)
    expect(Mat.Rotation({ a: 0, b: 1, c: 0, d: 1, e: 0, f: 0 })).toBeCloseTo(Math.PI / 4, 12)
    expect(Mat.Rotation({ a: 0, b: 0, c: 0, d: 0, e: 5, f: 5 })).toBe(0)
  })

  it("Compose is the left-to-right product, and empty is the identity", () => {
    const parent = Mat.Identity().translate(100, 50).rotate(0.7)
    const child = Mat.Identity().translate(10, 20).rotate(0.2)
    expect(Mat.Compose(parent, child).toJson()).toEqual(Mat.Multiply(parent, child).toJson())
    expect(Mat.Compose().toJson()).toEqual(Mat.Identity().toJson())
    expect(Mat.Compose(parent).toJson()).toEqual(parent.toJson())
  })

  it("Compose then invert is the change of basis a reparent needs", () => {
    const parent = Mat.Identity().translate(100, 50).rotate(0.7)
    const local = { x: 24, y: -18 }
    const page = parent.applyToPoint(local)
    const back = Mat.Inverse(parent).applyToPoint(page)
    expect(back.x).toBeCloseTo(local.x, 9)
    expect(back.y).toBeCloseTo(local.y, 9)
  })

  it("scale defaults its second axis to the first", () => {
    expect(Mat.Identity().scale(2).toJson()).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })
  })

  it("Translate and Rotate build the same matrices as the builders", () => {
    expect(Mat.Translate(3, 4).toJson()).toEqual(Mat.Identity().translate(3, 4).toJson())
    expect(Mat.Rotate(0.9).toJson()).toEqual(Mat.Identity().rotate(0.9).toJson())
    expect(Mat.Rotate(0).toJson()).toEqual(Mat.Identity().toJson())
  })
})
