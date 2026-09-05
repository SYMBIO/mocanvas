import { describe, expect, it } from "vitest"
import { Group2d, Mat, PATH_OP } from "@mocanvas/editor"
import { PathBuilder } from "./PathBuilder"
import { PathBuilderGeometry2d } from "./PathBuilderGeometry2d"

/** The rounded-rectangle from the custom-geo-type docs, at a known size. */
function roundedRect(w: number, h: number, r: number): PathBuilder {
  return new PathBuilder()
    .moveTo(r, 0, { geometry: { isFilled: true } })
    .lineTo(w - r, 0)
    .circularArcTo(r, false, true, w, r)
    .lineTo(w, h - r)
    .circularArcTo(r, false, true, w - r, h)
    .lineTo(r, h)
    .circularArcTo(r, false, true, 0, h - r)
    .lineTo(0, r)
    .circularArcTo(r, false, true, r, 0)
    .close()
}

describe("PathBuilder", () => {
  it("writes a d that starts with a move and ends closed", () => {
    const d = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close().toD()
    expect(d).toBe("M0,0L10,0L10,10Z")
  })

  it("turns an arc into cubics that land on the requested endpoint", () => {
    const d = new PathBuilder().moveTo(0, 10).circularArcTo(10, false, true, 10, 0).toD()
    expect(d.startsWith("M0,10C")).toBe(true)
    expect(d.endsWith("10,0")).toBe(true)
  })

  it("gives one geometry per run and groups several", () => {
    const single = new PathBuilder().moveTo(0, 0).lineTo(10, 10).toGeometry()
    expect(single).toBeInstanceOf(PathBuilderGeometry2d)

    const two = new PathBuilder().moveTo(0, 0).lineTo(1, 1).moveTo(5, 5).lineTo(6, 6).toGeometry()
    expect(two).toBeInstanceOf(Group2d)
    expect((two as Group2d).children).toHaveLength(2)
  })

  it("skips runs whose geometry is disabled", () => {
    const geometry = new PathBuilder().moveTo(0, 0, { geometry: false }).lineTo(10, 0).moveTo(0, 5).lineTo(10, 5).toGeometry()
    expect(geometry).toBeInstanceOf(PathBuilderGeometry2d)
  })

  it("reports a closed run as closed", () => {
    const geometry = roundedRect(100, 60, 10).toGeometry() as PathBuilderGeometry2d
    expect(geometry.isClosed).toBe(true)
    expect(geometry.isFilled).toBe(true)
    expect(geometry.bounds.w).toBeCloseTo(100, 1)
    expect(geometry.bounds.h).toBeCloseTo(60, 1)
  })

  it("emits path words the flat encoding understands", () => {
    const words = (new PathBuilder().moveTo(0, 0).lineTo(4, 0).close().toGeometry() as PathBuilderGeometry2d).toPathWords()
    expect(words[0]).toBe(PATH_OP.MOVE)
    expect(words).toContain(PATH_OP.LINE)
    expect(words[words.length - 1]).toBe(PATH_OP.CLOSE)
  })

  it("splits a run into one geometry per segment", () => {
    const geometry = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).toGeometry() as PathBuilderGeometry2d
    expect(geometry.getSegments()).toHaveLength(2)
  })

  it("transforms every point, control points included", () => {
    const moved = new PathBuilder().moveTo(0, 0).cubicBezierTo(10, 10, 2, 0, 8, 10).transform(Mat.Translate(5, 5))
    expect(moved.toD()).toBe("M5,5C7,5 13,15 15,15")
  })

  it("turns an arc into cubics when transformed, keeping the endpoint", () => {
    const scaled = new PathBuilder().moveTo(0, 10).circularArcTo(10, false, true, 10, 0).transform(Mat.Scale(2, 1))
    expect(scaled.commands.every((c) => c.type !== "arc")).toBe(true)
    expect(scaled.toD().endsWith("20,0")).toBe(true)
  })

  it("draws the same outline every time from the same seed", () => {
    const path = roundedRect(100, 60, 10)
    expect(path.toDrawD({ randomSeed: "abc" })).toBe(path.toDrawD({ randomSeed: "abc" }))
    expect(path.toDrawD({ randomSeed: "abc" })).not.toBe(path.toDrawD({ randomSeed: "xyz" }))
  })

  it("writes more passes as more subpaths", () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 0)
    const one = path.toDrawD({ randomSeed: "s", passes: 1 })
    const two = path.toDrawD({ randomSeed: "s", passes: 2 })
    expect(two.split("M")).toHaveLength(3)
    expect(one.split("M")).toHaveLength(2)
  })

  it("filters to filled runs when asked", () => {
    const path = new PathBuilder()
      .moveTo(0, 0, { geometry: { isFilled: true } })
      .lineTo(10, 0)
      .moveTo(0, 5, { geometry: { isFilled: false } })
      .lineTo(10, 5)
    expect(path.toD({ onlyFilled: true })).toBe("M0,0L10,0")
    expect(path.toD()).toBe("M0,0L10,0 M0,5L10,5")
  })

  it("builds a straight path through points, trimmed at both ends", () => {
    const path = PathBuilder.lineThroughPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], { endOffsets: 2 })
    expect(path.toD()).toBe("M2,0L8,0")
  })

  it("builds a spline that starts and ends on the given points", () => {
    const path = PathBuilder.cubicSplineThroughPoints([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ])
    const geometry = path.toGeometry()
    expect(geometry.vertices[0]!.x).toBeCloseTo(0)
    expect(geometry.vertices[geometry.vertices.length - 1]!.x).toBeCloseTo(20)
  })

  it("renders nothing for an empty path", () => {
    expect(new PathBuilder().toSvg({ style: "solid", strokeWidth: 2 })).toBeNull()
  })

  it("renders a dashed style as a dash array", () => {
    const element = new PathBuilder().moveTo(0, 0).lineTo(10, 0).toSvg({ style: "dashed", strokeWidth: 2 })
    expect(element?.props.strokeDasharray).toBeTruthy()
  })

  it("drops the dash array when solid is forced", () => {
    const element = new PathBuilder().moveTo(0, 0).lineTo(10, 0).toSvg({ style: "dashed", strokeWidth: 2, forceSolid: true })
    expect(element?.props.strokeDasharray).toBeUndefined()
  })
})
