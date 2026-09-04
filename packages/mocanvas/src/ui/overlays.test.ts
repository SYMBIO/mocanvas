import { describe, expect, it } from "vitest"
import { placeNear } from "./overlays"

const VW = 1000
const VH = 700
const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect

describe("placeNear", () => {
  it("centres the box on the anchor and sits above it", () => {
    const p = placeNear(rect(500, 400, 40, 40), { width: 100, height: 22 }, "above", VW, VH)
    expect(p.left).toBe(470)
    expect(p.top).toBe(370)
  })

  it("keeps a box off the left edge instead of running past it", () => {
    // The leftmost zoom-bar button: a centred tooltip would start at -15.
    const p = placeNear(rect(16, 640, 40, 40), { width: 100, height: 22 }, "above", VW, VH)
    expect(p.left).toBe(8)
  })

  it("keeps a box off the right edge", () => {
    const p = placeNear(rect(950, 640, 40, 40), { width: 200, height: 22 }, "above", VW, VH)
    expect(p.left).toBe(VW - 200 - 8)
  })

  it("flips below when there is no room above", () => {
    const p = placeNear(rect(500, 10, 40, 40), { width: 100, height: 22 }, "above", VW, VH)
    expect(p.top).toBe(58)
  })

  it("flips above when there is no room below", () => {
    const p = placeNear(rect(500, 650, 40, 40), { width: 100, height: 180 }, "below", VW, VH)
    expect(p.top).toBe(650 - 180 - 8)
  })

  it("clamps a box taller than the viewport to the top edge", () => {
    const p = placeNear(rect(500, 300, 40, 40), { width: 100, height: 900 }, "below", VW, VH)
    expect(p.top).toBe(8)
  })
})
