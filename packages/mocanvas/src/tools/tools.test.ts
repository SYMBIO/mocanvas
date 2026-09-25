import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createStore, Editor, loadEngineSync, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import { defaultBindingUtils, type ArrowBinding } from "../bindings"
import { defaultShapeUtils, getLinePoints, NoteShapeUtil, type ArrowShape, type FrameShape, type GeoShape, type LineShape } from "../shapes"
import { BaseBoxShapeTool, defaultShapeTools, defaultTools } from "./index"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

type PointerName = "pointer_down" | "pointer_move" | "pointer_up"

function pointer(editor: Editor, name: PointerName, x: number, y: number, mods: { altKey?: boolean; shiftKey?: boolean } = {}): void {
  editor.dispatch({
    type: "pointer",
    name,
    point: { x, y },
    pointerId: 1,
    button: 0,
    isPen: false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    accelKey: false,
    target: "canvas",
  })
}

/** Press, drag through the given points, release. */
function drag(editor: Editor, from: [number, number], ...through: [number, number][]): void {
  pointer(editor, "pointer_down", from[0], from[1])
  for (const [x, y] of through) pointer(editor, "pointer_move", x, y)
  const last = through.at(-1) ?? from
  pointer(editor, "pointer_up", last[0], last[1])
}

function click(editor: Editor, x: number, y: number): void {
  pointer(editor, "pointer_down", x, y)
  pointer(editor, "pointer_up", x, y)
}

function key(editor: Editor, k: string): void {
  editor.dispatch({
    type: "keyboard",
    name: "key_down",
    key: k,
    code: k,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    accelKey: false,
  })
}

function shapesOfType<T extends UnknownShape>(editor: Editor, type: T["type"]): T[] {
  // Read back as UnknownShape: the caller names the concrete type it wants,
  // which the registered union cannot be narrowed to generically.
  return (editor.getCurrentPageShapes() as UnknownShape[]).filter((s): s is T => s.type === type)
}

function createGeo(editor: Editor, x: number, y: number, w = 100, h = 100): GeoShape {
  editor.createShape<GeoShape>({ type: "geo", x, y, props: { w, h, geo: "rectangle" } })
  return editor.getCurrentPageShapes().at(-1) as GeoShape
}

