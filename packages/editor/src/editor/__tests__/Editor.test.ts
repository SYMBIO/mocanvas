import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode, type StateNodeConstructor } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number; color: number }>

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  getDefaultProps() {
    return { w: 100, h: 100, color: 0xff0000ff }
  }
  getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  indicator() {
    return null
  }
  override getRenderStyle(shape: BoxShape): StyleWords {
    return { fill: shape.props.color, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class Idle extends StateNode {
  static override id = "idle"
  entered = 0
  override onEnter() {
    this.entered++
  }
}
class TestTool extends StateNode {
  static override id = "test"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle]
}
class OtherTool extends StateNode {
  static override id = "other"
}

function makeEditor() {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil],
    tools: [TestTool, OtherTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

describe("Editor", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("boots with a document, a page, instance state and a tool", () => {
    expect(editor.getPages()).toHaveLength(1)
    expect(editor.getCurrentPage().name).toBe("Page 1")
    expect(editor.getCurrentToolId()).toBe("test")
    expect(editor.getPath()).toBe("root.test.idle")
    expect(editor.isIn("test.idle")).toBe(true)
    expect(editor.getCamera()).toMatchObject({ x: 0, y: 0, z: 1 })
  })

  it("creates shapes, mirrors them to the engine and hit tests through it", () => {
    editor.createShapes<BoxShape>([
      { type: "box", x: 0, y: 0 },
      { type: "box", x: 200, y: 0, props: { w: 50, h: 50 } },
    ])
    expect(editor.getCurrentPageShapes()).toHaveLength(2)
    expect(editor.engine.shapeCount).toBe(2)
    const hit = editor.getShapeAtPoint({ x: 225, y: 25 }, { hitInside: true })
    expect(hit?.x).toBe(200)
    expect(editor.getShapeAtPoint({ x: 500, y: 500 })).toBeUndefined()
    expect(editor.getShapesInsideBounds({ x: -10, y: -10, w: 300, h: 300 })).toHaveLength(2)
    expect(editor.getShapesInsideBounds({ x: -10, y: -10, w: 120, h: 120 })).toHaveLength(1)
    expect(editor.getShapePageBounds(editor.getCurrentPageShapes()[1]!)?.toJson()).toEqual({ x: 200, y: 0, w: 50, h: 50 })
  })

  it("updates, deletes and keeps the engine in sync", () => {
    editor.createShape<BoxShape>({ type: "box", x: 0, y: 0 })
    const shape = editor.getCurrentPageShapes()[0]!
    editor.updateShape<BoxShape>({ id: shape.id, type: "box", x: 1000, y: 1000 })
    expect(editor.getShapeAtPoint({ x: 50, y: 50 }, { hitInside: true })).toBeUndefined()
    expect(editor.getShapeAtPoint({ x: 1050, y: 1050 }, { hitInside: true })?.id).toBe(shape.id)
    editor.select(shape.id)
    editor.deleteShapes([shape.id])
    expect(editor.engine.shapeCount).toBe(0)
    expect(editor.getSelectedShapeIds()).toEqual([])
  })

  it("undo and redo restore shapes in the store and the engine", () => {
    editor.markHistoryStoppingPoint()
    editor.createShape<BoxShape>({ type: "box", x: 10, y: 10 })
    editor.markHistoryStoppingPoint()
    const id = editor.getCurrentPageShapes()[0]!.id
    editor.updateShape<BoxShape>({ id, type: "box", x: 500 })
    expect(editor.getCanUndo()).toBe(true)
    editor.undo()
    expect(editor.getShape(id)?.x).toBe(10)
    expect(editor.getShapeAtPoint({ x: 50, y: 50 }, { hitInside: true })?.id).toBe(id)
    editor.undo()
    expect(editor.getShape(id)).toBeUndefined()
    expect(editor.engine.shapeCount).toBe(0)
    editor.redo()
    expect(editor.getShape(id)?.x).toBe(10)
    editor.redo()
    expect(editor.getShape(id)?.x).toBe(500)
    expect(editor.engine.shapeCount).toBe(1)
  })

  it("bailToMark drops the work since the mark", () => {
    editor.createShape<BoxShape>({ type: "box" })
    const mark = editor.markHistoryStoppingPoint("drag")
    const id = editor.getCurrentPageShapes()[0]!.id
    editor.updateShape<BoxShape>({ id, type: "box", x: 99 })
    editor.bailToMark(mark)
    expect(editor.getShape(id)?.x).toBe(0)
    expect(editor.getCanRedo()).toBe(false)
  })

  it("camera math round-trips and zooms about a point", () => {
    editor.setCamera({ x: -100, y: 50, z: 2 })
    const page = editor.screenToPage({ x: 400, y: 140 })
    expect(page.x).toBeCloseTo(300)
    expect(page.y).toBeCloseTo(20)
    expect(editor.pageToScreen(page)).toMatchObject({ x: 400, y: 140 })
    const before = editor.screenToPage({ x: 300, y: 300 })
    editor.zoomToPointAt({ x: 300, y: 300 }, 4)
    const after = editor.screenToPage({ x: 300, y: 300 })
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(editor.getZoomLevel()).toBe(4)
    editor.createShape<BoxShape>({ type: "box", x: 0, y: 0, props: { w: 500, h: 250 } })
    editor.zoomToFit()
    const vp = editor.getViewportPageBounds()
    expect(vp.x).toBeLessThanOrEqual(0)
    expect(vp.maxX).toBeGreaterThanOrEqual(500)
  })

  it("z-order operations reorder siblings", () => {
    editor.createShapes<BoxShape>([{ type: "box" }, { type: "box" }, { type: "box" }])
    const [a, b, c] = editor.getCurrentPageShapesSorted().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]
    editor.bringToFront([a])
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual([b, c, a])
    editor.sendToBack([a])
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual([a, b, c])
    editor.bringForward([a])
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual([b, a, c])
    editor.sendBackward([c])
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual([b, c, a])
    // topmost wins the hit test
    const top = editor.getShapeAtPoint({ x: 50, y: 50 }, { hitInside: true })
    expect(top?.id).toBe(a)
  })

  it("pages: switching re-syncs the engine", () => {
    editor.createShape<BoxShape>({ type: "box" })
    editor.createPage({ name: "Second" })
    const second = editor.getPages()[1]!
    editor.setCurrentPage(second.id)
    expect(editor.engine.shapeCount).toBe(0)
    editor.createShape<BoxShape>({ type: "box", x: 5 })
    expect(editor.engine.shapeCount).toBe(1)
    editor.setCurrentPage(editor.getPages()[0]!.id)
    expect(editor.engine.shapeCount).toBe(1)
    expect(editor.getCurrentPageShapes()[0]!.x).toBe(0)
  })

  it("tools transition and receive events", () => {
    editor.setCurrentTool("other")
    expect(editor.getCurrentToolId()).toBe("other")
    editor.setCurrentTool("test")
    const idle = editor.getStateDescendant<Idle>("test.idle")!
    expect(idle.entered).toBe(2)
    editor.dispatch({
      type: "pointer",
      name: "pointer_down",
      point: { x: 10, y: 20 },
      pointerId: 1,
      button: 0,
      isPen: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
      target: "canvas",
    })
    expect(editor.inputs.isPointing).toBe(true)
    expect(editor.inputs.originPagePoint).toMatchObject({ x: 10, y: 20 })
  })

  it("renders a frame headlessly", () => {
    editor.createShapes<BoxShape>([{ type: "box" }, { type: "box", x: 5000 }])
    let drawn = 0
    const backend = {
      kind: "webgl2" as const,
      resize() {},
      draw(frame: { drawn: number }) {
        drawn = frame.drawn
      },
      dispose() {},
    }
    editor.renderFrame(backend)
    expect(drawn).toBe(1)
    expect(editor.getLastFrameStats().culled).toBe(1)
  })
})

