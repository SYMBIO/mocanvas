import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId, UnknownShape } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"

/**
 * `Editor.getShapeMask` honouring `ShapeUtil.getClipPath()`.
 *
 * The rectangle case is covered in `EditorMembers.test.ts`; what is pinned
 * here is that a util which describes a clip region of its own gets that
 * region, and that "clips to my bounds" still works for a util that names no
 * path at all.
 */

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number }>
type ClipShape = BaseShape<string, { w: number; h: number }>

const STYLE: StyleWords = { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  override getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return STYLE
  }
}

/** A clipping container whose region is a triangle over its top-left half. */
class TriangleFrameUtil extends BaseBoxShapeUtil<ClipShape> {
  static override type = "triangle-frame" as const
  override getDefaultProps() {
    return { w: 200, h: 200 }
  }
  override getGeometry(shape: ClipShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return STYLE
  }
  override isClipShape(): boolean {
    return true
  }
  override getClipPath(shape: ClipShape) {
    const { w, h } = shape.props
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
    ]
  }
}

/** Clips, but names no path: the pre-v5 "clip to my bounds" behaviour. */
class BoundsFrameUtil extends BaseBoxShapeUtil<ClipShape> {
  static override type = "bounds-frame" as const
  override getDefaultProps() {
    return { w: 200, h: 200 }
  }
  override getGeometry(shape: ClipShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return STYLE
  }
  override isClipShape(): boolean {
    return true
  }
}

/** Describes a clip region without claiming to be a clip shape — the path still wins. */
class PathOnlyFrameUtil extends BaseBoxShapeUtil<ClipShape> {
  static override type = "path-frame" as const
  override getDefaultProps() {
    return { w: 200, h: 200 }
  }
  override getGeometry(shape: ClipShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return STYLE
  }
  override getClipPath(shape: ClipShape) {
    const { w, h } = shape.props
    return [
      { x: 10, y: 10 },
      { x: w - 10, y: 10 },
      { x: w - 10, y: h - 10 },
      { x: 10, y: h - 10 },
    ]
  }
}

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil, TriangleFrameUtil, BoundsFrameUtil, PathOnlyFrameUtil],
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

/** Create `parent` at `at` with a box inside it, and return the box's id. */
function nest(editor: Editor, parentType: string, at: { x: number; y: number }): ShapeId {
  editor.createShapes([
    { type: parentType, x: at.x, y: at.y, props: { w: 200, h: 200 } },
    { type: "box", x: at.x, y: at.y, props: { w: 20, h: 20 } },
  ])
  const [parent, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
  editor.reparentShapes([child], parent)
  return child
}

const round = (points: { x: number; y: number }[] | undefined) =>
  points?.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }))

describe("getShapeMask and getClipPath", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("uses the clip path, in page space, rather than the ancestor's bounds", () => {
    const child = nest(editor, "triangle-frame", { x: 50, y: 100 })
    expect(round(editor.getShapeMask(child))).toEqual([
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      { x: 50, y: 300 },
    ])
  })

  it("moves the region with the ancestor — the path is shape-local", () => {
    const child = nest(editor, "triangle-frame", { x: 0, y: 0 })
    const before = round(editor.getShapeMask(child))!
    const parent = editor.getShape<UnknownShape>(child)!.parentId as ShapeId
    editor.updateShape({ id: parent, type: "triangle-frame", x: 30, y: 40 })
    const after = round(editor.getShapeMask(child))!
    expect(after).toEqual(before.map((p) => ({ x: p.x + 30, y: p.y + 40 })))
  })

  it("honours a path from a util that never says `isClipShape`", () => {
    const child = nest(editor, "path-frame", { x: 0, y: 0 })
    const mask = editor.getShapeMask(child)
    expect(mask).toHaveLength(4)
    expect(Math.min(...mask!.map((p) => p.x))).toBeCloseTo(10, 6)
    expect(Math.max(...mask!.map((p) => p.x))).toBeCloseTo(190, 6)
  })

  it("still clips to the bounds for a clip shape that names no path", () => {
    const child = nest(editor, "bounds-frame", { x: 5, y: 5 })
    const mask = editor.getShapeMask(child)
    expect(mask).toHaveLength(4)
    expect(Math.min(...mask!.map((p) => p.x))).toBeCloseTo(5, 6)
    expect(Math.max(...mask!.map((p) => p.y))).toBeCloseTo(205, 6)
  })

  it("intersects a path region with a bounds region", () => {
    editor.createShapes([{ type: "bounds-frame", x: 0, y: 0, props: { w: 200, h: 200 } }])
    const outer = editor.getCurrentPageShapes()[0]!.id
    editor.createShapes([{ type: "triangle-frame", x: 100, y: 0, props: { w: 200, h: 200 } }])
    const inner = (editor.getCurrentPageShapes() as UnknownShape[]).find((s) => s.type === "triangle-frame")!.id
    editor.createShapes([{ type: "box", x: 100, y: 0, props: { w: 10, h: 10 } }])
    const child = (editor.getCurrentPageShapes() as UnknownShape[]).find((s) => s.type === "box")!.id
    editor.reparentShapes([inner], outer)
    editor.reparentShapes([child], inner)

    const mask = editor.getShapeMask(child)!
    // The triangle spans x 100..300; the outer frame cuts it at x = 200.
    expect(Math.max(...mask.map((p) => p.x))).toBeCloseTo(200, 6)
    expect(Math.min(...mask.map((p) => p.x))).toBeCloseTo(100, 6)
  })
})

describe("shapes addressed by id or by record", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("reparents either way, keeping the page position", () => {
    editor.createShapes([
      { type: "bounds-frame", x: 100, y: 100, props: { w: 200, h: 200 } },
      { type: "box", x: 150, y: 150, props: { w: 20, h: 20 } },
      { type: "box", x: 180, y: 180, props: { w: 20, h: 20 } },
    ])
    const [frame, byId, byRecord] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]

    editor.reparentShapes([byId], frame)
    editor.reparentShapes([editor.getShape<UnknownShape>(byRecord)!], frame)

    expect(editor.getShape<UnknownShape>(byId)!.parentId).toBe(frame)
    expect(editor.getShape<UnknownShape>(byRecord)!.parentId).toBe(frame)
    expect(editor.getShapePageBounds(byRecord)!.x).toBeCloseTo(180, 6)
  })

  it("resolves the parent transform from an id as well as a record", () => {
    editor.createShapes([
      { type: "bounds-frame", x: 40, y: 60, props: { w: 200, h: 200 } },
      { type: "box", x: 40, y: 60, props: { w: 20, h: 20 } },
    ])
    const [frame, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
    editor.reparentShapes([child], frame)

    const fromId = editor.getShapeParentTransform(child)
    const fromRecord = editor.getShapeParentTransform(editor.getShape<UnknownShape>(child)!)
    expect(fromId.e).toBeCloseTo(fromRecord.e, 6)
    expect(fromId.e).toBeCloseTo(40, 6)
    expect(editor.getShapeParentTransform("shape:gone" as ShapeId).e).toBe(0)
  })
})
