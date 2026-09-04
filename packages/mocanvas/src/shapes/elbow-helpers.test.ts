import { describe, expect, it } from "vitest"
import { Vec } from "@mocanvas/editor"
import { getDominantAxis, getElbowBody, getElbowMidPointFromPoint, getElbowRoute, roundElbowCorners } from "./elbow-helpers"
import { getBodyLength, getPointOnBody, getTangentOnBody, shortenBody } from "./arrow-helpers"

const S = { x: 0, y: 0 }

/** Every leg of a rounded route is axis-aligned, apart from the corner fillets. */
function expectAxisAlignedApartFromFillets(points: Vec[], radius: number): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    const axisAligned = dx < 1e-9 || dy < 1e-9
    // A fillet chord is diagonal, but never longer than the corner's radius.
    if (!axisAligned) expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(radius + 1e-9)
  }
}

describe("elbow routing", () => {
  it("picks the dominant axis from the terminals' relative position", () => {
    expect(getDominantAxis(S, { x: 200, y: 50 })).toBe("x")
    expect(getDominantAxis(S, { x: -200, y: 50 })).toBe("x")
    expect(getDominantAxis(S, { x: 50, y: 200 })).toBe("y")
    expect(getDominantAxis(S, { x: 50, y: -200 })).toBe("y")
  })

  it("routes three legs through a middle leg on the dominant axis", () => {
    const route = getElbowRoute(S, { x: 200, y: 80 }, { midPoint: 0.5 })
    expect(route.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 80],
      [200, 80],
    ])
    expect(route.slideAxis).toBe("x")
    expect(route.midLeg).not.toBeNull()
  })

  it("routes a vertical dominant axis as V-H-V", () => {
    const route = getElbowRoute(S, { x: 80, y: 200 }, { midPoint: 0.25 })
    expect(route.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 50],
      [80, 50],
      [80, 200],
    ])
    expect(route.slideAxis).toBe("y")
  })

  it("collapses to two legs at the extremes of elbowMidPoint", () => {
    const near = getElbowRoute(S, { x: 200, y: 80 }, { midPoint: 0 })
    expect(near.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 80],
      [200, 80],
    ])
    const far = getElbowRoute(S, { x: 200, y: 80 }, { midPoint: 1 })
    expect(far.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [200, 0],
      [200, 80],
    ])
    // The middle leg is still there to be dragged back off the extreme.
    expect(near.slideAxis).toBe("x")
    expect(far.slideAxis).toBe("x")
  })

  it("makes an L when the two ends route on different axes", () => {
    const l = getElbowRoute(S, { x: 200, y: 80 }, { startAxis: "x", endAxis: "y" })
    expect(l.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [200, 0],
      [200, 80],
    ])
    expect(l.midLeg).toBeNull()
    expect(l.slideAxis).toBeNull()
    const other = getElbowRoute(S, { x: 200, y: 80 }, { startAxis: "y", endAxis: "x" })
    expect(other.corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 80],
      [200, 80],
    ])
  })

  it("is a single straight run when the terminals share a coordinate", () => {
    expect(getElbowRoute(S, { x: 200, y: 0 }).corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [200, 0],
    ])
    expect(getElbowRoute(S, { x: 0, y: 200 }).corners.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 200],
    ])
    expect(getElbowRoute(S, { x: 200, y: 0 }).slideAxis).toBeNull()
  })

  it("clamps elbowMidPoint to 0..1", () => {
    expect(getElbowRoute(S, { x: 200, y: 80 }, { midPoint: -3 }).corners[1]!.x).toBe(0)
    expect(getElbowRoute(S, { x: 200, y: 80 }, { midPoint: 7 }).corners[1]!.x).toBe(200)
  })

  it("moves the middle leg monotonically with elbowMidPoint", () => {
    const at = (t: number): number => getElbowRoute(S, { x: 200, y: 80 }, { midPoint: t }).midLeg![0]!.x
    expect(at(0.2)).toBeCloseTo(40)
    expect(at(0.5)).toBeCloseTo(100)
    expect(at(0.8)).toBeCloseTo(160)
    expect(at(0.2)).toBeLessThan(at(0.5))
    expect(at(0.5)).toBeLessThan(at(0.8))
    // And backwards, for an arrow that runs right to left.
    const back = (t: number): number => getElbowRoute({ x: 200, y: 0 }, { x: 0, y: 80 }, { midPoint: t }).midLeg![0]!.x
    expect(back(0.2)).toBeCloseTo(160)
    expect(back(0.8)).toBeCloseTo(40)
    expect(back(0.2)).toBeGreaterThan(back(0.8))
  })
})

