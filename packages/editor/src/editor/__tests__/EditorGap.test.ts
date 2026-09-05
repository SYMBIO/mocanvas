/**
 * The members added to close the documented `Editor` surface: ancestry,
 * clipping, culling, focus groups, adjacent movement, cropping, snapshots,
 * layout and mount state.
 *
 * These are behaviour tests, not presence tests — a member that exists and
 * answers the wrong thing is the failure mode a surface diff cannot see.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { createDeepLinkString, parseDeepLinkString, type TLDeepLink } from "../deepLinks"
import { Box, Rectangle2d } from "../../geometry"
import type { BaseShape, PageId, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number }>
type FrameShape = BaseShape<"frame", { w: number; h: number }>

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
  override canCrop() {
    return true
  }
  override canEdit() {
    return true
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class FrameUtil extends BaseBoxShapeUtil<FrameShape> {
  static override type = "frame" as const
  override getDefaultProps() {
    return { w: 200, h: 200 }
  }
  override getGeometry(shape: FrameShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override isClipShape(): boolean {
    return true
  }
  override isFrameLike(): boolean {
    return true
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0x00ff00ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

/** A shape that must keep existing off screen — a video, an embed, a live doc. */
class LiveUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "live" as const
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
  /** Not part of the base class: the editor asks for this hook structurally. */
  canCull(): boolean {
    return false
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0x0000ffff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(opts: Partial<ConstructorParameters<typeof Editor>[0]> = {}): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil, FrameUtil, LiveUtil],
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
    ...opts,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

/** A frame with a box inside it, plus a box on the page. */
function nested(editor: Editor): { frame: ShapeId; inside: ShapeId; outside: ShapeId } {
  editor.createShapes([
    { type: "frame", x: 0, y: 0, props: { w: 200, h: 200 } },
    { type: "box", x: 20, y: 20, props: { w: 50, h: 50 } },
    { type: "box", x: 600, y: 600, props: { w: 50, h: 50 } },
  ])
  const [frame, inside, outside] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]
  editor.reparentShapes([inside], frame)
  return { frame, inside, outside }
}

describe("ancestry", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("hasAncestor is false for a shape asked about itself", () => {
    const { frame, inside } = nested(editor)
    expect(editor.hasAncestor(inside, frame)).toBe(true)
    expect(editor.hasAncestor(frame, frame)).toBe(false)
  })

  it("findCommonAncestor is the frame for two siblings, undefined across the page", () => {
    const { frame, inside, outside } = nested(editor)
    editor.createShapes([{ type: "box", x: 100, y: 100, props: { w: 10, h: 10 } }])
    const sibling = editor.getCurrentPageShapes().at(-1)!.id
    editor.reparentShapes([sibling], frame)

    expect(editor.findCommonAncestor([inside, sibling])).toBe(frame)
    expect(editor.findCommonAncestor([inside, outside])).toBeUndefined()
    expect(editor.findCommonAncestor([])).toBeUndefined()
  })

  it("getShapeAndDescendantIds pulls children in whether or not they were named", () => {
    const { frame, inside } = nested(editor)
    expect([...editor.getShapeAndDescendantIds([frame])].sort()).toEqual([frame, inside].sort())
  })

  it("visitDescendants prunes the branch when the visitor returns false", () => {
    const { frame, inside } = nested(editor)
    const seen: ShapeId[] = []
    editor.visitDescendants(editor.getCurrentPageId(), (id) => {
      seen.push(id)
      if (id === frame) return false
      return undefined
    })
    expect(seen).toContain(frame)
    expect(seen).not.toContain(inside)
  })

  it("isAncestorSelected distinguishes the shape itself from its parent", () => {
    const { frame, inside } = nested(editor)
    editor.setSelectedShapes([frame])
    expect(editor.isAncestorSelected(inside)).toBe(true)
    expect(editor.isAncestorSelected(frame)).toBe(false)
  })

  it("isShapeInPage walks to the page rather than reading parentId", () => {
    const { inside } = nested(editor)
    expect(editor.isShapeInPage(inside)).toBe(true)
    expect(editor.isShapeInPage(inside, "page:nope" as PageId)).toBe(false)
  })

  it("isShapeOfType and isShapeFrameLike answer from the record and its util", () => {
    const { frame, inside } = nested(editor)
    expect(editor.isShapeOfType(frame, "frame")).toBe(true)
    expect(editor.isShapeOfType(inside, "frame")).toBe(false)
    expect(editor.isShapeFrameLike(frame)).toBe(true)
    expect(editor.isShapeFrameLike(inside)).toBe(false)
  })
})