describe("ArrowTool", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("is registered with the default tools", () => {
    expect(Object.keys(editor.root.children ?? {})).toEqual(expect.arrayContaining(["arrow", "line", "frame"]))
  })

  it("drags out an arrow and returns to the select tool", () => {
    editor.setCurrentTool("arrow")
    drag(editor, [100, 100], [200, 120], [300, 140])

    const arrows = shapesOfType<ArrowShape>(editor, "arrow")
    expect(arrows).toHaveLength(1)
    const arrow = arrows[0]!
    expect(arrow.x).toBe(100)
    expect(arrow.y).toBe(100)
    expect(arrow.props.start).toEqual({ x: 0, y: 0 })
    expect(arrow.props.end.x).toBeCloseTo(200, 6)
    expect(arrow.props.end.y).toBeCloseTo(40, 6)
    expect(editor.getSelectedShapeIds()).toEqual([arrow.id])
    expect(editor.getCurrentToolId()).toBe("select")
  })

  it("stays in the tool when it is locked", () => {
    editor.updateInstanceState({ isToolLocked: true })
    editor.setCurrentTool("arrow")
    drag(editor, [0, 0], [100, 0])
    expect(editor.getCurrentToolId()).toBe("arrow")
    expect(editor.getPath()).toBe("root.arrow.idle")
  })

  it("makes a default 100-unit arrow from a click without a drag", () => {
    editor.setCurrentTool("arrow")
    click(editor, 50, 60)

    const arrow = shapesOfType<ArrowShape>(editor, "arrow")[0]!
    expect(arrow.x).toBe(50)
    expect(arrow.y).toBe(60)
    expect(arrow.props.end).toEqual({ x: 100, y: 0 })
  })

  it("binds the end terminal when it lands on a shape", () => {
    const geo = createGeo(editor, 300, 50)
    editor.setCurrentTool("arrow")
    drag(editor, [100, 100], [250, 100], [350, 100])

    const arrow = shapesOfType<ArrowShape>(editor, "arrow")[0]!
    const bindings = editor.getBindingsFromShape<ArrowBinding>(arrow, "arrow")
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.toId).toBe(geo.id)
    expect(bindings[0]!.props.terminal).toBe("end")
    expect(bindings[0]!.props.isPrecise).toBe(false)
  })

  it("binds precisely while alt is held", () => {
    createGeo(editor, 300, 50)
    editor.setCurrentTool("arrow")
    pointer(editor, "pointer_down", 100, 100)
    pointer(editor, "pointer_move", 250, 100, { altKey: true })
    pointer(editor, "pointer_move", 330, 80, { altKey: true })
    pointer(editor, "pointer_up", 330, 80, { altKey: true })

    const arrow = shapesOfType<ArrowShape>(editor, "arrow")[0]!
    const binding = editor.getBindingsFromShape<ArrowBinding>(arrow, "arrow")[0]!
    expect(binding.props.isPrecise).toBe(true)
    expect(binding.props.normalizedAnchor).not.toEqual({ x: 0.5, y: 0.5 })
  })

  it("removes an arrow dragged to (almost) no length", () => {
    // Zoomed in, a drag past the screen-space drag threshold is still a tiny
    // distance on the page.
    editor.setCamera({ x: 0, y: 0, z: 8 })
    editor.setCurrentTool("arrow")
    drag(editor, [100, 100], [104, 100], [106, 100])

    expect(shapesOfType(editor, "arrow")).toHaveLength(0)
    expect(editor.getCanUndo()).toBe(false)
  })

  it("cancel removes the in-progress arrow and leaves history clean", () => {
    editor.setCurrentTool("arrow")
    pointer(editor, "pointer_down", 100, 100)
    pointer(editor, "pointer_move", 200, 100)
    expect(shapesOfType(editor, "arrow")).toHaveLength(1)

    editor.cancel()
    expect(shapesOfType(editor, "arrow")).toHaveLength(0)
    expect(editor.getCanUndo()).toBe(false)
    expect(editor.getPath()).toBe("root.arrow.idle")
  })
})

describe("LineTool", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("drags out a two-point line", () => {
    editor.setCurrentTool("line")
    drag(editor, [100, 100], [180, 140], [260, 180])

    const lines = shapesOfType<LineShape>(editor, "line")
    expect(lines).toHaveLength(1)
    const points = getLinePoints(lines[0]!)
    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[1]!.x).toBeCloseTo(160, 6)
    expect(points[1]!.y).toBeCloseTo(80, 6)
    expect(editor.getCurrentToolId()).toBe("select")
  })

  it("appends a point per click and finishes on Enter", () => {
    editor.setCurrentTool("line")
    click(editor, 100, 100)
    pointer(editor, "pointer_move", 200, 100)
    click(editor, 200, 100)
    pointer(editor, "pointer_move", 200, 200)
    click(editor, 200, 200)
    pointer(editor, "pointer_move", 300, 260)
    key(editor, "Enter")

    const line = shapesOfType<LineShape>(editor, "line")[0]!
    const points = getLinePoints(line)
    expect(points.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 160],
    ])
    expect(editor.getCurrentToolId()).toBe("select")
  })

  it("finishes on a double click without a trailing duplicate point", () => {
    editor.setCurrentTool("line")
    click(editor, 100, 100)
    pointer(editor, "pointer_move", 200, 100)
    click(editor, 200, 100)
    pointer(editor, "pointer_move", 200, 200)
    click(editor, 200, 200)
    // second click at the same spot: the finishing half of the double click
    click(editor, 200, 200)

    const line = shapesOfType<LineShape>(editor, "line")[0]!
    expect(getLinePoints(line)).toHaveLength(3)
    expect(editor.getCurrentToolId()).toBe("select")
  })

  it("cancel removes the in-progress line and leaves history clean", () => {
    editor.setCurrentTool("line")
    click(editor, 100, 100)
    pointer(editor, "pointer_move", 200, 140)
    expect(shapesOfType(editor, "line")).toHaveLength(1)

    editor.cancel()
    expect(shapesOfType(editor, "line")).toHaveLength(0)
    expect(editor.getCanUndo()).toBe(false)
    expect(editor.getPath()).toBe("root.line.idle")
  })
})

