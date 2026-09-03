import { describe, expect, it } from "vitest"
import { CubicSpline2d, Polygon2d, Polyline2d, Vec } from "@mocanvas/editor"
import {
  bodyToGeometry,
  getArrowBody,
  getArrowheadGeometry,
  getArrowheadInset,
  getArrowheadLength,
  getBendFromPoint,
  getBodyLength,
  getPointOnBody,
  getTangentOnBody,
  shortenBody,
  type ArrowheadKind,
} from "./arrow-helpers"

const S = { x: 0, y: 0 }
const E = { x: 100, y: 0 }

describe("arrow body", () => {
  it("is straight when bend is zero or endpoints coincide", () => {
    expect(getArrowBody(S, E, 0).kind).toBe("straight")
    expect(getArrowBody(S, S, 30).kind).toBe("straight")
    expect(getBodyLength(getArrowBody(S, E, 0))).toBeCloseTo(100)
  })

  it("arc passes through the bend point at its midpoint", () => {
    for (const bend of [20, -20, 5, 80, -150]) {
      const body = getArrowBody(S, E, bend)
      expect(body.kind).toBe("arc")
      const mid = getPointOnBody(body, 0.5)
      expect(mid.x).toBeCloseTo(50, 6)
      expect(mid.y).toBeCloseTo(bend, 6)
      expect(getPointOnBody(body, 0).x).toBeCloseTo(0, 6)
      expect(getPointOnBody(body, 0).y).toBeCloseTo(0, 6)
      expect(getPointOnBody(body, 1).x).toBeCloseTo(100, 6)
      expect(getPointOnBody(body, 1).y).toBeCloseTo(0, 6)
    }
  })

  it("large bends produce major arcs", () => {
    const body = getArrowBody(S, E, 80)
    expect(body.kind === "arc" && Math.abs(body.sweep) > Math.PI).toBe(true)
    const small = getArrowBody(S, E, 10)
    expect(small.kind === "arc" && Math.abs(small.sweep) < Math.PI).toBe(true)
  })

  it("works for arbitrary orientations", () => {
    const s = { x: 30, y: -10 }
    const e = { x: -70, y: 55 }
    const body = getArrowBody(s, e, 33)
    const u = Vec.Uni(Vec.Sub(e, s))
    const n = Vec.Per(u)
    const expected = Vec.Add(Vec.Lrp(s, e, 0.5), Vec.Mul(n, 33))
    const mid = getPointOnBody(body, 0.5)
    expect(mid.x).toBeCloseTo(expected.x, 6)
    expect(mid.y).toBeCloseTo(expected.y, 6)
  })

  it("tangent at the ends points along the travel direction", () => {
    const straight = getArrowBody(S, E, 0)
    expect(getTangentOnBody(straight, 1).x).toBeCloseTo(1)
    const arc = getArrowBody(S, E, 20)
    const t0 = getTangentOnBody(arc, 0)
    expect(t0.x).toBeGreaterThan(0)
    expect(t0.y).toBeGreaterThan(0) // heads down toward the bend first
    const t1 = getTangentOnBody(arc, 1)
    expect(t1.x).toBeGreaterThan(0)
    expect(t1.y).toBeLessThan(0)
    expect(Vec.Len(t1)).toBeCloseTo(1)
  })

  it("shortening trims both ends and never eats the whole body", () => {
    const straight = shortenBody(getArrowBody(S, E, 0), 10, 20)
    expect(getBodyLength(straight)).toBeCloseTo(70)
    expect(getPointOnBody(straight, 0).x).toBeCloseTo(10)
    expect(getPointOnBody(straight, 1).x).toBeCloseTo(80)

    const arc = getArrowBody(S, E, 20)
    const trimmed = shortenBody(arc, 10, 20)
    expect(getBodyLength(trimmed)).toBeCloseTo(getBodyLength(arc) - 30, 6)
    expect(Vec.Dist(getPointOnBody(trimmed, 0), getPointOnBody(arc, 0))).toBeCloseTo(10, 1)

    const tiny = shortenBody(getArrowBody(S, { x: 10, y: 0 }, 0), 50, 50)
    expect(getBodyLength(tiny)).toBeCloseTo(1)
  })

  it("arc geometry approximates the circle with at least two cubics", () => {
    const arc = getArrowBody(S, E, 20)
    const geo = bodyToGeometry(arc)
    expect(geo).toBeInstanceOf(CubicSpline2d)
    const spline = geo as CubicSpline2d
    expect(spline.segments.length).toBeGreaterThanOrEqual(2)
    expect(spline.isFilled).toBe(false)
    if (arc.kind !== "arc") throw new Error("expected arc")
    for (const v of spline.vertices) expect(Math.abs(Vec.Dist(v, arc.center) - arc.radius)).toBeLessThan(0.2)
    expect(bodyToGeometry(getArrowBody(S, E, 0))).toBeInstanceOf(Polyline2d)
  })
})

describe("arrowheads", () => {
  const KINDS: ArrowheadKind[] = ["none", "arrow", "triangle", "square", "dot", "diamond", "inverted", "bar", "pipe"]

  it("length scales with stroke and is capped by the body", () => {
    expect(getArrowheadLength(3.5, 1000)).toBe(14)
    expect(getArrowheadLength(2, 1000)).toBe(12)
    expect(getArrowheadLength(10, 50)).toBe(20)
  })

  it("closed heads are filled polygons that inset the body; open heads do not", () => {
    for (const kind of KINDS) {
      const g = getArrowheadGeometry(kind, { x: 100, y: 0 }, { x: 1, y: 0 }, 14)
      if (kind === "none") {
        expect(g).toBeNull()
        continue
      }
      expect(g).not.toBeNull()
      const inset = getArrowheadInset(kind, 14)
      if (g!.isFilled) {
        expect(inset).toBe(14)
        expect(g!.isClosed).toBe(true)
      } else {
        expect(inset).toBe(0)
        expect(g).toBeInstanceOf(Polyline2d)
      }
      // Every head sits within one length of the tip.
      for (const v of g!.vertices) expect(v.x).toBeLessThanOrEqual(100 + 1e-6)
      for (const v of g!.vertices) expect(v.x).toBeGreaterThanOrEqual(100 - 14 - 1e-6)
    }
  })

  it("triangle tip is at the endpoint", () => {
    const g = getArrowheadGeometry("triangle", { x: 100, y: 0 }, { x: 1, y: 0 }, 14) as Polygon2d
    expect(g.points[0]!.x).toBeCloseTo(100)
    expect(g.points[1]!.x).toBeCloseTo(86)
    expect(g.points[1]!.y).toBeCloseTo(-g.points[2]!.y)
  })
})

describe("getBendFromPoint", () => {
  it("recovers the bend from a dragged midpoint and snaps tiny values to zero", () => {
    expect(getBendFromPoint(S, E, { x: 50, y: 25 })).toBeCloseTo(25)
    expect(getBendFromPoint(S, E, { x: 20, y: -40 })).toBeCloseTo(-40)
    expect(getBendFromPoint(S, E, { x: 50, y: 0.4 })).toBe(0)
    expect(getBendFromPoint(S, S, { x: 5, y: 5 })).toBe(0)
  })

  it("round-trips through getArrowBody", () => {
    const bend = 37
    const mid = getPointOnBody(getArrowBody(S, E, bend), 0.5)
    expect(getBendFromPoint(S, E, mid)).toBeCloseTo(bend, 6)
  })
})