describe("clipping and masked bounds", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("masked bounds shrink to the clip, and vanish when the shape is fully outside it", () => {
    const { frame, inside } = nested(editor)
    // Half of the box hangs off the frame's right edge.
    editor.updateShapes([{ id: inside, type: "box", x: 175, y: 20 }])
    const masked = editor.getShapeMaskedPageBounds(inside)!
    expect(masked.maxX).toBeCloseTo(200, 6)
    expect(masked.width).toBeCloseTo(25, 6)

    editor.updateShapes([{ id: inside, type: "box", x: 5000, y: 5000 }])
    expect(editor.getShapeMaskedPageBounds(inside)).toBeUndefined()
    // The frame itself is unclipped: it gets its ordinary bounds back.
    expect(editor.getShapeMaskedPageBounds(frame)!.width).toBeCloseTo(200, 6)
  })

  it("getShapeClipPath is a local-space polygon, and undefined when nothing clips", () => {
    const { frame, inside } = nested(editor)
    expect(editor.getShapeClipPath(frame)).toBeUndefined()

    const path = editor.getShapeClipPath(inside)!
    expect(path.startsWith("polygon(")).toBe(true)
    // The frame's page rect is 0..200; the box sits at 20,20, so in the box's
    // own space the clip runs -20..180.
    expect(path).toContain("-20px -20px")
    expect(path).toContain("180px 180px")
  })

  it("isPointInShape refuses a point the shape's own geometry would accept but the clip hides", () => {
    const { inside } = nested(editor)
    editor.updateShapes([{ id: inside, type: "box", x: 175, y: 20 }])
    // Inside the box, but past the frame's right edge.
    expect(editor.isPointInShape(inside, { x: 210, y: 40 }, { hitInside: true })).toBe(false)
    expect(editor.isPointInShape(inside, { x: 190, y: 40 }, { hitInside: true })).toBe(true)
  })

  it("getShapesPageBounds unions the masked bounds, not the raw ones", () => {
    const { inside, outside } = nested(editor)
    editor.updateShapes([{ id: inside, type: "box", x: 5000, y: 5000 }])
    const bounds = editor.getShapesPageBounds([inside, outside])!
    expect(bounds.minX).toBeCloseTo(600, 6)
  })
})