describe("FrameTool", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("drags out a frame of the dragged size, at least 32 square", () => {
    editor.setCurrentTool("frame")
    drag(editor, [100, 100], [300, 200], [500, 400])

    const frame = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(frame.x).toBe(100)
    expect(frame.y).toBe(100)
    expect(frame.props).toMatchObject({ w: 400, h: 300, name: "Frame 1" })
    expect(editor.getCurrentToolId()).toBe("select")

    editor.setCurrentTool("frame")
    editor.setCamera({ x: 0, y: 0, z: 8 })
    drag(editor, [700, 100], [706, 106], [712, 112])
    const small = shapesOfType<FrameShape>(editor, "frame")[1]!
    expect(small.props.w).toBe(32)
    expect(small.props.h).toBe(32)
    expect(small.props.name).toBe("Frame 2")
  })

  it("clicks out a default 320x180 frame centred on the point", () => {
    editor.setCurrentTool("frame")
    click(editor, 500, 400)

    const frame = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(frame.props).toMatchObject({ w: 320, h: 180 })
    expect(frame.x).toBe(340)
    expect(frame.y).toBe(310)
  })

  it("adopts shapes fully inside it and leaves the others alone", () => {
    const inside = createGeo(editor, 150, 150)
    const outside = createGeo(editor, 600, 600)
    const overlapping = createGeo(editor, 450, 150)
    const pageId = editor.getCurrentPageId()

    editor.setCurrentTool("frame")
    drag(editor, [100, 100], [300, 300], [500, 500])
    const frame = shapesOfType<FrameShape>(editor, "frame")[0]!

    expect(editor.getShape(inside.id)!.parentId).toBe(frame.id as ShapeId)
    // reparenting keeps the shape in place: 150,150 page → 50,50 inside the frame
    expect(editor.getShape(inside.id)!.x).toBeCloseTo(50, 6)
    expect(editor.getShape(inside.id)!.y).toBeCloseTo(50, 6)
    expect(editor.getShape(outside.id)!.parentId).toBe(pageId)
    expect(editor.getShape(overlapping.id)!.parentId).toBe(pageId)
  })

  it("skips locked shapes when adopting", () => {
    const locked = createGeo(editor, 150, 150)
    editor.updateShape({ id: locked.id, type: "geo", isLocked: true })
    const pageId = editor.getCurrentPageId()

    editor.setCurrentTool("frame")
    drag(editor, [100, 100], [300, 300], [500, 500])

    expect(editor.getShape(locked.id)!.parentId).toBe(pageId)
  })

  it("cancel removes the in-progress frame and leaves history clean", () => {
    editor.setCurrentTool("frame")
    pointer(editor, "pointer_down", 100, 100)
    pointer(editor, "pointer_move", 300, 300)
    expect(shapesOfType(editor, "frame")).toHaveLength(1)

    editor.cancel()
    expect(shapesOfType(editor, "frame")).toHaveLength(0)
    expect(editor.getCanUndo()).toBe(false)
    expect(editor.getPath()).toBe("root.frame.idle")
  })
})

