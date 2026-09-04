import { describe, expect, it, vi } from "vitest"
import type { Editor } from "../editor/Editor"
import type { UnknownShape } from "../records/base"
import { BaseFrameLikeShapeUtil, type FrameLikeShape } from "./BaseFrameLikeShapeUtil"
import { dropShapesOnFrameLike, getFrameLikeDropTarget } from "./frame-like"
import type { ShapeUtil } from "./ShapeUtil"

type Box = FrameLikeShape

function shape(id: string, over: Record<string, unknown> = {}): UnknownShape {
  return {
    id,
    typeName: "shape",
    type: "box",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:main",
    isLocked: false,
    opacity: 1,
    props: { w: 100, h: 100 },
    meta: {},
    ...over,
  } as unknown as UnknownShape
}

/** The plain container: everything from the base, nothing overridden. */
class TestFrameUtil extends BaseFrameLikeShapeUtil<Box> {
  static override type = "frame"
  override getDefaultProps(): Box["props"] {
    return { w: 100, h: 100 }
  }
  override getGeometry(): never {
    throw new Error("not used")
  }
  override component(): null {
    return null
  }
}

/** The grouping container: same behaviour, minus the crop. */
class TestSectionUtil extends TestFrameUtil {
  static override type = "section"
  override getClipPath(): undefined {
    return undefined
  }
}

interface StubOptions {
  shapes?: UnknownShape[]
  ancestors?: Record<string, UnknownShape[]>
}

function makeEditor(opts: StubOptions = {}) {
  const shapes = new Map<string, UnknownShape>((opts.shapes ?? []).map((s) => [s.id as string, s]))
  const reparentShapes = vi.fn()
  const editor = {
    reparentShapes,
    getShape: (id: string) => shapes.get(id),
    getShapeAncestors: (s: UnknownShape) => opts.ancestors?.[s.id] ?? [],
    getCurrentPageId: () => "page:main",
    getCurrentPageShapesSorted: () => [...shapes.values()],
    getSortedChildIdsForParent: (id: string) => [...shapes.values()].filter((s) => s.parentId === id).map((s) => s.id),
    getShapePageBounds: (s: UnknownShape) => {
      const props = s.props as { w: number; h: number }
      return { x: s.x, y: s.y, maxX: s.x + props.w, maxY: s.y + props.h }
    },
    getShapeUtil: (s: UnknownShape) => (s.type === "section" ? sectionUtil : s.type === "frame" ? frameUtil : leafUtil),
  }
  const frameUtil = new TestFrameUtil(editor as unknown as Editor)
  const sectionUtil = new TestSectionUtil(editor as unknown as Editor)
  const leafUtil = { isFrameLike: () => false, canDropShapes: () => false, canRemoveChildrenOfType: () => false } as unknown as ShapeUtil
  return { editor: editor as unknown as Editor, reparentShapes, frameUtil, sectionUtil }
}

describe("BaseFrameLikeShapeUtil", () => {
  it("is frame-like and clips to its own box", () => {
    const { frameUtil } = makeEditor()
    const frame = shape("shape:f", { type: "frame", props: { w: 200, h: 120 } }) as Box
    expect(frameUtil.isFrameLike(frame)).toBe(true)
    expect(frameUtil.providesBackgroundForChildren(frame)).toBe(true)
    expect(frameUtil.isClipShape(frame)).toBe(true)
    expect(frameUtil.getClipPath(frame)).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ])
  })

  it("stops clipping when getClipPath is overridden away, and stays frame-like", () => {
    // The section's whole override: it groups, it does not crop. `isClipShape`
    // is derived from `getClipPath`, so the one method is the whole change.
    const { sectionUtil } = makeEditor()
    const section = shape("shape:s", { type: "section" }) as Box
    expect((sectionUtil as BaseFrameLikeShapeUtil<Box>).getClipPath(section)).toBeUndefined()
    expect(sectionUtil.isClipShape(section)).toBe(false)
    expect(sectionUtil.isFrameLike(section)).toBe(true)
  })

  it("closes admission, removal and drops while locked", () => {
    const { frameUtil } = makeEditor()
    const locked = shape("shape:f", { type: "frame", isLocked: true }) as Box
    expect(frameUtil.canReceiveNewChildrenOfType(locked, "geo")).toBe(false)
    expect(frameUtil.canRemoveChildrenOfType(locked, "geo")).toBe(false)
    expect(frameUtil.canDropShapes(locked, [])).toBe(false)
  })

  it("adopts shapes dragged in, skipping locked ones", () => {
    const frame = shape("shape:f", { type: "frame" }) as Box
    const free = shape("shape:a")
    const locked = shape("shape:b", { isLocked: true })
    const { frameUtil, reparentShapes } = makeEditor({ shapes: [frame, free, locked] })
    frameUtil.onDragShapesIn(frame, [free, locked])
    expect(reparentShapes).toHaveBeenCalledWith(["shape:a"], "shape:f")
  })

  it("refuses to adopt one of its own ancestors", () => {
    // Reparenting an ancestor into its descendant makes a cycle in the shape
    // tree, which no later operation can recover from.
    const outer = shape("shape:outer", { type: "frame" })
    const inner = shape("shape:inner", { type: "frame", parentId: "shape:outer" }) as Box
    const { editor, reparentShapes } = makeEditor({ shapes: [outer, inner], ancestors: { "shape:inner": [outer] } })
    const util = new TestFrameUtil(editor)
    util.onDragShapesIn(inner, [outer])
    expect(reparentShapes).not.toHaveBeenCalled()
  })

  it("releases children onto its own parent when dragged out", () => {
    const frame = shape("shape:f", { type: "frame" }) as Box
    const child = shape("shape:c", { parentId: "shape:f" })
    const { frameUtil, reparentShapes } = makeEditor({ shapes: [frame, child] })
    frameUtil.onDragShapesOut(frame, [child])
    expect(reparentShapes).toHaveBeenCalledWith(["shape:c"], "page:main")
  })
})

