import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createShapeId, createStore, Editor, loadEngineSync, StateNode, type ShapeId } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "./index"
import { getArrowInfo } from "./arrow-info"
import { clearArrowTargetState, getArrowTargetState, updateArrowTargetState } from "./arrow-target"
import type { ArrowShape } from "../shapes/ArrowShapeUtil"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function makeArrow(editor: Editor, props: Partial<ArrowShape["props"]> = {}): ShapeId {
  const id = createShapeId()
  editor.createShape({ id, type: "arrow", x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, ...props } } as never)
  return id
}

describe("getArrowInfo", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("returns undefined for a shape that is not an arrow", () => {
    const id = createShapeId()
    editor.createShape({ id, type: "geo", x: 0, y: 0, props: { w: 10, h: 10 } } as never)
    expect(getArrowInfo(editor, id)).toBeUndefined()
  })

  it("resolves a plain arrow as straight", () => {
    const info = getArrowInfo(editor, makeArrow(editor))!
    expect(info.type).toBe("straight")
    if (info.type !== "straight") return
    expect(info.start.handle.x).toBeCloseTo(0)
    expect(info.end.handle.x).toBeCloseTo(200)
    expect(info.middle.x).toBeCloseTo(100)
    expect(info.length).toBeGreaterThan(0)
    expect(info.isValid).toBe(true)
  })

  it("resolves a bent arrow as an arc", () => {
    const info = getArrowInfo(editor, makeArrow(editor, { kind: "arc", bend: 40 }))!
    expect(info.type).toBe("arc")
    if (info.type !== "arc") return
    expect(info.bodyArc.radius).toBeGreaterThan(0)
    expect(info.handleArc.radius).toBeGreaterThan(0)
    // The bow puts the middle off the chord, which is the whole point of a bend.
    expect(Math.abs(info.middle.y)).toBeGreaterThan(1)
  })

  it("resolves an elbow arrow as a route", () => {
    const info = getArrowInfo(editor, makeArrow(editor, { kind: "elbow", end: { x: 200, y: 150 } }))!
    expect(info.type).toBe("elbow")
    if (info.type !== "elbow") return
    expect(info.route.points.length).toBeGreaterThan(1)
    expect(info.route.corners.length).toBeGreaterThan(0)
  })

  it("pulls the body back from the handle to make room for an arrowhead", () => {
    const info = getArrowInfo(editor, makeArrow(editor, { arrowheadEnd: "arrow" }))!
    if (info.type !== "straight") throw new Error("expected a straight arrow")
    expect(info.end.point.x).toBeLessThanOrEqual(info.end.handle.x)
  })

  it("reports a degenerate arrow as invalid", () => {
    const info = getArrowInfo(editor, makeArrow(editor, { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }))!
    expect(info.isValid).toBe(false)
  })

  it("accepts a shape record as well as an id", () => {
    const id = makeArrow(editor)
    const shape = editor.getShape<ArrowShape>(id)!
    expect(getArrowInfo(editor, shape)?.type).toBe(getArrowInfo(editor, id)?.type)
  })
})

describe("arrow target state", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("starts out empty", () => {
    expect(getArrowTargetState(editor)).toBeNull()
  })

  it("is null over empty canvas", () => {
    const result = updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: false,
      pointInPageSpace: { x: 900, y: 700 },
    })
    expect(result).toBeNull()
    expect(getArrowTargetState(editor)).toBeNull()
  })

  it("finds a shape under the pointer and publishes it", () => {
    const target = createShapeId()
    editor.createShape({ id: target, type: "geo", x: 0, y: 0, props: { w: 100, h: 100, fill: "solid" } } as never)

    const result = updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: false,
      pointInPageSpace: { x: 50, y: 50 },
    })

    expect(result?.target.id).toBe(target)
    expect(getArrowTargetState(editor)?.target.id).toBe(target)
    expect(result?.isExact).toBe(true)
    // Not precise: the anchor snaps to the centre.
    expect(result?.anchorInPageSpace.x).toBeCloseTo(50)
    expect(result?.normalizedAnchor.x).toBeCloseTo(0.5)
  })

  it("keeps the exact anchor when precise", () => {
    const target = createShapeId()
    editor.createShape({ id: target, type: "geo", x: 0, y: 0, props: { w: 100, h: 100, fill: "solid" } } as never)
    const result = updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: true,
      pointInPageSpace: { x: 20, y: 80 },
    })
    expect(result?.anchorInPageSpace.x).toBeCloseTo(20)
    expect(result?.anchorInPageSpace.y).toBeCloseTo(80)
  })

  it("offers all four side handles by default", () => {
    const target = createShapeId()
    editor.createShape({ id: target, type: "geo", x: 0, y: 0, props: { w: 100, h: 100, fill: "solid" } } as never)
    const result = updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: false,
      pointInPageSpace: { x: 50, y: 50 },
    })!
    expect(Object.values(result.handlesInPageSpace).every((handle) => handle.isEnabled)).toBe(true)
    expect(result.handlesInPageSpace.top.point.y).toBeCloseTo(0)
    expect(result.handlesInPageSpace.bottom.point.y).toBeCloseTo(100)
  })

  it("clears back to null", () => {
    const target = createShapeId()
    editor.createShape({ id: target, type: "geo", x: 0, y: 0, props: { w: 100, h: 100, fill: "solid" } } as never)
    updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: false,
      pointInPageSpace: { x: 50, y: 50 },
    })
    clearArrowTargetState(editor)
    expect(getArrowTargetState(editor)).toBeNull()
  })

  it("keeps two editors' states apart", () => {
    const other = makeEditor()
    const target = createShapeId()
    editor.createShape({ id: target, type: "geo", x: 0, y: 0, props: { w: 100, h: 100, fill: "solid" } } as never)
    updateArrowTargetState({
      editor,
      arrow: undefined,
      currentBinding: undefined,
      oppositeBinding: undefined,
      isPrecise: false,
      pointInPageSpace: { x: 50, y: 50 },
    })
    expect(getArrowTargetState(editor)).not.toBeNull()
    expect(getArrowTargetState(other)).toBeNull()
  })
})
