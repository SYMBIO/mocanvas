import { describe, expect, it } from "vitest"
import { Box, CubicSpline2d, GEO_SHAPE_KINDS, Group2d, Polygon2d, type GeoShapeKind } from "@mocanvas/editor"
import {
  fitPointsToBox,
  getCloudSegments,
  getGeoDecorations,
  getGeoGeometry,
  getGeoPolygonPoints,
  getHeartSegments,
  getStadiumSegments,
} from "./geo-helpers"

const POLYGON_KINDS: Record<string, number> = {
  rectangle: 4,
  triangle: 3,
  diamond: 4,
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
  star: 10,
  rhombus: 4,
  "rhombus-2": 4,
  trapezoid: 4,
  "arrow-right": 7,
  "arrow-left": 7,
  "arrow-up": 7,
  "arrow-down": 7,
  "x-box": 4,
  "check-box": 4,
}

const CURVED_KINDS = ["ellipse", "oval", "cloud", "heart"]

function expectBounds(points: { x: number; y: number }[], w: number, h: number, tol = 1e-6) {
  const b = Box.FromPoints(points)
  expect(Math.abs(b.x)).toBeLessThan(tol)
  expect(Math.abs(b.y)).toBeLessThan(tol)
  expect(Math.abs(b.w - w)).toBeLessThan(tol)
  expect(Math.abs(b.h - h)).toBeLessThan(tol)
}

describe("geo polygons", () => {
  it("covers every kind either as a polygon or a curve", () => {
    for (const kind of GEO_SHAPE_KINDS) {
      const pts = getGeoPolygonPoints(kind, 100, 60)
      if (CURVED_KINDS.includes(kind)) expect(pts).toBeNull()
      else expect(pts).not.toBeNull()
    }
  })

  it.each(Object.entries(POLYGON_KINDS))("%s has %i vertices and bounds equal to w×h", (kind, count) => {
    for (const [w, h] of [
      [100, 100],
      [250, 80],
      [40, 300],
    ] as const) {
      const pts = getGeoPolygonPoints(kind as GeoShapeKind, w, h)!
      expect(pts).toHaveLength(count)
      expectBounds(pts, w, h)
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  })

  it("block arrows point in their named direction", () => {
    const right = getGeoPolygonPoints("arrow-right", 100, 50)!
    expect(right.some((p) => p.x === 100 && p.y === 25)).toBe(true)
    const left = getGeoPolygonPoints("arrow-left", 100, 50)!
    expect(left.some((p) => p.x === 0 && p.y === 25)).toBe(true)
    const up = getGeoPolygonPoints("arrow-up", 50, 100)!
    expect(up.some((p) => p.y === 0 && p.x === 25)).toBe(true)
    const down = getGeoPolygonPoints("arrow-down", 50, 100)!
    expect(down.some((p) => p.y === 100 && p.x === 25)).toBe(true)
  })

  it("fitPointsToBox stretches to the exact box", () => {
    const pts = fitPointsToBox([{ x: -1, y: 3 }, { x: 2, y: 5 }, { x: 0.5, y: 4 }], 30, 10)
    expectBounds(pts, 30, 10)
    expect(fitPointsToBox([], 1, 1)).toEqual([])
  })

  it("decorations exist only for x-box and check-box", () => {
    expect(getGeoDecorations("x-box", 10, 10)).toHaveLength(2)
    expect(getGeoDecorations("check-box", 10, 10)).toHaveLength(1)
    expect(getGeoDecorations("rectangle", 10, 10)).toHaveLength(0)
  })
})

describe("geo curves", () => {
  it("stadium fills its box in both orientations", () => {
    for (const [w, h] of [
      [200, 80],
      [80, 200],
      [100, 100],
    ] as const) {
      const spline = new CubicSpline2d({ segments: getStadiumSegments(w, h), isClosed: true })
      const b = spline.bounds
      expect(Math.abs(b.w - w)).toBeLessThan(1e-6)
      expect(Math.abs(b.h - h)).toBeLessThan(1e-6)
      // segments chain continuously
      const segs = spline.segments
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i]!
        const next = segs[(i + 1) % segs.length]!
        expect(a.p1.x).toBeCloseTo(next.p0.x, 6)
        expect(a.p1.y).toBeCloseTo(next.p0.y, 6)
      }
    }
  })

  it("cloud and heart are closed, continuous and fitted to the box", () => {
    for (const make of [getCloudSegments, getHeartSegments]) {
      const segs = make(120, 90)
      expect(segs.length).toBeGreaterThanOrEqual(5)
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i]!
        const next = segs[(i + 1) % segs.length]!
        expect(a.p1.x).toBeCloseTo(next.p0.x, 6)
        expect(a.p1.y).toBeCloseTo(next.p0.y, 6)
      }
      const b = new CubicSpline2d({ segments: segs, isClosed: true }).bounds
      expect(Math.abs(b.x)).toBeLessThan(1e-6)
      expect(Math.abs(b.y)).toBeLessThan(1e-6)
      expect(Math.abs(b.w - 120)).toBeLessThan(1e-6)
      expect(Math.abs(b.h - 90)).toBeLessThan(1e-6)
    }
  })

  it("getGeoGeometry picks the right geometry class", () => {
    expect(getGeoGeometry("rectangle", 10, 10, false)).toBeInstanceOf(Polygon2d)
    expect(getGeoGeometry("x-box", 10, 10, false)).toBeInstanceOf(Group2d)
    expect(getGeoGeometry("oval", 10, 10, true)).toBeInstanceOf(CubicSpline2d)
    expect(getGeoGeometry("cloud", 10, 10, true).isFilled).toBe(true)
    expect(getGeoGeometry("heart", 10, 10, false).isFilled).toBe(false)
    expect(getGeoGeometry("star", 10, 10, true).isClosed).toBe(true)
  })
})
