import { describe, expect, it } from "vitest"
import { Box } from "@mocanvas/editor"
import { getElbowRoute } from "./elbow-helpers"
import {
  DEFAULT_ELBOW_ARROW_OPTIONS,
  getElbowArrowBoxEdges,
  getElbowArrowBoxes,
  getElbowArrowInfo,
  getElbowArrowSideAxis,
  getElbowArrowSideTowards,
  getElbowArrowTargetBox,
  isInElbowArrowRange,
  toElbowArrowRoute,
} from "./elbow-arrow-types"

const box = (x: number, y: number, w: number, h: number): Box => Box.FromMinMax(x, y, x + w, y + h)

describe("elbow arrow box edges", () => {
  const edges = getElbowArrowBoxEdges(box(0, 0, 100, 50))

  it("puts each side at its own coordinate", () => {
    expect(edges.top!.value).toBe(0)
    expect(edges.bottom!.value).toBe(50)
    expect(edges.left!.value).toBe(0)
    expect(edges.right!.value).toBe(100)
  })

  it("expands a side outwards, never inwards", () => {
    const d = DEFAULT_ELBOW_ARROW_OPTIONS.expandDistance
    expect(edges.top!.expanded).toBe(-d)
    expect(edges.bottom!.expanded).toBe(50 + d)
    expect(edges.left!.expanded).toBe(-d)
    expect(edges.right!.expanded).toBe(100 + d)
  })

  it("aims at the centre of a side by default", () => {
    expect(edges.top!.crossTarget).toBe(50)
    expect(edges.left!.crossTarget).toBe(25)
  })

  it("keeps the attachment point off the corners", () => {
    const pulled = getElbowArrowBoxEdges(box(0, 0, 100, 50), { x: -500, y: -500 })
    // 15% of 100 in from the left, not 0.
    expect(pulled.top!.crossTarget).toBeCloseTo(15)
    expect(pulled.left!.crossTarget).toBeCloseTo(7.5)
  })

  it("reports a span each way round", () => {
    expect(isInElbowArrowRange(edges.top!.cross, 60)).toBe(true)
    expect(isInElbowArrowRange(edges.top!.cross, 160)).toBe(false)
  })
})

describe("elbow arrow sides", () => {
  it("names the axis a leg on each side runs along", () => {
    expect(getElbowArrowSideAxis("left")).toBe("x")
    expect(getElbowArrowSideAxis("top")).toBe("y")
  })

  it("picks the side a point sits off, by the larger overshoot", () => {
    const b = box(0, 0, 100, 100)
    expect(getElbowArrowSideTowards(b, { x: 300, y: 50 })).toBe("right")
    expect(getElbowArrowSideTowards(b, { x: 50, y: -300 })).toBe("top")
    expect(getElbowArrowSideTowards(b, { x: -300, y: 50 })).toBe("left")
    expect(getElbowArrowSideTowards(b, { x: 50, y: 300 })).toBe("bottom")
  })

  it("has no side for a point inside the box", () => {
    expect(getElbowArrowSideTowards(box(0, 0, 100, 100), { x: 50, y: 50 })).toBeNull()
  })
})

describe("target boxes", () => {
  it("turns a free terminal into a zero-sized box with no attachable sides", () => {
    const target = getElbowArrowTargetBox({ x: 10, y: 20 })
    expect(target.isPoint).toBe(true)
    expect(target.original.width).toBe(0)
    expect(target.edges).toEqual({ top: null, right: null, bottom: null, left: null })
    expect(target.target).toMatchObject({ x: 10, y: 20 })
  })

  it("aims a bound terminal at its anchor rather than at the centre", () => {
    const target = getElbowArrowTargetBox(box(0, 0, 100, 100), DEFAULT_ELBOW_ARROW_OPTIONS, { target: { x: 90, y: 10 } })
    expect(target.isPoint).toBe(false)
    expect(target.target).toMatchObject({ x: 90, y: 10 })
  })

  it("unions the two ends into the region the route lives in", () => {
    const boxes = getElbowArrowBoxes(getElbowArrowTargetBox(box(0, 0, 10, 10)), getElbowArrowTargetBox(box(100, 100, 10, 10)))
    expect(boxes.common.original.maxX).toBe(110)
    expect(boxes.common.original.minY).toBe(0)
  })
})

describe("routes", () => {
  it("names a two-leg route by its legs and a straight one by neither", () => {
    const l = toElbowArrowRoute(getElbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, { startAxis: "x", endAxis: "y" }))
    expect(l.name).toBe("hv")
    const straight = toElbowArrowRoute(getElbowRoute({ x: 0, y: 0 }, { x: 100, y: 0 }))
    expect(straight.name).toBe("straight")
  })

  it("measures the un-filleted length", () => {
    const route = toElbowArrowRoute(getElbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, { startAxis: "x", endAxis: "y" }))
    expect(route.distance).toBeCloseTo(160)
  })

  it("offers a midpoint handle only where there is a middle leg to slide", () => {
    const three = toElbowArrowRoute(getElbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, { startAxis: "x", endAxis: "x" }))
    expect(three.midpointHandle).not.toBeNull()
    expect(three.midpointHandle!.axis).toBe("x")
    expect(three.midpointHandle!.point.x).toBeCloseTo(50)
    const two = toElbowArrowRoute(getElbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, { startAxis: "x", endAxis: "y" }))
    expect(two.midpointHandle).toBeNull()
  })
})

describe("getElbowArrowInfo", () => {
  const A = getElbowArrowTargetBox(box(0, 0, 100, 100))
  const B = getElbowArrowTargetBox(box(300, 200, 100, 100))

  it("reports the clear gap between the two expanded boxes", () => {
    const info = getElbowArrowInfo(A, B)
    const d = DEFAULT_ELBOW_ARROW_OPTIONS.expandDistance
    expect(info.gapX).toBeCloseTo(200 - 2 * d)
    expect(info.gapY).toBeCloseTo(100 - 2 * d)
  })

  it("offers a middle-leg coordinate only on an axis the boxes are clear on", () => {
    const info = getElbowArrowInfo(A, B)
    expect(info.midX).not.toBeNull()
    const overlapping = getElbowArrowInfo(A, getElbowArrowTargetBox(box(10, 400, 100, 100)))
    expect(overlapping.midX).toBeNull()
    expect(overlapping.midY).not.toBeNull()
  })

  it("routes out of the side of A that faces B", () => {
    const info = getElbowArrowInfo(A, B)
    expect(info.route!.aEdge).toBe("right")
    expect(info.route!.bEdge).toBe("left")
    expect(info.route!.points.length).toBeGreaterThan(2)
  })

  it("has no route at all when the two ends coincide", () => {
    const point = getElbowArrowTargetBox({ x: 5, y: 5 })
    expect(getElbowArrowInfo(point, getElbowArrowTargetBox({ x: 5, y: 5 })).route).toBeNull()
  })

  it("carries the options it routed with, so a caller can re-derive the same answer", () => {
    expect(getElbowArrowInfo(A, B).options).toBe(DEFAULT_ELBOW_ARROW_OPTIONS)
  })
})
