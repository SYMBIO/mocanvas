import { describe, expect, it } from "vitest"
import {
  EASINGS,
  HALF_PI,
  PI,
  PI2,
  angleDistance,
  approximately,
  areAnglesCompatible,
  average,
  canonicalizeRotation,
  centerOfCircleFromThreePoints,
  clamp,
  clampRadians,
  clockwiseAngleDist,
  counterClockwiseAngleDist,
  degreesToRadians,
  getArcMeasure,
  getPointInArcT,
  getPointOnCircle,
  getPointsOnArc,
  perimeterOfEllipse,
  precise,
  radiansToDegrees,
  rangeIntersection,
  shortAngleDist,
  snapAngle,
  toDomPrecision,
} from "./index"

describe("scalar helpers", () => {
  it("clamp takes one or two bounds", () => {
    expect(clamp(0, 1, 10)).toBe(1)
    expect(clamp(11, 1, 10)).toBe(10)
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-5, 0)).toBe(0)
  })

  it("approximately forgives dust and not real differences", () => {
    expect(approximately(1, 1 + 1e-9)).toBe(true)
    expect(approximately(1, 1.01)).toBe(false)
    expect(approximately(1, 1.01, 0.1)).toBe(true)
  })

  it("rounding helpers", () => {
    expect(toDomPrecision(1.000004999)).toBe(1)
    expect(precise({ x: 1.000004999, y: 2 })).toBe("1,2 ")
    expect(average({ x: 0, y: 0 }, { x: 10, y: 4 })).toBe("5,2 ")
  })

  it("rangeIntersection accepts either endpoint order and reports no overlap", () => {
    expect(rangeIntersection(0, 10, 5, 15)).toEqual([5, 10])
    expect(rangeIntersection(10, 0, 15, 5)).toEqual([5, 10])
    expect(rangeIntersection(0, 1, 2, 3)).toBeNull()
    // Touching at a point still overlaps, at that point.
    expect(rangeIntersection(0, 1, 1, 2)).toEqual([1, 1])
  })

  it("EASINGS all map 0 to 0 and 1 to 1", () => {
    for (const [name, ease] of Object.entries(EASINGS)) {
      expect(ease(0), name).toBeCloseTo(0, 9)
      expect(ease(1), name).toBeCloseTo(1, 9)
    }
  })
})

describe("angles", () => {
  it("degrees and radians round-trip", () => {
    expect(degreesToRadians(180)).toBeCloseTo(PI, 12)
    expect(radiansToDegrees(HALF_PI)).toBeCloseTo(90, 12)
  })

  it("canonicalizeRotation and clampRadians bring an angle into [0, 2π)", () => {
    expect(canonicalizeRotation(-HALF_PI)).toBeCloseTo((PI * 3) / 2, 12)
    expect(canonicalizeRotation(PI2 + 1)).toBeCloseTo(1, 12)
    expect(clampRadians(-HALF_PI)).toBeCloseTo((PI * 3) / 2, 12)
  })

  it("shortAngleDist takes the short way round the wrap", () => {
    expect(shortAngleDist(0.1, PI2 - 0.1)).toBeCloseTo(-0.2, 9)
    expect(shortAngleDist(0, HALF_PI)).toBeCloseTo(HALF_PI, 9)
  })

  it("clockwise and counter-clockwise distances sum to a full turn", () => {
    const cw = clockwiseAngleDist(0.3, 2)
    const ccw = counterClockwiseAngleDist(0.3, 2)
    expect(cw + ccw).toBeCloseTo(PI2, 9)
    expect(angleDistance(0.3, 2, -1)).toBeCloseTo(cw, 12)
    expect(angleDistance(0.3, 2, 1)).toBeCloseTo(ccw, 12)
  })

  it("areAnglesCompatible means the same axes", () => {
    expect(areAnglesCompatible(0, HALF_PI)).toBe(true)
    expect(areAnglesCompatible(0, PI)).toBe(true)
    expect(areAnglesCompatible(0, 0.4)).toBe(false)
  })

  it("snapAngle rounds to the nearest of n even segments", () => {
    expect(snapAngle(0.1, 4)).toBeCloseTo(0, 9)
    expect(snapAngle(HALF_PI - 0.1, 4)).toBeCloseTo(HALF_PI, 9)
    expect(snapAngle(-0.1, 4)).toBeCloseTo(0, 9)
  })
})

describe("circles and arcs", () => {
  it("getPointOnCircle walks the perimeter", () => {
    const p = getPointOnCircle({ x: 10, y: 10 }, 5, 0)
    expect(p.toJson()).toEqual({ x: 15, y: 10 })
  })

  it("getArcMeasure honours the two SVG flags", () => {
    // A quarter turn: the small arc is the quarter, the large one is the rest.
    expect(getArcMeasure(0, HALF_PI, 1, 0)).toBeCloseTo(HALF_PI, 9)
    expect(getArcMeasure(0, HALF_PI, 1, 1)).toBeCloseTo(PI2 - HALF_PI, 9)
    expect(getArcMeasure(0, HALF_PI, 0, 1)).toBeCloseTo(-(PI2 - HALF_PI), 9)
  })

  it("getPointInArcT is 0 at the start and 1 at the end, either way round", () => {
    const m = getArcMeasure(0, HALF_PI, 1, 0)
    expect(getPointInArcT(m, 0, HALF_PI, 0)).toBeCloseTo(0, 9)
    expect(getPointInArcT(m, 0, HALF_PI, HALF_PI)).toBeCloseTo(1, 9)
    expect(getPointInArcT(m, 0, HALF_PI, HALF_PI / 2)).toBeCloseTo(0.5, 9)
    const back = getArcMeasure(HALF_PI, 0, 1, 0)
    expect(getPointInArcT(back, HALF_PI, 0, 0)).toBeCloseTo(1, 9)
  })

  it("getPointsOnArc spans the ends, and falls back to a straight line", () => {
    const arc = getPointsOnArc({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 0 }, 10, 5)
    expect(arc).toHaveLength(5)
    expect(arc[0]!.x).toBeCloseTo(10, 9)
    expect(arc[4]!.y).toBeCloseTo(10, 9)
    // Every sample sits on the circle.
    for (const p of arc) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9)
    const straight = getPointsOnArc({ x: 0, y: 0 }, { x: 10, y: 0 }, null, 0, 3)
    expect(straight.map((p) => p.x)).toEqual([0, 5, 10])
  })

  it("centerOfCircleFromThreePoints finds the centre, and refuses collinear points", () => {
    const c = centerOfCircleFromThreePoints({ x: -5, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 })
    expect(c!.x).toBeCloseTo(0, 9)
    expect(c!.y).toBeCloseTo(0, 9)
    expect(centerOfCircleFromThreePoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull()
  })

  it("perimeterOfEllipse reduces to a circle's circumference", () => {
    expect(perimeterOfEllipse(10, 10)).toBeCloseTo(PI2 * 10, 9)
    // Ramanujan is accurate to well under a tenth of a percent at 2:1.
    expect(perimeterOfEllipse(20, 10)).toBeCloseTo(96.884, 2)
  })
})