describe("getFrameLikeDropTarget", () => {
  it("picks the topmost container under the point", () => {
    const back = shape("shape:back", { type: "frame", x: 0, y: 0, props: { w: 500, h: 500 } })
    const front = shape("shape:front", { type: "section", x: 100, y: 100, props: { w: 200, h: 200 } })
    const { editor } = makeEditor({ shapes: [back, front] })
    expect(getFrameLikeDropTarget(editor, { x: 150, y: 150 }, [])?.id).toBe("shape:front")
    expect(getFrameLikeDropTarget(editor, { x: 50, y: 50 }, [])?.id).toBe("shape:back")
    expect(getFrameLikeDropTarget(editor, { x: 900, y: 900 }, [])).toBeUndefined()
  })

  it("never targets a container being dragged, or one inside it", () => {
    const outer = shape("shape:outer", { type: "frame", props: { w: 500, h: 500 } })
    const inner = shape("shape:inner", { type: "frame", parentId: "shape:outer", props: { w: 200, h: 200 } })
    const { editor } = makeEditor({ shapes: [outer, inner] })
    expect(getFrameLikeDropTarget(editor, { x: 50, y: 50 }, [outer])).toBeUndefined()
  })

  it("ignores a shape that is not frame-like", () => {
    const leaf = shape("shape:leaf", { props: { w: 500, h: 500 } })
    const { editor } = makeEditor({ shapes: [leaf] })
    expect(getFrameLikeDropTarget(editor, { x: 50, y: 50 }, [])).toBeUndefined()
  })
})

describe("dropShapesOnFrameLike", () => {
  it("moves a page-level shape into the container", () => {
    const frame = shape("shape:f", { type: "frame" })
    const loose = shape("shape:a")
    const { editor, reparentShapes } = makeEditor({ shapes: [frame, loose] })
    dropShapesOnFrameLike(editor, frame, [loose])
    expect(reparentShapes).toHaveBeenCalledWith(["shape:a"], "shape:f")
  })

  it("puts a child back on the page when it is dropped over nothing", () => {
    const frame = shape("shape:f", { type: "frame" })
    const child = shape("shape:a", { parentId: "shape:f" })
    const { editor, reparentShapes } = makeEditor({ shapes: [frame, child] })
    dropShapesOnFrameLike(editor, undefined, [child])
    expect(reparentShapes).toHaveBeenCalledWith(["shape:a"], "page:main")
  })

  it("keeps a child a locked container refuses to release", () => {
    const frame = shape("shape:f", { type: "frame", isLocked: true })
    const child = shape("shape:a", { parentId: "shape:f" })
    const { editor, reparentShapes } = makeEditor({ shapes: [frame, child] })
    dropShapesOnFrameLike(editor, undefined, [child])
    expect(reparentShapes).not.toHaveBeenCalled()
  })

  it("does nothing when the shapes are already where they were dropped", () => {
    const frame = shape("shape:f", { type: "frame" })
    const child = shape("shape:a", { parentId: "shape:f" })
    const { editor, reparentShapes } = makeEditor({ shapes: [frame, child] })
    dropShapesOnFrameLike(editor, frame, [child])
    expect(reparentShapes).not.toHaveBeenCalled()
  })
})
