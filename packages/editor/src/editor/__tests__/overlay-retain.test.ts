/**
 * Keeping DOM-overlay shapes that just left the viewport mounted, hidden.
 *
 * The engine reports the overlay shapes inside the viewport and nothing else,
 * so a card that crossed the viewport edge was unmounted and, a moment later
 * when the pan came back, rebuilt from nothing — 82 to 192 remounts per gesture
 * on a product board. These tests pin the bounded keep-alive that replaces it:
 * the most recently culled shapes stay in the overlay list, flagged as retained,
 * up to `options.overlayRetainLimit`.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type CardShape = BaseShape<"card", { w: number; h: number }>

class CardUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const
  getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: CardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
}

class Idle extends StateNode {
  static override id = "idle"
}

const backend = {
  kind: "webgl2" as const,
  resize() {},
  draw() {},
  uploadTexture() {},
  deleteTexture() {},
  dispose() {},
}

function makeEditor(options: { overlayRetainLimit?: number; hidden?: string[] } = {}) {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [CardUtil],
    tools: [Idle],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getShapeVisibility: (shape) => (options.hidden?.includes(String(shape.meta.name)) ? "hidden" : "inherit"),
    ...(options.overlayRetainLimit === undefined ? {} : { options: { overlayRetainLimit: options.overlayRetainLimit } }),
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const name = (editor: Editor, id: ShapeId) => String(editor.getShape(id)!.meta.name)
const mounted = (editor: Editor) => [...editor.getOverlayShapeIds()].map((id) => name(editor, id))
const retained = (editor: Editor) => [...editor.getOverlayRetainedShapeIds()].map((id) => name(editor, id)).sort()

/** Three cards in a row, 2000 page units apart, so the viewport holds one at a time. */
function threeCards(editor: Editor) {
  editor.createShapes([
    { type: "card", x: 10, y: 10, meta: { name: "a" } },
    { type: "card", x: 2010, y: 10, meta: { name: "b" } },
    { type: "card", x: 4010, y: 10, meta: { name: "c" } },
  ])
}

const panTo = (editor: Editor, x: number) => {
  editor.setCamera({ x: -x, y: 0, z: 1 })
  editor.renderFrame(backend)
}

describe("retaining overlay shapes that left the viewport", () => {
  it("keeps a shape that panned out of view mounted, flagged as retained", () => {
    const editor = makeEditor()
    threeCards(editor)
    editor.renderFrame(backend)
    expect(mounted(editor)).toEqual(["a"])
    expect(retained(editor)).toEqual([])

    panTo(editor, 2000)
    expect(mounted(editor)).toEqual(["a", "b"])
    expect(retained(editor)).toEqual(["a"])
  })

  it("does not change the mounted list when a retained shape pans back in", () => {
    const editor = makeEditor()
    threeCards(editor)
    editor.renderFrame(backend)
    panTo(editor, 2000)
    const ids = editor.getOverlayShapeIds()
    panTo(editor, 0)
    // Same members, same order: React has nothing to mount, unmount or move.
    expect(editor.getOverlayShapeIds()).toEqual(ids)
    expect(retained(editor)).toEqual(["b"])
  })

  it("keeps the mounted list in paint order whichever side a shape left by", () => {
    const editor = makeEditor()
    threeCards(editor)
    panTo(editor, 4000)
    panTo(editor, 2000)
    panTo(editor, 0)
    expect(mounted(editor)).toEqual(["a", "b", "c"])
  })

  it("evicts the least recently visible shape beyond the limit", () => {
    const editor = makeEditor({ overlayRetainLimit: 1 })
    threeCards(editor)
    editor.renderFrame(backend)
    panTo(editor, 2000)
    panTo(editor, 4000)
    // `a` left first and is gone; `b` left last and is kept.
    expect(mounted(editor)).toEqual(["b", "c"])
    expect(retained(editor)).toEqual(["b"])
  })

  it("retains nothing with a limit of 0, which is the old behaviour", () => {
    const editor = makeEditor({ overlayRetainLimit: 0 })
    threeCards(editor)
    editor.renderFrame(backend)
    panTo(editor, 2000)
    expect(mounted(editor)).toEqual(["b"])
    expect(retained(editor)).toEqual([])
  })

  it("drops a retained shape that was deleted or hidden", () => {
    const editor = makeEditor({ hidden: [] })
    threeCards(editor)
    editor.renderFrame(backend)
    panTo(editor, 2000)
    panTo(editor, 4000)
    expect(retained(editor)).toEqual(["a", "b"])
    const a = editor.getOverlayShapeIds().find((id) => name(editor, id) === "a")!
    editor.deleteShapes([a])
    editor.renderFrame(backend)
    expect(mounted(editor)).toEqual(["b", "c"])
    expect(retained(editor)).toEqual(["b"])
  })

  it("never retains a shape the host hides", () => {
    const editor = makeEditor({ hidden: ["a"] })
    threeCards(editor)
    editor.renderFrame(backend)
    // On screen the engine still lists it — hiding is the host's call, made per
    // shape where it is drawn — but once culled there is no reason to keep it.
    expect(mounted(editor)).toEqual(["a"])
    panTo(editor, 2000)
    expect(mounted(editor)).toEqual(["b"])
    expect(retained(editor)).toEqual([])
  })

  it("forgets the retained shapes of a page the editor left", () => {
    const editor = makeEditor()
    threeCards(editor)
    editor.renderFrame(backend)
    panTo(editor, 2000)
    expect(retained(editor)).toEqual(["a"])
    editor.createPage({ name: "Two" })
    const second = editor.getPages().at(-1)!
    editor.setCurrentPage(second.id)
    editor.renderFrame(backend)
    expect(editor.getOverlayShapeIds()).toEqual([])
    expect(editor.getOverlayRetainedShapeIds().size).toBe(0)
  })
})
