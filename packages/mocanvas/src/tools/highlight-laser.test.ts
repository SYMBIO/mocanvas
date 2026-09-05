import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createStore, Editor, loadEngineSync } from "@mocanvas/editor"
import { defaultBindingUtils } from "../bindings"
import { defaultShapeUtils, type HighlightShape } from "../shapes"
import { defaultTools } from "./index"
import { LaserTool } from "./LaserTool"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function pointer(editor: Editor, name: "pointer_down" | "pointer_move" | "pointer_up", x: number, y: number): void {
  editor.dispatch({
    type: "pointer",
    name,
    point: { x, y },
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
}

function drag(editor: Editor, from: [number, number], ...through: [number, number][]): void {
  pointer(editor, "pointer_down", from[0], from[1])
  for (const [x, y] of through) pointer(editor, "pointer_move", x, y)
  const last = through.at(-1) ?? from
  pointer(editor, "pointer_up", last[0], last[1])
}

describe("HighlightShapeTool", () => {
  it("lays down one highlight shape per stroke, finished on pen up", () => {
    const editor = makeEditor()
    editor.setCurrentTool("highlight")
    drag(editor, [10, 10], [40, 12], [80, 14])
    const shapes = editor.getCurrentPageShapes()
    expect(shapes).toHaveLength(1)
    const shape = shapes[0] as HighlightShape
    expect(shape.type).toBe("highlight")
    expect(shape.props.isComplete).toBe(true)
    expect(shape.props.segments[0]!.points.length).toBeGreaterThan(1)
  })

  it("never closes a stroke, however near the start it ends", () => {
    const editor = makeEditor()
    editor.setCurrentTool("highlight")
    drag(editor, [10, 10], [40, 40], [11, 11])
    const shape = editor.getCurrentPageShapes()[0] as HighlightShape
    // A highlight has no `isClosed` at all — that is the difference from draw.
    expect("isClosed" in shape.props).toBe(false)
  })

  it("undoes the whole stroke as one", () => {
    const editor = makeEditor()
    editor.setCurrentTool("highlight")
    drag(editor, [10, 10], [40, 12], [80, 14])
    editor.undo()
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})

describe("LaserTool", () => {
  it("draws a scribble and creates nothing", () => {
    const editor = makeEditor()
    editor.setCurrentTool("laser")
    pointer(editor, "pointer_down", 10, 10)
    pointer(editor, "pointer_move", 60, 30)
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    expect(editor.scribbles.getItems().length).toBe(1)
  })

  it("reports the live session's id, and stops reporting one when the stroke ends", () => {
    const editor = makeEditor()
    editor.setCurrentTool("laser")
    const tool = editor.root.getCurrent() as LaserTool
    expect(tool.getSessionId()).toBeNull()
    pointer(editor, "pointer_down", 10, 10)
    expect(tool.getSessionId()).not.toBeNull()
    pointer(editor, "pointer_up", 10, 10)
    expect(tool.getSessionId()).toBeNull()
  })

  it("lets the trail fade rather than clearing it on pen up", () => {
    const editor = makeEditor()
    editor.setCurrentTool("laser")
    drag(editor, [10, 10], [60, 30])
    // Still present, in its fading state — the end of a sweep is the part
    // people are pointing at.
    expect(editor.scribbles.getItems()[0]?.scribble.state).toBe("stopping")
  })
})
