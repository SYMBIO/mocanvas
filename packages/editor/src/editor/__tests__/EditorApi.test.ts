import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { react } from "@mocanvas/state"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import {
  Editor,
  registerExportImplementation,
  registerTextMeasureImplementation,
  type EditorExportImplementation,
  type EditorTextMeasure,
} from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number }>
type PinShape = BaseShape<"pin", { w: number; h: number }>

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  getDefaultProps() {
    return { w: 100, h: 100 }
  }
  getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

/** A shape that refuses to be resized. */
class PinUtil extends BaseBoxShapeUtil<PinShape> {
  static override type = "pin" as const
  getDefaultProps() {
    return { w: 40, h: 40 }
  }
  getGeometry(shape: PinShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
  override canResize(): boolean {
    return false
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0x00ff00ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor() {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil, PinUtil],
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function box(editor: Editor, x: number, y: number, w: number, h: number): ShapeId {
  editor.createShape<BoxShape>({ type: "box", x, y, props: { w, h } })
  return editor.getCurrentPageShapes().at(-1)!.id
}

describe("Editor resize", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("scales a shape about its center by default", () => {
    const id = box(editor, 0, 0, 100, 100)
    editor.resizeShape(id, { x: 2, y: 1 })
    const shape = editor.getShape<BoxShape>(id)!
    expect(shape.props).toEqual({ w: 200, h: 100 })
    // The center stays put: 100 wide about x=50 becomes 200 wide starting at -50.
    expect(editor.getShapePageBounds(id)!.toJson()).toEqual({ x: -50, y: 0, w: 200, h: 100 })
  })

  it("scales about an explicit origin in a rotated frame", () => {
    const id = box(editor, 100, 0, 100, 100)
    editor.resizeShape(id, { x: 2, y: 2 }, { scaleOrigin: { x: 0, y: 0 } })
    expect(editor.getShape<BoxShape>(id)!.props).toEqual({ w: 200, h: 200 })
    expect(editor.getShapePageBounds(id)!.toJson()).toEqual({ x: 200, y: 0, w: 200, h: 200 })

    // A quarter-turn frame swaps which page axis each scale factor moves.
    const other = box(editor, 100, 0, 100, 100)
    editor.resizeShape(other, { x: 1, y: 3 }, { scaleOrigin: { x: 0, y: 0 }, scaleAxisRotation: Math.PI / 2 })
    const bounds = editor.getShapePageBounds(other)!
    expect(bounds.x).toBeCloseTo(300, 6)
    expect(bounds.y).toBeCloseTo(0, 6)
  })

  it("honours the util's aspect ratio lock and an explicit override", () => {
    const id = box(editor, 0, 0, 100, 100)
    vi.spyOn(BoxUtil.prototype, "isAspectRatioLocked").mockReturnValue(true)
    editor.resizeShape(id, { x: 3, y: 1 }, { scaleOrigin: { x: 0, y: 0 } })
    expect(editor.getShape<BoxShape>(id)!.props).toEqual({ w: 300, h: 300 })

    const free = box(editor, 0, 0, 100, 100)
    editor.resizeShape(free, { x: 3, y: 1 }, { scaleOrigin: { x: 0, y: 0 }, isAspectRatioLocked: false })
    expect(editor.getShape<BoxShape>(free)!.props).toEqual({ w: 300, h: 100 })
    vi.restoreAllMocks()
  })

  it("leaves shapes alone when the util says they cannot be resized", () => {
    editor.createShape<PinShape>({ type: "pin", x: 10, y: 10, props: { w: 40, h: 40 } })
    const pin = editor.getCurrentPageShapes()[0]!
    editor.resizeShape(pin.id, { x: 4, y: 4 })
    expect(editor.getShape<PinShape>(pin.id)!.props).toEqual({ w: 40, h: 40 })
    expect(editor.getShapePageBounds(pin.id)!.toJson()).toEqual({ x: 10, y: 10, w: 40, h: 40 })
  })

  it("leaves locked shapes alone", () => {
    const id = box(editor, 0, 0, 100, 100)
    editor.updateShape<BoxShape>({ id, type: "box", isLocked: true })
    editor.resizeShape(id, { x: 2, y: 2 })
    expect(editor.getShape<BoxShape>(id)!.props).toEqual({ w: 100, h: 100 })
  })

  it("brackets the change with onResizeStart and onResizeEnd", () => {
    const start = vi.fn()
    const end = vi.fn()
    const util = editor.getShapeUtil<BoxShape>("box")
    ;(util as { onResizeStart?: unknown }).onResizeStart = start
    ;(util as { onResizeEnd?: unknown }).onResizeEnd = end
    const id = box(editor, 0, 0, 100, 100)
    editor.resizeShape(id, { x: 2, y: 2 })
    expect(start).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect((end.mock.calls[0]![1] as BoxShape).props.w).toBe(200)
    delete (util as { onResizeStart?: unknown }).onResizeStart
    delete (util as { onResizeEnd?: unknown }).onResizeEnd
  })

  it("resizeShapes scales a group about its common center", () => {
    const a = box(editor, 0, 0, 100, 100)
    const b = box(editor, 200, 0, 100, 100)
    editor.resizeShapes([a, b], { x: 2, y: 1 })
    // Common bounds are 0..300, center x = 150.
    expect(editor.getShapePageBounds(a)!.toJson()).toEqual({ x: -150, y: 0, w: 200, h: 100 })
    expect(editor.getShapePageBounds(b)!.toJson()).toEqual({ x: 250, y: 0, w: 200, h: 100 })
  })
})

describe("Editor stretchShapes", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("makes every shape span the common bounds horizontally", () => {
    const a = box(editor, 0, 0, 100, 100)
    const b = box(editor, 200, 40, 50, 50)
    editor.stretchShapes([a, b], "horizontal")
    for (const id of [a, b]) {
      const bounds = editor.getShapePageBounds(id)!
      expect(bounds.x).toBeCloseTo(0, 6)
      expect(bounds.w).toBeCloseTo(250, 6)
    }
    // The other axis is untouched.
    expect(editor.getShapePageBounds(a)!.toJson()).toMatchObject({ y: 0, h: 100 })
    expect(editor.getShapePageBounds(b)!.toJson()).toMatchObject({ y: 40, h: 50 })
  })

  it("makes every shape span the common bounds vertically", () => {
    const a = box(editor, 0, 0, 100, 100)
    const b = box(editor, 200, 40, 50, 50)
    editor.stretchShapes([a, b], "vertical")
    for (const id of [a, b]) {
      const bounds = editor.getShapePageBounds(id)!
      expect(bounds.y).toBeCloseTo(0, 6)
      expect(bounds.h).toBeCloseTo(100, 6)
    }
    expect(editor.getShapePageBounds(b)!.toJson()).toMatchObject({ x: 200, w: 50 })
  })

  it("counts unresizable shapes in the bounds but does not touch them", () => {
    const a = box(editor, 0, 0, 100, 100)
    editor.createShape<PinShape>({ type: "pin", x: 300, y: 0, props: { w: 40, h: 40 } })
    const pin = editor.getCurrentPageShapes().at(-1)!.id
    editor.stretchShapes([a, pin], "horizontal")
    expect(editor.getShapePageBounds(a)!.toJson()).toEqual({ x: 0, y: 0, w: 340, h: 100 })
    expect(editor.getShapePageBounds(pin)!.toJson()).toEqual({ x: 300, y: 0, w: 40, h: 40 })
  })

  it("needs at least two shapes", () => {
    const a = box(editor, 0, 0, 100, 100)
    editor.stretchShapes([a], "horizontal")
    expect(editor.getShapePageBounds(a)!.toJson()).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })
})

describe("Editor export seam", () => {
  let editor: Editor
  let dispose: (() => void) | undefined
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it("throws an actionable error until an implementation is registered", async () => {
    expect(() => editor.getSvgString()).toThrow(/importing `mocanvas` installs it/i)
    await expect(editor.toImage()).rejects.toThrow(/registerExportImplementation/)
  })

  it("delegates to the registered implementation", async () => {
    const blob = { size: 3 } as Blob
    const impl: EditorExportImplementation = {
      getSvgString: vi.fn(() => ({ svg: "<svg/>", width: 10, height: 20 })),
      toImage: vi.fn(async () => ({ blob, width: 10, height: 20 })),
    }
    dispose = registerExportImplementation(impl)
    const id = box(editor, 0, 0, 100, 100)

    expect(editor.getSvgString([id], { padding: 4 })).toEqual({ svg: "<svg/>", width: 10, height: 20 })
    expect(impl.getSvgString).toHaveBeenCalledWith(editor, [id], { padding: 4 })

    await expect(editor.toImage([id], { format: "png" })).resolves.toEqual({ blob, width: 10, height: 20 })
    expect(impl.toImage).toHaveBeenCalledWith(editor, [id], { format: "png" })
  })

  it("throws again once the implementation is removed", () => {
    const remove = registerExportImplementation({
      getSvgString: () => undefined,
      toImage: async () => ({ blob: {} as Blob, width: 0, height: 0 }),
    })
    expect(editor.getSvgString()).toBeUndefined()
    remove()
    expect(() => editor.getSvgString()).toThrow(/no implementation registered/)
  })
})

describe("Editor textMeasure seam", () => {
  let editor: Editor
  let dispose: (() => void) | undefined
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it("throws an actionable error until a measurer is registered", () => {
    expect(() => editor.textMeasure).toThrow(/importing `mocanvas` installs it/i)
    expect(() => editor.textMeasure).toThrow(/registerTextMeasureImplementation/)
  })

  it("delegates to the registered measurer", () => {
    const measure: EditorTextMeasure = {
      measureText: vi.fn(() => ({ w: 42, h: 24, lineCount: 2 })),
      measureHtml: vi.fn(() => ({ w: 42, h: 24, scrollWidth: 42 })),
      measureHtmlBatch: vi.fn(() => [{ w: 42, h: 24, scrollWidth: 42 }]),
    }
    const provider = vi.fn(() => measure)
    dispose = registerTextMeasureImplementation(provider)
    const opts = { fontFamily: "sans-serif", fontSize: 12, lineHeight: 1.5 }
    expect(editor.textMeasure.measureText("hi\nthere", opts)).toEqual({ w: 42, h: 24, lineCount: 2 })
    expect(provider).toHaveBeenCalledWith(editor)
    expect(measure.measureText).toHaveBeenCalledWith("hi\nthere", opts)
  })
})

describe("Editor menus", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("round-trips open menus through the instance record", () => {
    expect(editor.menus.getOpenMenus()).toEqual([])
    expect(editor.menus.isMenuOpen("main")).toBe(false)

    editor.menus.addOpenMenu("main")
    editor.menus.addOpenMenu("context")
    editor.menus.addOpenMenu("main") // already open: no change
    expect(editor.menus.getOpenMenus()).toEqual(["main", "context"])
    expect(editor.getInstanceState().openMenus).toEqual(["main", "context"])
    expect(editor.menus.isMenuOpen("context")).toBe(true)

    editor.menus.removeOpenMenu("main")
    expect(editor.menus.getOpenMenus()).toEqual(["context"])
    editor.menus.removeOpenMenu("nope")
    expect(editor.menus.getOpenMenus()).toEqual(["context"])

    editor.menus.clearOpenMenus()
    expect(editor.menus.getOpenMenus()).toEqual([])
    expect(editor.getInstanceState().openMenus).toEqual([])
  })

  it("does not hand out the stored array", () => {
    editor.menus.addOpenMenu("main")
    editor.menus.getOpenMenus().push("sneaky")
    expect(editor.menus.getOpenMenus()).toEqual(["main"])
  })

  it("is reactive", () => {
    const seen: string[][] = []
    const stop = react("menus", () => {
      seen.push(editor.menus.getOpenMenus())
    })
    editor.menus.addOpenMenu("main")
    editor.menus.addOpenMenu("main")
    editor.menus.clearOpenMenus()
    stop()
    editor.menus.addOpenMenu("after-stop")
    expect(seen).toEqual([[], ["main"], []])
  })

  it("keeps `user` alongside the menu registry", () => {
    expect(typeof editor.user.getId()).toBe("string")
    expect(typeof editor.user.getName()).toBe("string")
    expect(typeof editor.user.getColor()).toBe("string")
  })
})
