import { describe, expect, it } from "vitest"
import {
  Box,
  intersectCircleCircle,
  intersectCirclePolygon,
  intersectCirclePolyline,
  intersectLineSegmentCircle,
  intersectLineSegmentLineSegment,
  intersectLineSegmentPolygon,
  intersectLineSegmentPolyline,
  intersectPolygonBounds,
  intersectPolygonPolygon,
  linesIntersect,
  pointInPolygon,
  polygonIntersectsPolyline,
  polygonsIntersect,
} from "./index"

const SQUARE = new Box(0, 0, 100, 100).corners

describe("segment intersections", () => {
  it("finds the crossing of two segments and nothing when they miss", () => {
    expect(intersectLineSegmentLineSegment({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })!.toJson()).toEqual({
      x: 5,
      y: 5,
    })
    // Collinear or parallel segments have no single crossing point.
    expect(intersectLineSegmentLineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull()
    // Extending past the end does not count.
    expect(intersectLineSegmentLineSegment({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBeNull()
    expect(linesIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
  })

  it("meeting exactly at an endpoint counts", () => {
    expect(linesIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 })).toBe(true)
  })
})

describe("circle intersections", () => {
  it("a segment through a circle crosses it twice, a tangent once, a miss none", () => {
    const through = intersectLineSegmentCircle({ x: -20, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }, 10)
    expect(through).toHaveLength(2)
    expect(intersectLineSegmentCircle({ x: -20, y: 10 }, { x: 20, y: 10 }, { x: 0, y: 0 }, 10)).toHaveLength(1)
    expect(intersectLineSegmentCircle({ x: -20, y: 50 }, { x: 20, y: 50 }, { x: 0, y: 0 }, 10)).toBeNull()
    // A segment entirely inside crosses nowhere.
    expect(intersectLineSegmentCircle({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 10)).toBeNull()
  })

  it("two circles cross twice, touch once, or miss", () => {
    expect(intersectCircleCircle({ x: 0, y: 0 }, 10, { x: 10, y: 0 }, 10)).toHaveLength(2)
    expect(intersectCircleCircle({ x: 0, y: 0 }, 10, { x: 20, y: 0 }, 10)).toHaveLength(1)
    expect(intersectCircleCircle({ x: 0, y: 0 }, 10, { x: 100, y: 0 }, 10)).toHaveLength(0)
    // One inside the other never crosses.
    expect(intersectCircleCircle({ x: 0, y: 0 }, 10, { x: 0, y: 0 }, 3)).toHaveLength(0)
  })

  it("a circle crossing a polygon and a polyline", () => {
    // A circle centred on a corner of the square crosses two of its edges.
    expect(intersectCirclePolygon({ x: 0, y: 0 }, 10, SQUARE)).toHaveLength(2)
    // The same points, but an open polyline is missing the closing edge.
    const open = intersectCirclePolyline({ x: 0, y: 0 }, 10, SQUARE)
    expect(open).toHaveLength(1)
  })
})

describe("polygon intersections", () => {
  it("a segment crossing a polygon and a polyline", () => {
    expect(intersectLineSegmentPolygon({ x: -10, y: 50 }, { x: 200, y: 50 }, SQUARE)).toHaveLength(2)
    expect(intersectLineSegmentPolygon({ x: 200, y: 200 }, { x: 300, y: 300 }, SQUARE)).toBeNull()
    expect(intersectLineSegmentPolyline({ x: -10, y: 50 }, { x: 200, y: 50 }, SQUARE)).toHaveLength(1)
  })

  it("intersectPolygonBounds crosses a box's edges", () => {
    const triangle = [
      { x: 50, y: -50 },
      { x: 150, y: 50 },
      { x: 50, y: 50 },
    ]
    expect(intersectPolygonBounds(triangle, new Box(0, 0, 100, 100))).not.toBeNull()
    expect(intersectPolygonBounds(triangle, new Box(500, 500, 10, 10))).toBeNull()
  })

  it("intersectPolygonPolygon clips one convex polygon by the other", () => {
    const other = new Box(50, 50, 100, 100).corners
    const region = intersectPolygonPolygon(SQUARE, other)!
    expect(region).not.toBeNull()
    const clipped = Box.FromPoints(region)
    expect(clipped.toJson()).toEqual({ x: 50, y: 50, w: 50, h: 50 })
    expect(intersectPolygonPolygon(SQUARE, new Box(500, 500, 10, 10).corners)).toBeNull()
  })

  it("polygonsIntersect sees containment as well as crossing", () => {
    expect(polygonsIntersect(SQUARE, new Box(50, 50, 100, 100).corners)).toBe(true)
    // Fully contained: no edge crosses, but they do overlap.
    expect(polygonsIntersect(SQUARE, new Box(10, 10, 10, 10).corners)).toBe(true)
    expect(polygonsIntersect(SQUARE, new Box(500, 500, 10, 10).corners)).toBe(false)
  })

  it("polygonIntersectsPolyline sees a polyline that never leaves the polygon", () => {
    expect(
      polygonIntersectsPolyline(SQUARE, [
        { x: -10, y: 50 },
        { x: 200, y: 50 },
      ]),
    ).toBe(true)
    expect(
      polygonIntersectsPolyline(SQUARE, [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]),
    ).toBe(true)
    expect(
      polygonIntersectsPolyline(SQUARE, [
        { x: 500, y: 500 },
        { x: 600, y: 600 },
      ]),
    ).toBe(false)
  })

  it("pointInPolygon", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 500, y: 50 }, SQUARE)).toBe(false)
  })
})
