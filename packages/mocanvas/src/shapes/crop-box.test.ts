import { describe, expect, it } from "vitest"
import type { TLCropInfo } from "@mocanvas/editor"
import { getCropBox } from "./crop-box"
import type { ImageShape } from "./ImageShapeUtil"

function shape(overrides: Partial<ImageShape["props"]> = {}): ImageShape {
  return {
    id: "shape:crop" as ImageShape["id"],
    typeName: "shape",
    type: "image",
    x: 100,
    y: 100,
    rotation: 0,
    index: "a1",
    parentId: "page:p" as ImageShape["parentId"],
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      w: 200,
      h: 100,
      assetId: null,
      playing: true,
      url: "",
      crop: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } },
      flipX: false,
      flipY: false,
      altText: "",
      ...overrides,
    },
  } as ImageShape
}

function info(handle: TLCropInfo<ImageShape>["handle"], change: { x: number; y: number }, s = shape()): TLCropInfo<ImageShape> {
  return { handle, change, crop: s.props.crop!, uncroppedSize: { w: s.props.w, h: s.props.h }, initialShape: s }
}

describe("getCropBox", () => {
  it("crops from the right without moving the shape", () => {
    const s = shape()
    const next = getCropBox(s, info("right", { x: -50, y: 0 }, s))!
    expect(next.x).toBe(100)
    expect(next.props!.crop).toEqual({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.75, y: 1 } })
    expect(next.props!.w).toBe(150)
  })

  it("crops from the left by moving the shape as well", () => {
    const s = shape()
    const next = getCropBox(s, info("left", { x: 50, y: 0 }, s))!
    expect(next.x).toBe(150)
    expect(next.props!.crop!.topLeft.x).toBeCloseTo(0.25)
    expect(next.props!.w).toBe(150)
  })

  it("moves both axes for a corner handle", () => {
    const s = shape()
    const next = getCropBox(s, info("top_left", { x: 20, y: 10 }, s))!
    expect(next.x).toBe(120)
    expect(next.y).toBe(110)
    expect(next.props!.w).toBe(180)
    expect(next.props!.h).toBe(90)
  })

  it("never crops past the far edge, or past the minimum size", () => {
    const s = shape()
    const next = getCropBox(s, info("right", { x: -1000, y: 0 }, s), { minWidth: 40 })!
    expect(next.props!.w).toBe(40)
    expect(next.props!.crop!.bottomRight.x).toBeCloseTo(0.2)
  })

  it("stays inside the source: a drag outwards cannot widen the window past 1", () => {
    const s = shape()
    const next = getCropBox(s, info("right", { x: 500, y: 0 }, s))!
    expect(next.props!.crop!.bottomRight.x).toBe(1)
  })

  it("crops relative to the whole source, not the visible part", () => {
    // Already showing the left half: the shape's 200 units are half of a 400
    // unit source, so a 100 unit drag is a quarter of the source, not a half.
    const s = shape({ crop: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 1 } } })
    const next = getCropBox(s, info("right", { x: -100, y: 0 }, s))!
    expect(next.props!.crop!.bottomRight.x).toBeCloseTo(0.25)
  })

  it("keeps a circular crop circular", () => {
    const s = shape({ crop: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 }, isCircle: true } })
    expect(getCropBox(s, info("right", { x: -20, y: 0 }, s))!.props!.crop!.isCircle).toBe(true)
  })

  it("reports nothing for a handle that does not crop", () => {
    expect(getCropBox(shape(), info("rotate", { x: 10, y: 10 }))).toBeUndefined()
  })
})
