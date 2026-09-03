import { describe, expect, it } from "vitest"
import { Vec } from "@mocanvas/editor"
import { arcToCubicSegments, catmullRomToBezier, lineSegment, pointOnCubic } from "./spline-helpers"

describe("catmullRomToBezier", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 50, y: 40 },
    { x: 100, y: 0 },
    { x: 150, y: 40 },
  ]

  it("produces n-1 segments that pass through every point", () => {
    const segs = catmullRomToBezier(pts)
    expect(segs).toHaveLength(3)
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i]!.p0).toEqual(pts[i])
      expect(segs[i]!.p1).toEqual(pts[i + 1])
    }
  })

  it("is C1 continuous at interior points", () => {
    const segs = catmullRomToBezier(pts)
    for (let i = 0; i < segs.length - 1; i++) {
      const outgoing = Vec.Sub(segs[i + 1]!.c1, segs[i + 1]!.p0)
      const incoming = Vec.Sub(segs[i]!.p1, segs[i]!.c2)
      expect(outgoing.x).toBeCloseTo(incoming.x, 9)
      expect(outgoing.y).toBeCloseTo(incoming.y, 9)
    }
  })

  it("keeps collinear input on the line", () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i * 10, y: i * 5 }))
    for (const s of catmullRomToBezier(line)) {
      for (const p of [s.c1, s.c2]) expect(p.y).toBeCloseTo(p.x / 2, 9)
    }
  })

  it("closed splines wrap around", () => {
    const segs = catmullRomToBezier(pts, true)
    expect(segs).toHaveLength(4)
    expect(segs[3]!.p1).toEqual(pts[0])
  })

  it("handles degenerate input", () => {
    expect(catmullRomToBezier([])).toEqual([])
    expect(catmullRomToBezier([{ x: 1, y: 1 }])).toEqual([])
    expect(catmullRomToBezier([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toHaveLength(1)
  })
})

describe("arcToCubicSegments", () => {
  it("endpoints lie on the circle and chain together", () => {
    const c = { x: 10, y: 20 }
    const segs = arcToCubicSegments(c, 50, -Math.PI / 2, Math.PI, 2)
    expect(segs).toHaveLength(2)
    expect(segs[0]!.p0.x).toBeCloseTo(10)
    expect(segs[0]!.p0.y).toBeCloseTo(-30)
    expect(segs[1]!.p1.x).toBeCloseTo(10)
    expect(segs[1]!.p1.y).toBeCloseTo(70)
    expect(segs[0]!.p1).toEqual(segs[1]!.p0)
    expect(segs[0]!.p1.x).toBeCloseTo(60) // passes through angle 0
  })

  it("stays within 0.1% of the radius along quarter arcs in both directions", () => {
    const c = { x: 0, y: 0 }
    for (const sweep of [Math.PI, -Math.PI, Math.PI / 3, -1.2]) {
      for (const s of arcToCubicSegments(c, 100, 0.3, sweep, 2)) {
        for (let t = 0; t <= 1; t += 0.1) {
          const p = pointOnCubic(s, t)
          expect(Math.abs(Vec.Len(p) - 100)).toBeLessThan(0.1)
        }
      }
    }
  })

  it("a full circle in four pieces closes on itself", () => {
    const segs = arcToCubicSegments({ x: 5, y: 5 }, 3, 0, Math.PI * 2, 4)
    expect(segs).toHaveLength(4)
    expect(segs[3]!.p1.x).toBeCloseTo(segs[0]!.p0.x)
    expect(segs[3]!.p1.y).toBeCloseTo(segs[0]!.p0.y)
  })
})

describe("lineSegment", () => {
  it("places control points on the line", () => {
    const s = lineSegment({ x: 0, y: 0 }, { x: 30, y: 90 })
    expect(s.c1).toEqual({ x: 10, y: 30 })
    expect(s.c2).toEqual({ x: 20, y: 60 })
    expect(pointOnCubic(s, 0.5).x).toBeCloseTo(15)
  })
})
