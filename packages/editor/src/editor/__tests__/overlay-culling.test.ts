import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type CardShape = BaseShape<"card", { w: number; h: number }>
type LiveShape = BaseShape<"live", { w: number; h: number }>

/** A DOM-overlay shape that is happy to be culled (no `canCull`). */
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

/** A DOM-overlay shape whose DOM must outlive the viewport — a live embed, a playing video. */
class LiveUtil extends BaseBoxShapeUtil<LiveShape> {
  static override type = "live" as const
  getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: LiveShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
  canCull(): boolean {
    return false
  }
}

type PanelShape = BaseShape<"panel", { w: number; h: number }>

/** A GPU-drawn container that clips its children to its bounds, like a frame. */
class PanelUtil extends BaseBoxShapeUtil<PanelShape> {
  static override type = "panel" as const
  getDefaultProps() {
    return { w: 400, h: 300 }
  }
  override getGeometry(shape: PanelShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0xffffffff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
  override isClipShape(): boolean {
    return true
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

function makeEditor(withLive = true) {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: withLive ? [CardUtil, LiveUtil, PanelUtil] : [CardUtil],
    tools: [Idle],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const ids = (editor: Editor) => [...editor.getOverlayShapeIds()].map((id) => editor.getShape(id)!.meta.name)

describe("DOM overlay and canCull", () => {
  it("keeps a shape that cannot be culled in the overlay while it is off screen", () => {
    const editor = makeEditor()
    editor.createShapes([
      { type: "card", x: 10, y: 10, meta: { name: "visible" } },
      { type: "live", x: 5000, y: 10, meta: { name: "live-off" } },
      { type: "card", x: 6000, y: 10, meta: { name: "card-off" } },
    ])
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(["visible", "live-off"])
    // An off-screen kept shape has no clip of its own.
    expect(editor.getOverlayClips()[1]).toBeUndefined()
  })

  it("keeps the overlay in paint order, so a kept shape coming on screen does not move", () => {
    const editor = makeEditor()
    editor.createShapes([
      { type: "live", x: -3000, y: 10, meta: { name: "a" } },
      { type: "card", x: 10, y: 10, meta: { name: "b" } },
      { type: "live", x: 5000, y: 10, meta: { name: "c" } },
    ])
    editor.renderFrame(backend)
    const before = ids(editor)
    expect(before).toEqual(["a", "b", "c"])
    // Pan right so `c` enters the viewport and `b` leaves it.
    editor.setCamera({ x: -4900, y: 0, z: 1 })
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(["a", "c"])
    editor.setCamera({ x: 0, y: 0, z: 1 })
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(before)
  })

  it("drops a deleted kept shape and leaves hosts without canCull exactly as before", () => {
    const editor = makeEditor()
    editor.createShapes([{ type: "live", x: 5000, y: 10, meta: { name: "gone" } }])
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(["gone"])
    editor.deleteShapes([...editor.getCurrentPageShapeIds()] as ShapeId[])
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual([])

    const plain = makeEditor(false)
    plain.createShapes([
      { type: "card", x: 10, y: 10, meta: { name: "on" } },
      { type: "card", x: 5000, y: 10, meta: { name: "off" } },
    ])
    plain.renderFrame(backend)
    expect(ids(plain)).toEqual(["on"])
  })

  it("gives a kept shape its ancestors' clip on and off screen, and drops it when clipped away", () => {
    const editor = makeEditor()
    editor.createShapes([{ id: "shape:panel" as ShapeId, type: "panel", x: 5000, y: 0, meta: { name: "panel" } }])
    editor.createShapes([
      { type: "live", parentId: "shape:panel" as ShapeId, x: 20, y: 20, meta: { name: "inside" } },
      { type: "live", parentId: "shape:panel" as ShapeId, x: 900, y: 20, meta: { name: "clipped-away" } },
    ])
    const panelClip = [5000, 0, 5400, 300]
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(["inside"])
    expect(editor.getOverlayClips()[0]).toEqual(panelClip)
    // On screen the clip is the same value, so the shape's DOM never changes shape.
    editor.setCamera({ x: -4900, y: 0, z: 1 })
    editor.renderFrame(backend)
    expect(ids(editor)).toEqual(["inside"])
    expect(editor.getOverlayClips()[0]).toEqual(panelClip)
  })
})