describe("elbow corners", () => {
  it("rounds each corner and leaves the legs axis-aligned", () => {
    const route = getElbowRoute(S, { x: 200, y: 80 }, { midPoint: 0.5, cornerRadius: 10 })
    expect(route.points.length).toBeGreaterThan(route.corners.length)
    expectAxisAlignedApartFromFillets(route.points, 10)
    expect(route.points[0]).toEqual(new Vec(0, 0))
    expect(route.points.at(-1)).toEqual(new Vec(200, 80))
    // No point strays outside the box the sharp route spans.
    for (const p of route.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(200 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeLessThanOrEqual(80 + 1e-9)
    }
  })

  it("clamps the radius to half of the shorter adjacent leg", () => {
    // The middle leg is 8 long, so the fillet can only eat 4 of it.
    const route = getElbowRoute(S, { x: 200, y: 8 }, { midPoint: 0.5, cornerRadius: 40 })
    const corner = route.corners[1]!
    const entering = route.points.find((p) => Math.abs(p.y) < 1e-9 && p.x > 0 && p.x < corner.x)!
    expect(corner.x - entering.x).toBeCloseTo(4)
    expectAxisAlignedApartFromFillets(route.points, 4)
  })

  it("leaves a route with no interior corner alone", () => {
    const straight = [new Vec(0, 0), new Vec(100, 0)]
    expect(roundElbowCorners(straight, 12).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [100, 0],
    ])
  })
})

describe("elbow body", () => {
  const body = getElbowBody(S, { x: 200, y: 80 }, { midPoint: 0.5 })

  it("measures and walks by arc length", () => {
    expect(getBodyLength(body)).toBeCloseTo(280)
    expect(getPointOnBody(body, 0)).toEqual(new Vec(0, 0))
    expect(getPointOnBody(body, 1)).toEqual(new Vec(200, 80))
    const half = getPointOnBody(body, 0.5)
    expect(half.x).toBeCloseTo(100)
    expect(half.y).toBeCloseTo(40)
  })

  it("takes its tangent from the leg it is on", () => {
    expect(getTangentOnBody(body, 0)).toEqual(new Vec(1, 0))
    expect(getTangentOnBody(body, 0.5)).toEqual(new Vec(0, 1))
    expect(getTangentOnBody(body, 1)).toEqual(new Vec(1, 0))
  })

  it("shortens from either end along the route", () => {
    const short = shortenBody(body, 20, 30)
    expect(getBodyLength(short)).toBeCloseTo(230)
    expect(getPointOnBody(short, 0).x).toBeCloseTo(20)
    expect(getPointOnBody(short, 1).x).toBeCloseTo(170)
  })
})

describe("midpoint handle", () => {
  it("reads elbowMidPoint off the dragged point, clamped", () => {
    expect(getElbowMidPointFromPoint(S, { x: 200, y: 80 }, { x: 50, y: 40 }, "x")).toBeCloseTo(0.25)
    expect(getElbowMidPointFromPoint(S, { x: 200, y: 80 }, { x: -60, y: 40 }, "x")).toBe(0)
    expect(getElbowMidPointFromPoint(S, { x: 200, y: 80 }, { x: 900, y: 40 }, "x")).toBe(1)
    expect(getElbowMidPointFromPoint(S, { x: 80, y: 200 }, { x: 40, y: 150 }, "y")).toBeCloseTo(0.75)
    // A zero-length span has no meaningful position; the middle is as good as any.
    expect(getElbowMidPointFromPoint(S, { x: 0, y: 80 }, { x: 30, y: 40 }, "x")).toBe(0.5)
  })
})
