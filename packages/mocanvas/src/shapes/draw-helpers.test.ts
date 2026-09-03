import { describe, expect, it } from "vitest"
import { smoothPoints } from "./draw-helpers"

describe("smoothPoints", () => {
  it("returns a copy unchanged for fewer than four points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 9 },
      { x: 10, y: 0 },
    ]
    const out = smoothPoints(pts)
    expect(out).toEqual(pts)
    expect(out).not.toBe(pts)
  })

  it("keeps endpoints and point count, preserves extra fields", () => {
    const pts = [
      { x: 0, y: 0, z: 0.1 },
      { x: 10, y: 20, z: 0.2 },
      { x: 20, y: -20, z: 0.3 },
      { x: 30, y: 20, z: 0.4 },
      { x: 40, y: 0, z: 0.5 },
    ]
    const out = smoothPoints(pts)
    expect(out).toHaveLength(5)
    expect(out[0]).toEqual(pts[0])
    expect(out[4]).toEqual(pts[4])
    expect(out[2]!.z).toBe(0.3)
  })

  it("reduces zig-zag amplitude", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: i % 2 === 0 ? 10 : -10 }))
    const out = smoothPoints(pts)
    const amp = (arr: { y: number }[]) => Math.max(...arr.slice(1, -1).map((p) => Math.abs(p.y)))
    expect(amp(out)).toBeLessThan(amp(pts))
    expect(amp(out)).toBeCloseTo(0)
  })

  it("leaves straight runs in place", () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: i * 3, y: i * 3 }))
    for (const [i, p] of smoothPoints(pts).entries()) {
      expect(p.x).toBeCloseTo(i * 3)
      expect(p.y).toBeCloseTo(i * 3)
    }
  })
})