describe("Editor clipboard and duplication", () => {
  it("duplicates shapes with offset and keeps them selectable", () => {
    const editor = makeEditor()
    editor.createShapes<BoxShape>([{ type: "box", x: 10, y: 10 }, { type: "box", x: 200, y: 10 }])
    const ids = editor.getCurrentPageShapes().map((s) => s.id)
    const copies = editor.duplicateShapes(ids, { x: 30, y: 40 })
    expect(copies).toHaveLength(2)
    expect(editor.getCurrentPageShapes()).toHaveLength(4)
    const c0 = editor.getShape(copies[0]!)!
    expect(c0.x).toBe(40)
    expect(c0.y).toBe(50)
    expect(editor.engine.shapeCount).toBe(4)
  })

  it("round-trips content through getContent / putContent", () => {
    const editor = makeEditor()
    editor.createShapes<BoxShape>([{ type: "box", x: 0, y: 0 }, { type: "box", x: 100, y: 0, props: { w: 50, h: 50 } }])
    const ids = editor.getCurrentPageShapes().map((s) => s.id)
    const content = editor.getContentFromCurrentPage(ids)!
    expect(content.shapes).toHaveLength(2)
    const json = JSON.parse(JSON.stringify(content))
    const created = editor.putContentOntoCurrentPage(json, { point: { x: 1000, y: 1000 } })
    expect(created).toHaveLength(2)
    expect(editor.getSelectedShapeIds()).toEqual(created)
    const bounds = editor.getSelectionPageBounds()!
    expect(bounds.center.x).toBeCloseTo(1000)
    expect(bounds.center.y).toBeCloseTo(1000)
  })

  it("snaps a moving box to a neighbour edge", () => {
    const editor = makeEditor()
    editor.createShapes<BoxShape>([{ type: "box", x: 0, y: 0 }, { type: "box", x: 300, y: 300 }])
    const [a, b] = editor.getCurrentPageShapes()
    const moving = { x: 296, y: 500, w: 100, h: 100 }
    const res = editor.snaps.snapTranslate(moving, new Set([a!.id]))
    expect(res.nudge.x).toBeCloseTo(4)
    expect(res.nudge.y).toBe(0)
    expect(res.lines.length).toBeGreaterThan(0)
    expect(editor.snaps.getLines().length).toBe(res.lines.length)
    void b
  })
})