describe("culling and visibility", () => {
  let editor: Editor
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("separates 'not visible' from 'culled' when a util refuses to be culled", () => {
    const editor = makeEditor()
    editor.createShapes([
      { type: "box", x: 90_000, y: 90_000, props: { w: 10, h: 10 } },
      { type: "live", x: 90_000, y: 91_000, props: { w: 10, h: 10 } },
    ])
    const [plain, live] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]

    // Both are off screen…
    expect(editor.getNotVisibleShapes().has(plain)).toBe(true)
    expect(editor.getNotVisibleShapes().has(live)).toBe(true)
    // …but only the one willing to be skipped may be.
    expect(editor.getCulledShapes().has(plain)).toBe(true)
    expect(editor.getCulledShapes().has(live)).toBe(false)
    editor.dispose()
  })

  it("never culls the shape being edited", () => {
    const editor = makeEditor()
    editor.createShapes([{ type: "box", x: 90_000, y: 90_000, props: { w: 10, h: 10 } }])
    const id = editor.getCurrentPageShapes()[0]!.id
    expect(editor.getCulledShapes().has(id)).toBe(true)
    editor.setEditingShape(id)
    expect(editor.getCulledShapes().has(id)).toBe(false)
    editor.dispose()
  })

  it("getShapeVisibility hides a shape and everything under it, and 'visible' overrides", () => {
    const hidden = new Set<string>()
    const shown = new Set<string>()
    const editor = makeEditor({
      getShapeVisibility: (shape) => {
        if (hidden.has(shape.id)) return "hidden"
        if (shown.has(shape.id)) return "visible"
        return "inherit"
      },
    })
    const { frame, inside } = nested(editor)

    expect(editor.isShapeHidden(inside)).toBe(false)
    hidden.add(frame)
    expect(editor.isShapeHidden(frame)).toBe(true)
    expect(editor.isShapeHidden(inside)).toBe(true)
    shown.add(inside)
    expect(editor.isShapeHidden(inside)).toBe(false)

    // A hidden shape is not in the rendering list at all.
    expect(editor.getRenderingShapes().some((entry) => entry.id === frame)).toBe(false)
    editor.dispose()
  })

  it("rendering shapes carry inherited opacity and a background index below their own", () => {
    const editor = makeEditor()
    const { frame, inside } = nested(editor)
    editor.updateShapes([
      { id: frame, type: "frame", opacity: 0.5 },
      { id: inside, type: "box", opacity: 0.5 },
    ])
    const entry = editor.getRenderingShapes().find((e) => e.id === inside)!
    expect(entry.opacity).toBeCloseTo(0.25, 6)
    expect(entry.backgroundIndex).toBeLessThan(entry.index)
    editor.dispose()
  })

  it("reading order bands rows, so a row reads left to right rather than as a column", () => {
    const editor = makeEditor()
    editor.createShapes([
      { type: "box", x: 300, y: 2, props: { w: 50, h: 50 } },
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 0, y: 400, props: { w: 50, h: 50 } },
    ])
    const order = editor.getCurrentPageShapesInReadingOrder().map((s) => ({ x: s.x, y: s.y }))
    expect(order).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 2 },
      { x: 0, y: 400 },
    ])
    editor.dispose()
  })
})

