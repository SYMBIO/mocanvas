import { describe, expect, it } from "vitest"
import { b64Vecs, Box } from "@mocanvas/editor"
import { getPointsFromDrawSegment, getPointsFromDrawSegments } from "./draw-segments"
import { getStroke, getStrokeOutlinePoints, getStrokePoints, getSvgPathFromStrokePoints } from "./getStroke"

const line = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 40, y: 0 },
  { x: 60, y: 0 },
]

describe("getStrokePoints", () => {
  it("returns nothing for no input", () => {
    expect(getStrokePoints([])).toEqual([])
  })

  it("keeps a single tap as one point", () => {
    const points = getStrokePoints([{ x: 5, y: 5 }])
    expect(points).toHaveLength(1)
    expect(points[0]!.runningLength).toBe(0)
  })

  it("accumulates running length along the stroke", () => {
    const points = getStrokePoints(line, { streamline: 0 })
    expect(points.length).toBeGreaterThan(1)
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.runningLength).toBeGreaterThanOrEqual(points[i - 1]!.runningLength)
    }
  })

  it("pulls points towards the previous one as streamline rises", () => {
    const loose = getStrokePoints(line, { streamline: 0 })
    const tight = getStrokePoints(line, { streamline: 1 })
    expect(tight[1]!.point.x).toBeLessThan(loose[1]!.point.x)
  })

  it("uses reported pressure when simulation is off", () => {
    const points = getStrokePoints([{ x: 0, y: 0, z: 0.9 } as never, { x: 10, y: 0, z: 0.2 } as never], { simulatePressure: false })
    expect(points[0]!.pressure).toBeCloseTo(0.9)
    expect(points[1]!.pressure).toBeCloseTo(0.2)
  })

  it("gives every point the same radius when thinning is off", () => {
    const points = getStrokePoints(line, { thinning: 0, size: 10 })
    for (const point of points) expect(point.radius).toBe(5)
  })
})

describe("getStrokeOutlinePoints", () => {
  it("returns a ring around a single point", () => {
    const outline = getStrokeOutlinePoints(getStrokePoints([{ x: 0, y: 0 }], { size: 10, thinning: 0 }))
    expect(outline.length).toBeGreaterThan(8)
    const bounds = Box.FromPoints(outline)
    expect(bounds.w).toBeCloseTo(10, 0)
  })

  it("surrounds the input on both sides", () => {
    const outline = getStroke(line, { size: 10, thinning: 0, streamline: 0 })
    const bounds = Box.FromPoints(outline)
    expect(bounds.h).toBeGreaterThan(8)
    expect(bounds.w).toBeGreaterThan(50)
  })

  it("narrows a tapered end", () => {
    const points = getStrokePoints(line, { size: 20, thinning: 0, streamline: 0 })
    const tapered = getStrokeOutlinePoints(points, { size: 20, thinning: 0, end: { taper: true } })
    const plain = getStrokeOutlinePoints(points, { size: 20, thinning: 0 })
    expect(Box.FromPoints(tapered).h).toBeLessThanOrEqual(Box.FromPoints(plain).h)
  })
})

describe("getSvgPathFromStrokePoints", () => {
  it("is empty for no points", () => {
    expect(getSvgPathFromStrokePoints([])).toBe("")
  })

  it("writes quadratic curves between the samples", () => {
    const d = getSvgPathFromStrokePoints(getStrokePoints(line, { streamline: 0 }))
    expect(d.startsWith("M")).toBe(true)
    expect(d).toContain("Q")
  })

  it("closes the path when asked", () => {
    expect(getSvgPathFromStrokePoints(getStrokePoints(line), true).endsWith("Z")).toBe(true)
  })
})

describe("getPointsFromDrawSegments", () => {
  const segment = {
    type: "free" as const,
    points: b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.5 },
      { x: 10, y: 5, z: 0.7 },
    ]),
  }

  it("decodes a packed segment and keeps pressure", () => {
    const points = getPointsFromDrawSegment(segment, 1, 1)
    expect(points).toHaveLength(2)
    expect(points[1]!.x).toBeCloseTo(10)
    expect(points[1]!.z).toBeCloseTo(0.7)
  })

  it("scales x and y but not pressure", () => {
    const points = getPointsFromDrawSegment(segment, 2, 3)
    expect(points[1]!.x).toBeCloseTo(20)
    expect(points[1]!.y).toBeCloseTo(15)
    expect(points[1]!.z).toBeCloseTo(0.7)
  })

  it("appends into a shared array across segments", () => {
    const points = getPointsFromDrawSegments([segment, segment])
    expect(points).toHaveLength(4)
    expect(points[1]!.x).toBeCloseTo(10)
    expect(points[2]!.x).toBeCloseTo(0)
  })

  it("drops a repeated point where two segments meet", () => {
    const joined = { ...segment, points: b64Vecs.encodePoints([{ x: 10, y: 5, z: 0.7 }, { x: 20, y: 5, z: 0.7 }]) }
    expect(getPointsFromDrawSegments([segment, joined])).toHaveLength(3)
  })
})