describe("Editor bulk transforms", () => {
  function three() {
    const editor = makeEditor()
    editor.createShapes<BoxShape>([
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 100, y: 30, props: { w: 50, h: 50 } },
      { type: "box", x: 300, y: 60, props: { w: 50, h: 50 } },
    ])
    return { editor, ids: editor.getCurrentPageShapes().map((s) => s.id) }
  }

  it("nudges and rotates", () => {
    const { editor, ids } = three()
    editor.nudgeShapes(ids, { x: 5, y: -5 })
    expect(editor.getShape(ids[0]!)!.x).toBe(5)
    expect(editor.getShape(ids[0]!)!.y).toBe(-5)
    editor.rotateShapesBy([ids[0]!], Math.PI / 2)
    const s = editor.getShape(ids[0]!)!
    expect(s.rotation).toBeCloseTo(Math.PI / 2)
    // bounds stay centered on the same point
    const b = editor.getShapePageBounds(s)!
    expect(b.center.x).toBeCloseTo(30)
    expect(b.center.y).toBeCloseTo(20)
  })

  it("aligns, distributes, stacks and flips", () => {
    const { editor, ids } = three()
    editor.alignShapes(ids, "top")
    expect(ids.map((id) => editor.getShape(id)!.y)).toEqual([0, 0, 0])
    editor.distributeShapes(ids, "horizontal")
    expect(editor.getShape(ids[1]!)!.x).toBe(150)
    editor.stackShapes(ids, "horizontal", 10)
    expect(ids.map((id) => editor.getShape(id)!.x)).toEqual([0, 60, 120])
    editor.flipShapes(ids, "horizontal")
    expect(ids.map((id) => editor.getShape(id)!.x)).toEqual([120, 60, 0])
    editor.toggleLock(ids)
    expect(editor.getShape(ids[0]!)!.isLocked).toBe(true)
  })
})