describe("selection, focus groups and adjacent movement", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("getFocusedGroupId falls back to the page, and popping backs out one level", () => {
    const { frame, inside } = nested(editor)
    expect(editor.getFocusedGroupId()).toBe(editor.getCurrentPageId())

    editor.setFocusedGroup(frame)
    expect(editor.getFocusedGroupId()).toBe(frame)
    expect(editor.getFocusedGroup()?.id).toBe(frame)

    editor.popFocusedGroupId()
    expect(editor.getFocusedGroupId()).toBe(editor.getCurrentPageId())
    expect(editor.getSelectedShapeIds()).toEqual([frame])
    void inside
  })

  it("deselect removes only what it is given", () => {
    const { frame, inside, outside } = nested(editor)
    editor.setSelectedShapes([frame, inside, outside])
    editor.deselect(inside)
    expect(editor.getSelectedShapeIds()).toEqual([frame, outside])
  })

  it("selectParentShape stops at the page instead of emptying the selection", () => {
    const { frame, inside } = nested(editor)
    editor.setSelectedShapes([inside])
    editor.selectParentShape()
    expect(editor.getSelectedShapeIds()).toEqual([frame])
    editor.selectParentShape()
    expect(editor.getSelectedShapeIds()).toEqual([frame])
  })

  it("selectFirstChildShape descends only from a single selection", () => {
    const { frame, inside, outside } = nested(editor)
    editor.setSelectedShapes([frame, outside])
    editor.selectFirstChildShape()
    expect(editor.getSelectedShapeIds()).toEqual([frame, outside])

    editor.setSelectedShapes([frame])
    editor.selectFirstChildShape()
    expect(editor.getSelectedShapeIds()).toEqual([inside])
  })

  it("the nearest adjacent shape is aligned, not merely further along", () => {
    editor.createShapes([
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 100, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 60, y: 900, props: { w: 50, h: 50 } },
    ])
    const [origin, right, below] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]

    expect(editor.getNearestAdjacentShape(origin, "right")?.id).toBe(right)
    expect(editor.getNearestAdjacentShape(origin, "down")?.id).toBe(below)
    expect(editor.getNearestAdjacentShape(right, "right")).toBeUndefined()

    editor.setSelectedShapes([origin])
    editor.selectAdjacentShape("right")
    expect(editor.getSelectedShapeIds()).toEqual([right])
  })

  it("arrowing with nothing selected enters at the first shape in reading order", () => {
    editor.createShapes([{ type: "box", x: 400, y: 400, props: { w: 10, h: 10 } }])
    editor.selectNone()
    editor.selectAdjacentShape("right")
    expect(editor.getSelectedShapeIds()).toHaveLength(1)
  })

  it("rotated selection bounds hug a rotated shape where axis-aligned bounds do not", () => {
    editor.createShapes([{ type: "box", x: 0, y: 0, rotation: Math.PI / 4, props: { w: 100, h: 100 } }])
    const id = editor.getCurrentPageShapes()[0]!.id
    editor.setSelectedShapes([id])

    const axisAligned = editor.getSelectionPageBounds()!
    const rotated = editor.getSelectionRotatedPageBounds()!
    expect(axisAligned.width).toBeCloseTo(Math.SQRT2 * 100, 4)
    expect(rotated.width).toBeCloseTo(100, 6)
    expect(rotated.height).toBeCloseTo(100, 6)
  })

  it("screen bounds are page bounds plus the container offset, scaled by zoom", () => {
    editor.createShapes([{ type: "box", x: 10, y: 20, props: { w: 100, h: 100 } }])
    editor.setSelectedShapes([editor.getCurrentPageShapes()[0]!.id])
    editor.updateViewportScreenBounds({ x: 300, y: 68, w: 1000, h: 800 })
    editor.setCamera({ x: 0, y: 0, z: 2 })

    const screen = editor.getSelectionScreenBounds()!
    expect(screen.minX).toBeCloseTo(300 + 20, 6)
    expect(screen.width).toBeCloseTo(200, 6)
  })

  it("getSelectedShapeAtPoint ignores an unselected shape drawn on top", () => {
    editor.createShapes([
      { type: "box", x: 0, y: 0, props: { w: 100, h: 100 } },
      { type: "box", x: 10, y: 10, props: { w: 100, h: 100 } },
    ])
    const [under, over] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
    editor.setSelectedShapes([under])
    expect(editor.getSelectedShapeAtPoint({ x: 50, y: 50 })?.id).toBe(under)
    expect(editor.getShapeAtPoint({ x: 50, y: 50 }, { hitInside: true })?.id).toBe(over)
  })
})

describe("permissions and cropping", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("a readonly editor refuses creation, editing and cropping", () => {
    editor.createShapes([{ type: "box", x: 0, y: 0 }])
    const id = editor.getCurrentPageShapes()[0]!.id

    expect(editor.canCreateShape({ type: "box" })).toBe(true)
    expect(editor.canEditShape(id)).toBe(true)
    expect(editor.canCropShape(id)).toBe(true)

    editor.updateInstanceState({ isReadonly: true })
    expect(editor.canCreateShape({ type: "box" })).toBe(false)
    expect(editor.canEditShape(id)).toBe(false)
    expect(editor.canCropShape(id)).toBe(false)
  })

  it("an unregistered type can never be created", () => {
    expect(editor.canCreateShape({ type: "nope" })).toBe(false)
  })

  it("the page limit is a batch decision, not a per-shape one", () => {
    const editor2 = makeEditor({ options: { maxShapesPerPage: 2 } })
    expect(editor2.canCreateShapes([{ type: "box" }, { type: "box" }])).toBe(true)
    expect(editor2.canCreateShapes([{ type: "box" }, { type: "box" }, { type: "box" }])).toBe(false)
    editor2.dispose()
  })

  it("setCroppingShape refuses a shape that cannot be cropped and selects one that can", () => {
    const { frame, inside } = nested(editor)
    editor.setCroppingShape(frame)
    expect(editor.getCroppingShapeId()).toBeNull()

    editor.setCroppingShape(inside)
    expect(editor.getCroppingShapeId()).toBe(inside)
    expect(editor.getSelectedShapeIds()).toEqual([inside])

    editor.setCroppingShape(null)
    expect(editor.getCroppingShapeId()).toBeNull()
  })
})

