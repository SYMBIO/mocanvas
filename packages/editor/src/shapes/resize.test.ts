import { describe, expect, it } from "vitest"
import { resizeBox, resizeScaled, type TLBaseBoxShape } from "./resize"
import type { ResizeInfo } from "./ShapeUtil"

type Box = TLBaseBoxShape & { props: { w: number; h: number; scale?: number } }

function box(props: { w: number; h: number; scale?: number }): Box {
  return {
    id: "shape:a" as Box["id"],
    typeName: "shape",
    type: "box",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as Box["index"],
    parentId: "page:a" as Box["parentId"],
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  } as unknown as Box
}

function info(shape: Box, over: Partial<ResizeInfo<Box>>): ResizeInfo<Box> {
  return {
    newPoint: { x: 0, y: 0 },
    handle: "bottom_right",
    mode: "resize_bounds",
    scaleX: 1,
    scaleY: 1,
    initialBounds: { x: 0, y: 0, w: shape.props.w, h: shape.props.h },
    initialShape: shape,
    ...over,
  }
}

describe("resizeBox", () => {
  it("scales the box", () => {
    const shape = box({ w: 100, h: 50 })
    const next = resizeBox(shape, info(shape, { scaleX: 2, scaleY: 3 }))
    expect(next.props).toMatchObject({ w: 200, h: 150 })
  })

  it("turns a negative scale into a flip, not a negative size", () => {
    const shape = box({ w: 100, h: 50 })
    const next = resizeBox(shape, info(shape, { scaleX: -1, scaleY: 1, newPoint: { x: -100, y: 0 } }))
    expect(next.props).toMatchObject({ w: 100, h: 50 })
    expect(next.x).toBe(0)
  })

  it("clamps to the caller's minimum", () => {
    const shape = box({ w: 100, h: 50 })
    const next = resizeBox(shape, info(shape, { scaleX: 0.01, scaleY: 0.01 }), { minWidth: 20, minHeight: 20 })
    expect(next.props).toMatchObject({ w: 20, h: 20 })
  })

  it("clamps to the caller's maximum", () => {
    const shape = box({ w: 100, h: 50 })
    const next = resizeBox(shape, info(shape, { scaleX: 10, scaleY: 10 }), { maxWidth: 300, maxHeight: 300 })
    expect(next.props).toMatchObject({ w: 300, h: 300 })
  })

  it("never produces a zero-size box by default", () => {
    const shape = box({ w: 100, h: 50 })
    const next = resizeBox(shape, info(shape, { scaleX: 0, scaleY: 0 }))
    expect(next.props).toMatchObject({ w: 1, h: 1 })
  })
})

describe("resizeScaled", () => {
  it("keeps the shape proportional using the smaller axis", () => {
    const shape = box({ w: 100, h: 100 })
    const next = resizeScaled(shape, info(shape, { scaleX: 3, scaleY: 2 }))
    expect(next.props).toMatchObject({ w: 200, h: 200 })
  })

  it("carries the shape's own scale prop along", () => {
    const shape = box({ w: 100, h: 100, scale: 2 })
    const next = resizeScaled(shape, info(shape, { scaleX: 0.5, scaleY: 0.5 }))
    expect(next.props).toMatchObject({ scale: 1 })
  })

  it("leaves a shape without a scale prop alone", () => {
    const shape = box({ w: 100, h: 100 })
    const next = resizeScaled(shape, info(shape, { scaleX: 2, scaleY: 2 }))
    expect(next.props).not.toHaveProperty("scale")
  })
})