describe("BaseBoxShapeTool", () => {
  /** A placement tool for a shape type the built-ins know nothing about. */
  class BoxTool extends BaseBoxShapeTool {
    static override id = "testbox"
    static override initial = "idle"
    override shapeType = "frame" as const
    /** What `onCreate` was handed, so the test can see the finished shape. */
    created: UnknownShape | null | undefined
    override onCreate(shape: UnknownShape | null): void {
      this.created = shape
      this.editor.setCurrentTool("select")
    }
  }

  function makeBoxEditor(): Editor {
    const engine = loadEngineSync(readFileSync(wasmPath))
    const editor = new Editor({
      store: createStore(),
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [...defaultTools, BoxTool],
      engine,
      getContainer: () => ({}) as HTMLElement,
    })
    editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
    return editor
  }

  let editor: Editor
  beforeEach(() => {
    editor = makeBoxEditor()
  })

  function tool(): BoxTool {
    return editor.root.children!["testbox"] as BoxTool
  }

  it("drags out a box between the two corners", () => {
    editor.setCurrentTool("testbox")
    drag(editor, [100, 100], [300, 200], [500, 400])

    const shape = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(shape.x).toBe(100)
    expect(shape.y).toBe(100)
    expect(shape.props).toMatchObject({ w: 400, h: 300 })
    expect(tool().created?.id).toBe(shape.id)
  })

  it("moves the origin instead of producing a negative box when dragged up and left", () => {
    editor.setCurrentTool("testbox")
    drag(editor, [500, 400], [400, 300], [100, 100])

    const shape = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(shape.x).toBe(100)
    expect(shape.y).toBe(100)
    expect(shape.props).toMatchObject({ w: 400, h: 300 })
  })

  it("squares the box while shift is held", () => {
    editor.setCurrentTool("testbox")
    pointer(editor, "pointer_down", 100, 100)
    pointer(editor, "pointer_move", 300, 300)
    pointer(editor, "pointer_move", 500, 250, { shiftKey: true })
    pointer(editor, "pointer_up", 500, 250, { shiftKey: true })

    const shape = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(shape.props.w).toBe(400)
    expect(shape.props.h).toBe(400)
  })

  it("places a default-sized box centred on a click", () => {
    editor.setCurrentTool("testbox")
    click(editor, 500, 400)

    const shape = shapesOfType<FrameShape>(editor, "frame")[0]!
    // The util's own defaults, so the tool and `createShape` agree on "a new one".
    expect(shape.props).toMatchObject({ w: 160, h: 90 })
    expect(shape.x).toBe(500 - 80)
    expect(shape.y).toBe(400 - 45)
  })

  it("selects what it created and calls onCreate exactly once", () => {
    editor.setCurrentTool("testbox")
    drag(editor, [100, 100], [300, 300])

    const shape = shapesOfType<FrameShape>(editor, "frame")[0]!
    expect(editor.getSelectedShapeIds()).toEqual([shape.id])
    expect(tool().created?.id).toBe(shape.id)
    expect(editor.getCurrentToolId()).toBe("select")
  })

  it("cancels without a shape and without touching history", () => {
    editor.setCurrentTool("testbox")
    pointer(editor, "pointer_down", 100, 100)
    pointer(editor, "pointer_move", 300, 300)
    editor.cancel()

    expect(shapesOfType(editor, "frame")).toHaveLength(0)
    expect(editor.getCanUndo()).toBe(false)
    // A cancelled gesture never created anything, so `onCreate` never ran.
    expect(tool().created).toBeUndefined()
    expect(editor.getPath()).toBe("root.testbox.idle")
  })

  it("keeps placing while tool lock is on", () => {
    class LockedTool extends BaseBoxShapeTool {
      static override id = "lockedbox"
      static override initial = "idle"
      override shapeType = "frame" as const
    }
    const engine = loadEngineSync(readFileSync(wasmPath))
    const locked = new Editor({
      store: createStore(),
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [...defaultTools, LockedTool],
      engine,
      getContainer: () => ({}) as HTMLElement,
    })
    locked.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
    locked.updateInstanceState({ isToolLocked: true })

    locked.setCurrentTool("lockedbox")
    drag(locked, [100, 100], [300, 300])
    expect(locked.getCurrentToolId()).toBe("lockedbox")

    locked.updateInstanceState({ isToolLocked: false })
    drag(locked, [400, 400], [600, 600])
    expect(locked.getCurrentToolId()).toBe("select")
  })
})