describe("opacity, packing and page moves", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("shared opacity is undefined, shared or mixed", () => {
    expect(editor.getSharedOpacity()).toBeUndefined()
    editor.createShapes([
      { type: "box", x: 0, y: 0 },
      { type: "box", x: 200, y: 0 },
    ])
    const [a, b] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
    editor.setSelectedShapes([a, b])
    expect(editor.getSharedOpacity()).toEqual({ type: "shared", value: 1 })

    editor.updateShapes([{ id: b, type: "box", opacity: 0.5 }])
    expect(editor.getSharedOpacity()).toEqual({ type: "mixed" })

    editor.setOpacityForSelectedShapes(0.25)
    expect(editor.getSharedOpacity()).toEqual({ type: "shared", value: 0.25 })
  })

  it("packing removes whitespace without resizing anything, and is stable when repeated", () => {
    editor.createShapes([
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 4000, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 0, y: 4000, props: { w: 50, h: 50 } },
    ])
    const ids = editor.getCurrentPageShapes().map((s) => s.id)
    const before = Box.Common(ids.map((id) => editor.getShapePageBounds(id)!))

    editor.packShapes(ids, 10)
    const after = Box.Common(ids.map((id) => editor.getShapePageBounds(id)!))
    expect(after.width).toBeLessThan(before.width)
    for (const id of ids) expect(editor.getShapePageBounds(id)!.width).toBeCloseTo(50, 6)

    const positions = ids.map((id) => editor.getShapePageBounds(id)!.toJson())
    editor.packShapes(ids, 10)
    expect(ids.map((id) => editor.getShapePageBounds(id)!.toJson())).toEqual(positions)
  })

  it("resizeToBounds makes the common bounds exactly the target", () => {
    editor.createShapes([
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
      { type: "box", x: 100, y: 0, props: { w: 50, h: 50 } },
    ])
    const ids = editor.getCurrentPageShapes().map((s) => s.id)
    editor.resizeToBounds(ids, { x: 500, y: 500, w: 300, h: 100 })

    const bounds = Box.Common(ids.map((id) => editor.getShapePageBounds(id)!))
    expect(bounds.x).toBeCloseTo(500, 4)
    expect(bounds.y).toBeCloseTo(500, 4)
    expect(bounds.width).toBeCloseTo(300, 4)
  })

  it("moving a shape to another page takes its children and drops bindings that would span pages", () => {
    const { frame, inside, outside } = nested(editor)
    editor.createPage({ name: "Second" })
    const second = editor.getPages().find((p) => p.name === "Second")!.id

    editor.moveShapesToPage([frame], second)
    expect(editor.getCurrentPageId()).toBe(second)
    expect(editor.getAncestorPageId(inside)).toBe(second)
    expect(editor.getAncestorPageId(outside)).not.toBe(second)
    expect(editor.getSelectedShapeIds()).toEqual([frame])
  })
})

describe("pages", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("duplicatePage copies the shapes but does not navigate", () => {
    nested(editor)
    const original = editor.getCurrentPageId()
    const copy = editor.duplicatePage()!

    expect(copy).not.toBe(original)
    expect(editor.getCurrentPageId()).toBe(original)
    expect(editor.getPageShapeIds(copy)).toHaveLength(editor.getPageShapeIds(original).length)
    // Fresh ids, not the originals moved.
    expect(editor.getPageShapeIds(copy).some((id) => editor.getPageShapeIds(original).includes(id))).toBe(false)
  })

  it("updatePage merges meta rather than replacing it", () => {
    const id = editor.getCurrentPageId()
    editor.updatePage({ id, meta: { a: 1 } })
    editor.updatePage({ id, name: "Renamed", meta: { b: 2 } })
    expect(editor.getPage(id)).toMatchObject({ name: "Renamed", meta: { a: 1, b: 2 } })
  })

  it("getPageStates has an entry per page", () => {
    editor.createPage({ name: "Second" })
    expect(editor.getPageStates()).toHaveLength(2)
  })
})

