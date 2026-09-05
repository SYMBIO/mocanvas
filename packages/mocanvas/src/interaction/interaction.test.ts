import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createShapeId, createStore, Editor, loadEngineSync, StateNode, type ShapeId } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { centerSelectionAroundPoint, getHitShapeOnCanvasPointerDown } from "./pointer"
import { fitFrameToContent, removeFrame } from "./frames"
import { registerDefaultSideEffects } from "./side-effects"

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

function makeGeo(editor: Editor, x: number, y: number, w = 50, h = 50, parentId?: ShapeId): ShapeId {
  const id = createShapeId()
  editor.createShape({ id, type: "geo", x, y, props: { w, h, fill: "solid" }, ...(parentId ? { parentId } : {}) } as never)
  return id
}

describe("centerSelectionAroundPoint", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("moves the selection so its centre lands on the point", () => {
    const id = makeGeo(editor, 0, 0, 100, 100)
    editor.setSelectedShapes([id])
    centerSelectionAroundPoint(editor, { x: 500, y: 400 })
    const bounds = editor.getSelectionPageBounds()!
    expect(bounds.center.x).toBeCloseTo(500, 1)
    expect(bounds.center.y).toBeCloseTo(400, 1)
  })

  it("keeps several shapes' relative positions", () => {
    const a = makeGeo(editor, 0, 0)
    const b = makeGeo(editor, 200, 0)
    editor.setSelectedShapes([a, b])
    centerSelectionAroundPoint(editor, { x: 0, y: 0 })
    const gap = editor.getShape(b)!.x - editor.getShape(a)!.x
    expect(gap).toBeCloseTo(200, 1)
  })

  it("does nothing with an empty selection", () => {
    expect(() => centerSelectionAroundPoint(editor, { x: 10, y: 10 })).not.toThrow()
  })
})

describe("getHitShapeOnCanvasPointerDown", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("finds a filled shape the pointer is inside", () => {
    const id = makeGeo(editor, 0, 0, 100, 100)
    editor.dispatch({
      type: "pointer",
      name: "pointer_move",
      point: { x: 50, y: 50 },
      pointerId: 1,
      button: 0,
      isPen: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
      target: "canvas",
    } as never)
    expect(getHitShapeOnCanvasPointerDown(editor)?.id).toBe(id)
  })

  it("finds nothing over empty canvas", () => {
    makeGeo(editor, 0, 0, 20, 20)
    editor.dispatch({
      type: "pointer",
      name: "pointer_move",
      point: { x: 800, y: 700 },
      pointerId: 1,
      button: 0,
      isPen: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
      target: "canvas",
    } as never)
    expect(getHitShapeOnCanvasPointerDown(editor)).toBeUndefined()
  })
})

describe("fitFrameToContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("resizes the frame around its children without moving them", () => {
    const frameId = createShapeId()
    editor.createShape({ id: frameId, type: "frame", x: 0, y: 0, props: { w: 400, h: 400 } } as never)
    const childId = makeGeo(editor, 100, 100, 50, 50, frameId)
    const before = editor.getShapePageBounds(childId)!

    fitFrameToContent(editor, frameId, { padding: 10 })

    const after = editor.getShapePageBounds(childId)!
    expect(after.minX).toBeCloseTo(before.minX, 1)
    expect(after.minY).toBeCloseTo(before.minY, 1)
    const frame = editor.getShape(frameId)! as { props: { w: number; h: number } }
    expect(frame.props.w).toBeCloseTo(70, 1)
    expect(frame.props.h).toBeCloseTo(70, 1)
  })

  it("leaves an empty frame alone", () => {
    const frameId = createShapeId()
    editor.createShape({ id: frameId, type: "frame", x: 0, y: 0, props: { w: 400, h: 400 } } as never)
    fitFrameToContent(editor, frameId)
    expect((editor.getShape(frameId)! as { props: { w: number } }).props.w).toBe(400)
  })

  it("ignores a shape that is not frame-like", () => {
    const id = makeGeo(editor, 0, 0, 100, 100)
    expect(() => fitFrameToContent(editor, id)).not.toThrow()
    expect((editor.getShape(id)! as { props: { w: number } }).props.w).toBe(100)
  })
})

describe("removeFrame", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("deletes the frame and keeps its children", () => {
    const frameId = createShapeId()
    editor.createShape({ id: frameId, type: "frame", x: 0, y: 0, props: { w: 400, h: 400 } } as never)
    const childId = makeGeo(editor, 10, 10, 20, 20, frameId)

    removeFrame(editor, [frameId])

    expect(editor.getShape(frameId)).toBeUndefined()
    expect(editor.getShape(childId)).toBeDefined()
    expect(editor.getShape(childId)!.parentId).toBe(editor.getCurrentPageId())
  })

  it("ignores ids that are not frames", () => {
    const id = makeGeo(editor, 0, 0)
    removeFrame(editor, [id])
    expect(editor.getShape(id)).toBeDefined()
  })
})

describe("registerDefaultSideEffects", () => {
  it("returns a disposer that removes what it installed", () => {
    const editor = makeEditor()
    const dispose = registerDefaultSideEffects(editor)
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
    // Nothing should break once the handlers are gone.
    expect(() => makeGeo(editor, 0, 0)).not.toThrow()
  })
})
