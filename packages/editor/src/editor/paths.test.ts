import { describe, expect, it } from "vitest"
import { getPerfectDashProps, getSvgPathFromPoints } from "./paths"

describe("getSvgPathFromPoints", () => {
  it("returns nothing for no points", () => {
    expect(getSvgPathFromPoints([])).toBe("")
  })

  it("draws a dot for a single point", () => {
    expect(getSvgPathFromPoints([{ x: 1, y: 2 }])).toBe("M1,2L1,2")
  })

  it("closes with Z rather than repeating the first point", () => {
    const d = getSvgPathFromPoints([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    expect(d).toBe("M0,0L10,0L10,10Z")
  })

  it("leaves an open path open", () => {
    const d = getSvgPathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    )
    expect(d).toBe("M0,0L10,0")
  })

  it("rounds away float dust", () => {
    expect(getSvgPathFromPoints([{ x: 0.1 + 0.2, y: 0 }], false)).toBe("M0.3,0L0.3,0")
  })
})

describe("getPerfectDashProps", () => {
  it("is solid for a solid style", () => {
    expect(getPerfectDashProps(100, 2, { style: "solid" })).toEqual({ strokeDasharray: "none", strokeDashoffset: "none" })
  })

  it("is solid when forced, whatever the style", () => {
    expect(getPerfectDashProps(100, 2, { style: "dashed", forceSolid: true }).strokeDasharray).toBe("none")
  })

  it("is solid for a degenerate length", () => {
    expect(getPerfectDashProps(0, 2, { style: "dashed" }).strokeDasharray).toBe("none")
  })

  it("falls back to solid rather than drawing two dashes on a short line", () => {
    expect(getPerfectDashProps(4, 2, { style: "dashed" }).strokeDasharray).toBe("none")
  })

  it("divides a closed path into whole dashes", () => {
    const { strokeDasharray } = getPerfectDashProps(100, 2, { style: "dashed", closed: true })
    const [dash, gap] = strokeDasharray.split(" ").map(Number)
    const count = Math.round(100 / (dash! + gap!))
    expect(Math.abs(count * (dash! + gap!) - 100)).toBeLessThan(0.05)
  })

  it("honours snap so a rectangle's four sides match", () => {
    const { strokeDasharray } = getPerfectDashProps(400, 2, { style: "dashed", closed: true, snap: 4 })
    const [dash, gap] = strokeDasharray.split(" ").map(Number)
    expect(Math.round(400 / (dash! + gap!)) % 4).toBe(0)
  })

  it("offsets an outset start by half a dash", () => {
    const { strokeDasharray, strokeDashoffset } = getPerfectDashProps(100, 2, { style: "dashed", start: "outset" })
    const dash = Number(strokeDasharray.split(" ")[0])
    expect(Number(strokeDashoffset)).toBeCloseTo(-dash / 2, 1)
  })

  it("does not offset a closed path", () => {
    expect(getPerfectDashProps(100, 2, { style: "dashed", closed: true }).strokeDashoffset).toBe("0")
  })

  it("draws dots much shorter than dashes", () => {
    const dotted = Number(getPerfectDashProps(100, 2, { style: "dotted" }).strokeDasharray.split(" ")[0])
    const dashed = Number(getPerfectDashProps(100, 2, { style: "dashed" }).strokeDasharray.split(" ")[0])
    expect(dotted).toBeLessThan(dashed)
  })
})