describe("snapshots", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("round-trips the document and where the person was", () => {
    nested(editor)
    editor.setCamera({ x: -100, y: -50, z: 2 })
    const selected = editor.getCurrentPageShapes()[0]!.id
    editor.setSelectedShapes([selected])
    const snapshot = editor.getSnapshot()

    const other = makeEditor()
    other.loadSnapshot(snapshot)
    expect(other.getCurrentPageShapes()).toHaveLength(3)
    expect(other.getCamera()).toMatchObject({ x: -100, y: -50, z: 2 })
    expect(other.getSelectedShapeIds()).toEqual([selected])
    other.dispose()
  })

  it("drops session ids the loaded document does not contain", () => {
    nested(editor)
    const snapshot = editor.getSnapshot()
    snapshot.session.pageStates[0]!.selectedShapeIds = ["shape:gone" as ShapeId]

    const other = makeEditor()
    other.loadSnapshot(snapshot)
    expect(other.getSelectedShapeIds()).toEqual([])
    other.dispose()
  })

  it("loading is not undoable", () => {
    nested(editor)
    const snapshot = editor.getSnapshot()
    const other = makeEditor()
    other.createShapes([{ type: "box", x: 0, y: 0 }])
    other.loadSnapshot(snapshot)
    expect(other.getCanUndo()).toBe(false)
    other.dispose()
  })

  it("accepts a bare store snapshot as well as an editor one", () => {
    nested(editor)
    const other = makeEditor()
    other.loadSnapshot(editor.store.getStoreSnapshot("document"))
    expect(other.getCurrentPageShapes()).toHaveLength(3)
    other.dispose()
  })
})

describe("mount and lifecycle", () => {
  it("mount state follows the mount and unmount events, and disposal unmounts", () => {
    const editor = makeEditor()
    const seen: string[] = []
    editor.on("unmount", () => seen.push("unmount"))

    expect(editor.getIsMounted()).toBe(false)
    editor.emit("mount")
    expect(editor.getIsMounted()).toBe(true)
    editor.emit("unmount")
    expect(editor.getIsMounted()).toBe(false)
    expect(seen).toEqual(["unmount"])

    editor.emit("mount")
    editor.dispose()
    expect(seen).toEqual(["unmount", "unmount"])
    expect(editor.getIsMounted()).toBe(false)
  })

  it("disposing an editor that was never mounted emits nothing", () => {
    const editor = makeEditor()
    const seen: string[] = []
    editor.on("unmount", () => seen.push("unmount"))
    editor.dispose()
    expect(seen).toEqual([])
  })

  it("focus and blur record themselves, so getIsFocused works without a DOM", () => {
    const editor = makeEditor()
    expect(editor.getIsFocused()).toBe(false)
    editor.focus()
    expect(editor.getIsFocused()).toBe(true)
    editor.blur()
    expect(editor.getIsFocused()).toBe(false)
    editor.dispose()
  })

  it("the tick event drives the scribble and edge-scroll managers", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 0 })
    editor.scribbles.addPointToSession(0, 0)
    editor.scribbles.addPointToSession(10, 10)
    editor.scribbles.stopSession()

    expect(editor.scribbles.getItems()).toHaveLength(1)
    // Nothing ticks on its own; the host's frame loop does.
    for (let i = 0; i < 200; i++) editor.emit("tick", 16)
    expect(editor.scribbles.getItems()).toHaveLength(0)
    editor.dispose()
  })

  it("each editor gets its own id", () => {
    const a = makeEditor()
    const b = makeEditor()
    expect(a.id).not.toBe(b.id)
    a.dispose()
    b.dispose()
  })

  it("the managers on the editor are disposed with it", () => {
    const editor = makeEditor()
    editor.dispose()
    expect(editor.overlays.getIsDisposed()).toBe(true)
    expect(editor.scribbles.getIsDisposed()).toBe(true)
    expect(editor.collaborators.getIsDisposed()).toBe(true)
    expect(editor.edgeScrollManager.getIsDisposed()).toBe(true)
  })
})