describe("frame-like drop targets while translating", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  /** Press ON a shape — the select tool branches on the event's own target. */
  function pressShape(shape: UnknownShape, x: number, y: number): void {
    editor.dispatch({
      type: "pointer",
      name: "pointer_down",
      point: { x, y },
      pointerId: 1,
      button: 0,
      isPen: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
      target: "shape",
      shape,
    })
  }

  function makeFrame(): FrameShape {
    editor.setCurrentTool("frame")
    drag(editor, [100, 100], [300, 300], [500, 500])
    editor.setCurrentTool("select")
    return shapesOfType<FrameShape>(editor, "frame")[0]!
  }

  it("hints the container the drag is over, and clears the hint when it ends", () => {
    const geo = createGeo(editor, 700, 700)
    const frame = makeFrame()

    pressShape(editor.getShape(geo.id)!, 710, 710)
    pointer(editor, "pointer_move", 300, 300)
    expect(editor.getHintingShapeIds()).toEqual([frame.id])

    pointer(editor, "pointer_up", 300, 300)
    expect(editor.getHintingShapeIds()).toEqual([])
    expect(editor.getShape(geo.id)!.parentId).toBe(frame.id as ShapeId)
  })

  it("lifts a child back onto the page when it is dragged out", () => {
    const geo = createGeo(editor, 150, 150)
    const frame = makeFrame()
    expect(editor.getShape(geo.id)!.parentId).toBe(frame.id as ShapeId)

    pressShape(editor.getShape(geo.id)!, 160, 160)
    pointer(editor, "pointer_move", 800, 800)
    pointer(editor, "pointer_up", 800, 800)
    expect(editor.getShape(geo.id)!.parentId).toBe(editor.getCurrentPageId())
  })

  it("leaves a click alone: only a real drag reparents", () => {
    const geo = createGeo(editor, 150, 150)
    makeFrame()
    const pageId = editor.getCurrentPageId()
    editor.reparentShapes([geo.id], pageId)

    pressShape(editor.getShape(geo.id)!, 160, 160)
    pointer(editor, "pointer_up", 160, 160)
    expect(editor.getShape(geo.id)!.parentId).toBe(pageId)
  })
})

describe("NoteTool", () => {
  it("centres the note it places on the point", () => {
    const editor = makeEditor()
    editor.setCurrentTool("note")
    click(editor, 500, 400)
    const bounds = editor.getShapePageBounds(shapesOfType<UnknownShape>(editor, "note")[0]!.id)!
    expect(bounds.midX).toBeCloseTo(500)
    expect(bounds.midY).toBeCloseTo(400)
    editor.dispose()
  })

  it("centres a scaled note on its own size, not on the unscaled one", () => {
    // `scale` makes a note bigger without changing `NOTE_SIZE`, so a tool that
    // offsets by half of 200 drops a 320-wide note down and to the right of the
    // cursor — 60 units of it, which is what Molekula sees with its own default.
    class ScaledNoteUtil extends NoteShapeUtil {
      override getDefaultProps(): ReturnType<NoteShapeUtil["getDefaultProps"]> {
        return { ...super.getDefaultProps(), scale: 1.6 }
      }
    }
    const editor = new Editor({
      store: createStore(),
      shapeUtils: defaultShapeUtils.map((u) => (u === NoteShapeUtil ? ScaledNoteUtil : u)),
      bindingUtils: defaultBindingUtils,
      tools: defaultTools,
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => ({}) as HTMLElement,
    })
    editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
    editor.setCurrentTool("note")
    click(editor, 500, 400)
    const bounds = editor.getShapePageBounds(shapesOfType<UnknownShape>(editor, "note")[0]!.id)!
    expect(bounds.w).toBeCloseTo(320)
    expect(bounds.midX).toBeCloseTo(500)
    expect(bounds.midY).toBeCloseTo(400)
    editor.dispose()
  })
})

describe("defaultShapeTools", () => {
  it("is the shape-placing subset of defaultTools", () => {
    const all = new Set(defaultTools.map((t) => t.id))
    for (const tool of defaultShapeTools) expect(all.has(tool.id), tool.id).toBe(true)
    // The canvas tools are NOT in it: they place nothing.
    const shapeIds = new Set(defaultShapeTools.map((t) => t.id))
    for (const id of ["select", "hand", "eraser", "laser"]) expect(shapeIds.has(id), id).toBe(false)
  })

  it("names every default tool exactly once between the two lists", () => {
    const ids = defaultTools.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    // select, hand, eraser and laser: the four that place nothing.
    expect(ids.length).toBe(defaultShapeTools.length + 4)
  })

  it("starts the editor in select, whichever way the two lists are spread", () => {
    const engine = loadEngineSync(readFileSync(wasmPath))
    // The spread the consumer writes: every shape tool is named twice, which a
    // tool registry keyed by id has to survive.
    const editor = new Editor({
      store: createStore(),
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [...defaultTools, ...defaultShapeTools],
      engine,
      getContainer: () => ({}) as HTMLElement,
    })
    expect(editor.getCurrentToolId()).toBe("select")
    editor.setCurrentTool("geo")
    expect(editor.getCurrentToolId()).toBe("geo")
    editor.dispose()
  })
})
