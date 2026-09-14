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

/**
 * A submenu opens beside the row that owns it, not underneath it.
 *
 * Underneath is what the chrome did, and it has two costs: the parent menu's
 * remaining rows are pushed out of the way, and the panel grows towards the
 * bottom of the screen — so the longest submenu, which is the one most likely
 * to need the room, is the one that runs out of it.
 */
describe("placeNear, beside the anchor", () => {
  // A menu row: 190 wide, 28 tall, in a panel near the top-left.
  const row = rect(12, 200, 190, 28)

  it("opens to the right of the row", () => {
    const p = placeNear(row, { width: 200, height: 300 }, "side", VW, VH)
    expect(p.left).toBe(210) // row.right + gap
  })

  it("aligns its top with the row it belongs to", () => {
    const p = placeNear(row, { width: 200, height: 300 }, "side", VW, VH)
    expect(p.top).toBe(200)
  })

  it("flips to the left when the right would run off the screen", () => {
    const nearEdge = rect(780, 200, 190, 28)
    const p = placeNear(nearEdge, { width: 200, height: 300 }, "side", VW, VH)
    // Left of the row rather than clamped against the right edge, which would
    // sit the submenu on top of its own parent.
    expect(p.left).toBe(572)
  })

  it("slides up rather than off the bottom when the submenu is long", () => {
    const lowRow = rect(12, 600, 190, 28)
    const p = placeNear(lowRow, { width: 200, height: 400 }, "side", VW, VH)
    expect(p.top).toBe(VH - 400 - 8)
    expect(p.top + 400).toBeLessThanOrEqual(VH)
  })

  it("keeps a submenu taller than the screen at the top edge", () => {
    const p = placeNear(row, { width: 200, height: 900 }, "side", VW, VH)
    expect(p.top).toBe(8)
  })
})