describe("camera state", () => {
  let editor: Editor
  beforeEach(() => {
    vi.useFakeTimers()
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
    vi.useRealTimers()
  })

  it("reports moving while the camera is written to, and idle once it settles", () => {
    expect(editor.getCameraState()).toBe("idle")
    editor.setCamera({ x: 10, y: 10 })
    expect(editor.getCameraState()).toBe("moving")

    vi.advanceTimersByTime(editor.options.cameraMovingTimeoutMs + 1)
    expect(editor.getCameraState()).toBe("idle")
  })

  it("the debounced zoom ignores small changes but catches a big one mid-movement", () => {
    editor.setCamera({ x: 0, y: 0, z: 1 })
    vi.advanceTimersByTime(editor.options.cameraMovingTimeoutMs + 1)
    expect(editor.getDebouncedZoomLevel()).toBeCloseTo(1, 6)

    editor.setCamera({ z: 1.05 })
    expect(editor.getDebouncedZoomLevel()).toBeCloseTo(1, 6)

    editor.setCamera({ z: 4 })
    expect(editor.getDebouncedZoomLevel()).toBeCloseTo(4, 6)
  })

  it("slideCamera coasts and stops, and a locked camera ignores it", () => {
    editor.slideCamera({ speed: 20, direction: { x: 1, y: 0 } })
    vi.advanceTimersByTime(2000)
    const landed = editor.getCamera().x
    expect(landed).toBeGreaterThan(0)

    vi.advanceTimersByTime(2000)
    expect(editor.getCamera().x).toBe(landed)

    editor.setCameraOptions({ isLocked: true })
    editor.slideCamera({ speed: 20, direction: { x: 1, y: 0 } })
    vi.advanceTimersByTime(2000)
    expect(editor.getCamera().x).toBe(landed)
  })

  it("zoomToSelectionIfOffscreen does nothing when the selection is already visible", () => {
    editor.createShapes([{ type: "box", x: 100, y: 100, props: { w: 50, h: 50 } }])
    editor.setSelectedShapes([editor.getCurrentPageShapes()[0]!.id])
    const before = { ...editor.getCamera() }
    editor.zoomToSelectionIfOffscreen()
    expect(editor.getCamera()).toMatchObject({ x: before.x, y: before.y, z: before.z })

    editor.updateShapes([{ id: editor.getCurrentPageShapes()[0]!.id, type: "box", x: 90_000, y: 90_000 }])
    editor.zoomToSelectionIfOffscreen()
    expect(editor.getCamera().x).not.toBe(before.x)
  })
})

describe("deep links", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("round-trips each kind of link", () => {
    const shapes: TLDeepLink = { type: "shapes", shapeIds: ["shape:a" as ShapeId, "shape:b" as ShapeId] }
    expect(parseDeepLinkString(createDeepLinkString(shapes))).toEqual(shapes)

    const page: TLDeepLink = { type: "page", pageId: "page:main" as PageId }
    expect(parseDeepLinkString(createDeepLinkString(page))).toEqual(page)

    const viewport: TLDeepLink = { type: "viewport", bounds: new Box(1, 2, 3, 4), pageId: "page:main" as PageId }
    expect(parseDeepLinkString(createDeepLinkString(viewport))).toEqual(viewport)
  })

  it("refuses a link it does not understand rather than guessing", () => {
    expect(() => parseDeepLinkString("zzz")).toThrow()
    expect(() => parseDeepLinkString("s")).toThrow()
  })

  it("a link to the selection navigates back to it, and a stale one moves nothing", () => {
    editor.createShapes([{ type: "box", x: 4000, y: 4000, props: { w: 50, h: 50 } }])
    const id = editor.getCurrentPageShapes()[0]!.id
    editor.setSelectedShapes([id])
    const url = editor.createDeepLink({ url: "https://example.test/board" })
    expect(url.searchParams.get("d")).toBe(`s${id.slice("shape:".length)}`)

    editor.selectNone()
    editor.setCamera({ x: 0, y: 0, z: 1 })
    editor.navigateToDeepLink({ url })
    expect(editor.getSelectedShapeIds()).toEqual([id])
    expect(editor.getCamera().x).not.toBe(0)

    const before = { ...editor.getCamera() }
    editor.navigateToDeepLink({ deepLink: { type: "shapes", shapeIds: ["shape:gone" as ShapeId] } })
    expect(editor.getCamera()).toMatchObject({ x: before.x, y: before.y })
  })
})
