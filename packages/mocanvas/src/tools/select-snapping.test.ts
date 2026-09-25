import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createStore, Editor, loadEngineSync, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import { defaultBindingUtils } from "../bindings"
import { defaultShapeUtils, type GeoShape } from "../shapes"
import { defaultTools } from "./index"

/**
 * What the grid does, and what asks for shape snapping.
 *
 * Both measured against tldraw 5.4.2 on the same gestures. mocanvas snapped to
 * other shapes whenever the accelerator was *not* held — the opposite of
 * tldraw's rule — and ignored grid mode entirely, so "Show grid" changed
 * nothing about where a drag landed.
 */
const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type Mods = { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1200, h: 900 })
  return editor
}

function pointer(editor: Editor, name: "pointer_down" | "pointer_move" | "pointer_up", x: number, y: number, mods: Mods = {}, target: "canvas" | "shape" | "selection" = "canvas", extra: Record<string, unknown> = {}): void {
  editor.dispatch({
    type: "pointer",
    name,
    point: { x, y },
    pointerId: 1,
    button: 0,
    isPen: false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: false,
    accelKey: false,
    target,
    ...extra,
  } as never)
}

/** Press inside a shape, drag by (dx, dy) in page units, release. */
function dragShape(editor: Editor, shape: UnknownShape, from: [number, number], dx: number, dy: number, mods: Mods = {}): void {
  pointer(editor, "pointer_down", from[0], from[1], mods, "shape", { shape })
  pointer(editor, "pointer_move", from[0] + dx / 2, from[1] + dy / 2, mods)
  pointer(editor, "pointer_move", from[0] + dx, from[1] + dy, mods)
  pointer(editor, "pointer_up", from[0] + dx, from[1] + dy, mods)
}

function geo(editor: Editor, x: number, y: number, w = 100, h = 100): GeoShape {
  const before = new Set(editor.getCurrentPageShapes().map((s) => s.id))
  editor.createShape({ type: "geo", x, y, props: { geo: "rectangle", w, h, fill: "solid" } } as never)
  return editor.getCurrentPageShapes().find((s) => !before.has(s.id)) as GeoShape
}

describe("grid mode", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
    editor.updateInstanceState({ isGridMode: true })
  })

  it("moves in grid steps", () => {
    // tldraw: x 20 dragged by 37 lands on 60, not 57.
    const shape = geo(editor, 20, 20)
    editor.select(shape.id)
    dragShape(editor, editor.getShape(shape.id)!, [40, 40], 37, 0)
    expect(editor.getShape(shape.id)!.x).toBe(60)
  })

  it("leaves the axis a shift-drag locked alone", () => {
    const shape = geo(editor, 23, 23)
    editor.select(shape.id)
    dragShape(editor, editor.getShape(shape.id)!, [40, 40], 37, 2, { shiftKey: true })
    // x snapped, y untouched — including its off-grid start.
    expect(editor.getShape(shape.id)!.x).toBe(60)
    expect(editor.getShape(shape.id)!.y).toBe(23)
  })

  it("does nothing while the grid is off", () => {
    editor.updateInstanceState({ isGridMode: false })
    const shape = geo(editor, 20, 20)
    editor.select(shape.id)
    dragShape(editor, editor.getShape(shape.id)!, [40, 40], 37, 0)
    expect(editor.getShape(shape.id)!.x).toBeCloseTo(57)
  })

  it("resizes in grid steps, from the handle's own edge", () => {
    // tldraw: a 150x100 dragged by 51.2 / 38.4 at the bottom-right corner
    // becomes 200x140.
    const shape = geo(editor, 0, 0, 150, 100)
    editor.select(shape.id)
    pointer(editor, "pointer_down", 150, 100, {}, "selection", { handle: "bottom_right" })
    pointer(editor, "pointer_move", 175, 120)
    pointer(editor, "pointer_move", 201.2, 138.4)
    pointer(editor, "pointer_up", 201.2, 138.4)
    const after = editor.getShape<GeoShape>(shape.id)!
    expect(after.props.w).toBe(200)
    expect(after.props.h).toBe(140)
  })

  it("leaves the edge the handle does not drag where it was", () => {
    const shape = geo(editor, 0, 0, 150, 100)
    editor.select(shape.id)
    pointer(editor, "pointer_down", 150, 50, {}, "selection", { handle: "right" })
    pointer(editor, "pointer_move", 180, 50)
    pointer(editor, "pointer_move", 201.2, 50)
    pointer(editor, "pointer_up", 201.2, 50)
    const after = editor.getShape<GeoShape>(shape.id)!
    expect(after.props.w).toBe(200)
    expect(after.props.h).toBe(100)
  })
})

describe("what asks for shape snapping", () => {
  let editor: Editor
  let anchor: ShapeId

  beforeEach(() => {
    editor = makeEditor()
    // The grid is on by default in mocanvas; this is about the other snapping.
    editor.updateInstanceState({ isGridMode: false })
    // A shape whose right edge sits at 155, to line up with.
    anchor = geo(editor, 55, 300, 100, 100).id
  })

  /** Drag a 100-wide shape from x=20 by 37: 57 unsnapped, 55 snapped to the anchor. */
  function dragAndRead(mods: Mods): number {
    const shape = geo(editor, 20, 300)
    editor.select(shape.id)
    dragShape(editor, editor.getShape(shape.id)!, [40, 340], 37, 0, mods)
    const x = editor.getShape(shape.id)!.x
    editor.deleteShapes([shape.id])
    return x
  }

  it("is the accelerator, not the absence of it", () => {
    expect(editor.getShape(anchor)).toBeDefined()
    expect(dragAndRead({})).toBeCloseTo(57)
    expect(dragAndRead({ ctrlKey: true })).toBe(55)
  })

  it("is turned around by the always-snap preference", () => {
    editor.user.updateUserPreferences({ isSnapMode: true })
    expect(dragAndRead({})).toBe(55)
    expect(dragAndRead({ ctrlKey: true })).toBeCloseTo(57)
  })
})
