import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { COLLABORATOR_INACTIVE_TIMEOUT, DEFAULT_PAGE_ID, Editor } from "../Editor"
import { createStore } from "../createStore"
import { Timers } from "../Timers"
import { getOwnerDocument, getOwnerWindow } from "../container"
import { getBaseZoomForCameraOptions, DEFAULT_CAMERA_OPTIONS } from "../CameraOptions"
import { ZERO_INDEX_KEY } from "@mocanvas/store"
import { Rectangle2d } from "../../geometry"
import { InstancePresenceRecordType } from "../../records/presence"
import { PageRecordType, type BaseShape, type ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"
import { createUserId } from "../../user/userRecord"

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
  override getRenderStyle(): StyleWords {
    return { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

/** A frame-like parent: it clips whatever is inside it. */
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
  override getRenderStyle(): StyleWords {
    return { fill: 0x00ff00ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

/** A container that groups without clipping, the way a `section` does. */
class SectionUtil extends BaseBoxShapeUtil<FrameShape> {
  static override type = "section" as const
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
  override getRenderStyle(): StyleWords {
    return { fill: 0x0000ffff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil, FrameUtil, SectionUtil],
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

describe("coordinate spaces", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("pageToViewport is container-relative: it ignores where the container sits in the window", () => {
    editor.setCamera({ x: 0, y: 0, z: 2 })
    // The same canvas, once flush against the window and once pushed right by a
    // 300px rail and down by a 68px header.
    editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
    const flush = editor.pageToViewport({ x: 10, y: 20 })
    editor.updateViewportScreenBounds({ x: 300, y: 68, w: 1000, h: 800 })
    const inset = editor.pageToViewport({ x: 10, y: 20 })

    expect(flush).toMatchObject({ x: 20, y: 40 })
    expect(inset).toMatchObject({ x: 20, y: 40 })
  })

  it("pageToScreen is window-relative: it is pageToViewport plus the container offset", () => {
    editor.setCamera({ x: 0, y: 0, z: 2 })
    editor.updateViewportScreenBounds({ x: 300, y: 68, w: 1000, h: 800 })

    expect(editor.pageToViewport({ x: 10, y: 20 })).toMatchObject({ x: 20, y: 40 })
    expect(editor.pageToScreen({ x: 10, y: 20 })).toMatchObject({ x: 320, y: 108 })
  })

  it("the two spaces coincide only when the container is at the window origin", () => {
    editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
    // This is the trap the consumer's own tests call out: with the container at
    // 0,0 a value-only assertion cannot tell the two APIs apart.
    expect(editor.pageToScreen({ x: 7, y: 9 })).toMatchObject(editor.pageToViewport({ x: 7, y: 9 }))
  })

  it("round-trips each space through its own inverse", () => {
    editor.updateViewportScreenBounds({ x: 300, y: 68, w: 1000, h: 800 })
    editor.setCamera({ x: -40, y: 15, z: 0.75 })

    const page = { x: 123, y: -45 }
    expect(editor.viewportToPage(editor.pageToViewport(page))).toMatchObject(page)
    expect(editor.screenToPage(editor.pageToScreen(page))).toMatchObject(page)

    // …and crossing them is off by exactly the container offset, never by zero.
    const crossed = editor.viewportToPage(editor.pageToScreen(page))
    expect(crossed.x).toBeCloseTo(page.x + 300 / 0.75, 6)
    expect(crossed.y).toBeCloseTo(page.y + 68 / 0.75, 6)
  })

  it("keeps pointer input in viewport space, so an offset container still hits the right page point", () => {
    editor.updateViewportScreenBounds({ x: 300, y: 68, w: 1000, h: 800 })
    editor.dispatch({
      type: "pointer",
      name: "pointer_move",
      point: { x: 100, y: 100, z: 0.5 },
      pointerId: 1,
      button: 0,
      isPen: false,
      target: "canvas",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
    })
    // Container-relative in, page-space out — the rail offset must not be
    // subtracted a second time.
    expect(editor.inputs.currentPagePoint).toMatchObject({ x: 100, y: 100 })
  })
})

describe("camera options", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("starts from the editor's own zoom steps and merges partial updates", () => {
    expect(editor.getCameraOptions().zoomSteps).toEqual(editor.options.zoomSteps)
    expect(editor.getCameraOptions().isLocked).toBe(false)

    editor.setCameraOptions({ isLocked: true })
    expect(editor.getCameraOptions().isLocked).toBe(true)
    expect(editor.getCameraOptions().zoomSteps).toEqual(editor.options.zoomSteps)
  })

  it("a locked camera ignores moves unless they are forced", () => {
    editor.setCameraOptions({ isLocked: true })
    editor.setCamera({ x: 50, y: 50 })
    expect(editor.getCamera()).toMatchObject({ x: 0, y: 0 })

    editor.setCamera({ x: 50, y: 50 }, { force: true })
    expect(editor.getCamera()).toMatchObject({ x: 50, y: 50 })
  })

  it("base zoom is 1 without constraints and a fit of the bounds with them", () => {
    expect(editor.getBaseZoom()).toBe(1)

    // 1000x800 viewport, 500x800 bounds: fitting the width doubles, fitting the
    // height leaves it alone. `fit-max` contains, `fit-min` covers.
    const constraints = { bounds: { x: 0, y: 0, w: 500, h: 800 }, baseZoom: "fit-max" as const }
    editor.setCameraOptions({ constraints })
    expect(editor.getBaseZoom()).toBe(1)

    editor.setCameraOptions({ constraints: { ...constraints, baseZoom: "fit-min" } })
    expect(editor.getBaseZoom()).toBe(2)

    editor.setCameraOptions({ constraints: { ...constraints, baseZoom: "fit-x" } })
    expect(editor.getBaseZoom()).toBe(2)
  })

  it("computes the zoom clamp the way a host reading zoomSteps x baseZoom expects", () => {
    editor.setCameraOptions({
      zoomSteps: [0.1, 1, 8],
      constraints: { bounds: { x: 0, y: 0, w: 500, h: 800 }, baseZoom: "fit-x" },
    })
    const steps = editor.getCameraOptions().zoomSteps
    const base = editor.getBaseZoom()
    expect([steps[0]! * base, steps[steps.length - 1]! * base]).toEqual([0.2, 16])
  })

  it("padding shrinks the usable viewport before fitting", () => {
    expect(
      getBaseZoomForCameraOptions(
        { ...DEFAULT_CAMERA_OPTIONS, constraints: { bounds: { x: 0, y: 0, w: 100, h: 100 }, baseZoom: "fit-x", padding: 50 } },
        { w: 400, h: 400 },
      ),
    ).toBe(3)
  })
})

describe("camera animation", () => {
  let editor: Editor
  beforeEach(() => {
    vi.useFakeTimers()
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
    vi.useRealTimers()
  })

  it("eases to the target instead of jumping, and lands exactly on it", () => {
    editor.setCamera({ x: 100, y: 0 }, { animation: { duration: 200 } })
    // Nothing has moved yet: the first frame has not run.
    expect(editor.getCamera().x).toBe(0)

    vi.advanceTimersByTime(100)
    const midway = editor.getCamera().x
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(100)

    vi.advanceTimersByTime(200)
    expect(editor.getCamera().x).toBe(100)
  })

  it("stopCameraAnimation leaves the camera where the interruption found it", () => {
    editor.setCamera({ x: 1000, y: 0 }, { animation: { duration: 400 } })
    vi.advanceTimersByTime(200)
    const interrupted = editor.getCamera().x
    editor.stopCameraAnimation()

    vi.advanceTimersByTime(1000)
    expect(editor.getCamera().x).toBe(interrupted)
    expect(interrupted).toBeLessThan(1000)
  })

  it("a new camera move abandons the one in flight", () => {
    editor.setCamera({ x: 1000, y: 0 }, { animation: { duration: 400 } })
    vi.advanceTimersByTime(100)
    editor.setCamera({ x: -5, y: -5 })

    vi.advanceTimersByTime(1000)
    expect(editor.getCamera()).toMatchObject({ x: -5, y: -5 })
  })

  it("immediate overrides an animation request", () => {
    editor.setCamera({ x: 42, y: 0 }, { animation: { duration: 400 }, immediate: true })
    expect(editor.getCamera().x).toBe(42)
  })
})

describe("getResizeScaleFactor", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("is 1 for a user with no dynamic-size preference", () => {
    editor.setCamera({ x: 0, y: 0, z: 2 })
    expect(editor.getResizeScaleFactor()).toBe(1)
  })

  it("is 1 / zoom in dynamic-size mode, so placements keep their on-screen size", () => {
    editor.user.updateUserPreferences({ isDynamicSizeMode: true })

    editor.setCamera({ x: 0, y: 0, z: 2 })
    expect(editor.getResizeScaleFactor()).toBe(0.5)
    editor.setCamera({ x: 0, y: 0, z: 0.1 })
    expect(editor.getResizeScaleFactor()).toBe(10)
  })
})

describe("shape ancestry and masks", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  function nest(): { outer: ShapeId; inner: ShapeId; child: ShapeId } {
    editor.createShapes([
      { type: "frame", x: 0, y: 0, props: { w: 400, h: 400 } },
      { type: "frame", x: 100, y: 100, props: { w: 400, h: 400 } },
      { type: "box", x: 120, y: 120, props: { w: 50, h: 50 } },
    ])
    const [outer, inner, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]
    editor.reparentShapes([inner], outer)
    editor.reparentShapes([child], inner)
    return { outer, inner, child }
  }

  it("lists ancestors outermost first", () => {
    const { outer, inner, child } = nest()
    expect(editor.getShapeAncestors(child).map((s) => s.id)).toEqual([outer, inner])
    expect(editor.getShapeAncestors(outer)).toEqual([])
  })

  it("accepts a record as well as an id, and shrugs at a shape that is gone", () => {
    const { inner, child } = nest()
    const record = editor.getShape(child)!
    expect(editor.getShapeAncestors(record).map((s) => s.id)).toContain(inner)
    expect(editor.getShapeAncestors("shape:nope" as ShapeId)).toEqual([])
  })

  it("returns no mask when nothing above the shape clips", () => {
    editor.createShapes([
      { type: "section", x: 0, y: 0, props: { w: 400, h: 400 } },
      { type: "box", x: 150, y: 150, props: { w: 200, h: 200 } },
    ])
    const [section, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
    editor.reparentShapes([child], section)

    // A frame would return a clipped polygon here; a section clips nothing.
    expect(editor.getShapeMask(child)).toBeUndefined()
  })

  it("returns the clipping ancestor's page-space rectangle", () => {
    editor.createShapes([
      { type: "frame", x: 10, y: 20, props: { w: 400, h: 300 } },
      { type: "box", x: 0, y: 0, props: { w: 50, h: 50 } },
    ])
    const [frame, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId]
    editor.reparentShapes([child], frame)

    const mask = editor.getShapeMask(child)
    expect(mask).toBeDefined()
    expect(mask).toHaveLength(4)
    const xs = mask!.map((p) => p.x)
    const ys = mask!.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(10, 6)
    expect(Math.max(...xs)).toBeCloseTo(410, 6)
    expect(Math.min(...ys)).toBeCloseTo(20, 6)
    expect(Math.max(...ys)).toBeCloseTo(320, 6)
  })

  it("intersects two clipping ancestors down to their overlap", () => {
    const { child } = nest()
    const mask = editor.getShapeMask(child)
    expect(mask).toBeDefined()
    const xs = mask!.map((p) => p.x)
    const ys = mask!.map((p) => p.y)
    // outer 0..400 intersected with inner 100..500 is 100..400 on both axes.
    expect(Math.min(...xs)).toBeCloseTo(100, 6)
    expect(Math.max(...xs)).toBeCloseTo(400, 6)
    expect(Math.min(...ys)).toBeCloseTo(100, 6)
    expect(Math.max(...ys)).toBeCloseTo(400, 6)
  })

  it("reports an empty polygon — not 'unclipped' — for disjoint clips", () => {
    editor.createShapes([
      { type: "frame", x: 0, y: 0, props: { w: 100, h: 100 } },
      { type: "frame", x: 1000, y: 1000, props: { w: 100, h: 100 } },
      { type: "box", x: 0, y: 0, props: { w: 10, h: 10 } },
    ])
    const [a, b, child] = editor.getCurrentPageShapes().map((s) => s.id) as [ShapeId, ShapeId, ShapeId]
    editor.reparentShapes([b], a)
    editor.reparentShapes([child], b)

    expect(editor.getShapeMask(child)).toEqual([])
  })
})

describe("state and lifecycle", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("exposes readonly as a reactive read of instance state", () => {
    expect(editor.getIsReadonly()).toBe(false)
    editor.updateInstanceState({ isReadonly: true })
    expect(editor.getIsReadonly()).toBe(true)
    editor.dispose()
  })

  it("sets the cursor and leaves untouched components alone", () => {
    editor.setCursor({ type: "cross", rotation: 0 })
    expect(editor.getCursor()).toEqual({ type: "cross", rotation: 0 })
    editor.setCursor({ rotation: 1 })
    expect(editor.getCursor()).toEqual({ type: "cross", rotation: 1 })
    editor.dispose()
  })

  it("clearHistory drops the undo stack without touching the document", () => {
    editor.markHistoryStoppingPoint()
    editor.createShapes([{ type: "box", x: 0, y: 0 }])
    expect(editor.getCanUndo()).toBe(true)

    editor.clearHistory()

    expect(editor.getCanUndo()).toBe(false)
    expect(editor.getCurrentPageShapes()).toHaveLength(1)
    editor.dispose()
  })

  it("isDisposed flips with dispose() and agrees with getIsDisposed()", () => {
    expect(editor.isDisposed).toBe(false)
    editor.dispose()
    expect(editor.isDisposed).toBe(true)
    expect(editor.getIsDisposed()).toBe(true)
  })

  it("marks an event as handled through either its synthetic or its native form", () => {
    const native = { type: "pointerdown" }
    const synthetic = { nativeEvent: native }

    expect(editor.isEventHandled(synthetic)).toBe(false)
    editor.markEventAsHandled(synthetic)
    expect(editor.isEventHandled(synthetic)).toBe(true)
    // The same underlying event, arriving as a bare native one.
    expect(editor.isEventHandled(native as unknown as Event)).toBe(true)
    expect(editor.isEventHandled(null)).toBe(false)
    editor.dispose()
  })

  it("cancels every timer it scheduled when the editor is disposed", () => {
    vi.useFakeTimers()
    const ran: string[] = []
    editor.timers.setTimeout(() => ran.push("timeout"), 10)
    editor.timers.setInterval(() => ran.push("interval"), 10)
    editor.timers.requestAnimationFrame(() => ran.push("frame"))

    editor.dispose()
    vi.advanceTimersByTime(1000)

    expect(ran).toEqual([])
    vi.useRealTimers()
  })
})

describe("hinting", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("marks drop targets and clears them again", () => {
    editor.createShapes([{ type: "box", x: 0, y: 0 }])
    const id = editor.getCurrentPageShapes()[0]!.id

    expect(editor.getHintingShapeIds()).toEqual([])
    editor.setHintingShapes([id])
    expect(editor.getHintingShapeIds()).toEqual([id])
    expect(editor.getHintingShapes().map((s) => s.id)).toEqual([id])

    editor.setHintingShapes([])
    expect(editor.getHintingShapeIds()).toEqual([])
  })

  it("accepts records, and skips the write when nothing changed", () => {
    editor.createShapes([{ type: "box", x: 0, y: 0 }])
    const shape = editor.getCurrentPageShapes()[0]!
    editor.setHintingShapes([shape])
    const before = editor.getCurrentPageState()
    editor.setHintingShapes([shape.id])
    expect(editor.getCurrentPageState()).toBe(before)
  })

  it("drops hints for a shape that no longer exists", () => {
    editor.createShapes([{ type: "box", x: 0, y: 0 }])
    const id = editor.getCurrentPageShapes()[0]!.id
    editor.setHintingShapes([id])
    editor.deleteShape(id)
    expect(editor.getHintingShapes()).toEqual([])
  })
})

describe("collaboration", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  function addCollaborator(name: string, lastActivityTimestamp: number): void {
    const userId = createUserId(name)
    editor.store.put([
      InstancePresenceRecordType.create({
        id: InstancePresenceRecordType.createId(name),
        userId,
        currentPageId: editor.getCurrentPageId(),
        lastActivityTimestamp,
      }),
    ])
  }

  it("hides collaborators who stopped refreshing their presence", () => {
    const now = Date.now()
    addCollaborator("live", now)
    addCollaborator("stale", now - COLLABORATOR_INACTIVE_TIMEOUT - 1)

    expect(editor.getCollaboratorsOnCurrentPage().map((c) => c.userId).sort()).toEqual(["user:live", "user:stale"])
    expect(editor.getVisibleCollaboratorsOnCurrentPage().map((c) => c.userId)).toEqual(["user:live"])
  })

  it("treats another instance of the same person as a collaborator", () => {
    // Two tabs of one browser are one *user* and two *instances*. The presence
    // filter is about not drawing our own cursor, which is an instance
    // question; filtering by user id made two tabs invisible to each other.
    editor.store.put([
      InstancePresenceRecordType.create({
        id: InstancePresenceRecordType.createId("other-tab"),
        userId: editor.user.getId(),
        userName: "me, elsewhere",
        currentPageId: editor.getCurrentPageId(),
        lastActivityTimestamp: Date.now(),
      }),
    ])

    expect(editor.getVisibleCollaboratorsOnCurrentPage().map((c) => c.userName)).toEqual(["me, elsewhere"])
  })

  it("drops this instance's own presence record, whoever wrote it", () => {
    editor.store.put([
      InstancePresenceRecordType.create({
        id: editor.getInstancePresenceId(),
        userId: editor.user.getId(),
        currentPageId: editor.getCurrentPageId(),
        lastActivityTimestamp: Date.now(),
      }),
    ])

    expect(editor.getCollaborators()).toEqual([])
  })

  it("gives every editor instance a presence id of its own", () => {
    const other = makeEditor()
    try {
      expect(editor.getInstancePresenceId()).not.toBe(other.getInstancePresenceId())
      expect(editor.getInstancePresenceId()).toMatch(/^instance_presence:/)
    } finally {
      other.dispose()
    }
  })

  it("hides collaborators looking at another page, however active they are", () => {
    addCollaborator("elsewhere", Date.now())
    editor.createPage({ name: "other" })
    const other = editor.getPages().find((p) => p.name === "other")!
    editor.setCurrentPage(other.id)

    expect(editor.getVisibleCollaboratorsOnCurrentPage()).toEqual([])
  })

  it("follows and unfollows a user id", () => {
    expect(editor.getFollowingUserId()).toBeNull()
    editor.startFollowingUser(createUserId("someone"))
    expect(editor.getFollowingUserId()).toBe("user:someone")
    editor.stopFollowingUser()
    expect(editor.getFollowingUserId()).toBeNull()
  })

  it("refuses to follow yourself", () => {
    editor.startFollowingUser(editor.user.getId())
    expect(editor.getFollowingUserId()).toBeNull()
  })

  /** Puts `name` on this page with `selectedShapeIds` and a cursor. */
  function addCollaboratorAt(
    name: string,
    selectedShapeIds: ShapeId[],
    cursor: { x: number; y: number } | null,
  ): void {
    editor.store.put([
      InstancePresenceRecordType.create({
        id: InstancePresenceRecordType.createId(name),
        userId: createUserId(name),
        currentPageId: editor.getCurrentPageId(),
        selectedShapeIds,
        cursor: cursor ? { ...cursor, type: "default", rotation: 0 } : null,
        lastActivityTimestamp: Date.now(),
      }),
    ])
  }

  it("zooms to what a collaborator has selected", () => {
    editor.createShapes([{ type: "box", x: 800, y: 800, props: { w: 100, h: 100 } }])
    const id = editor.getCurrentPageShapes()[0]!.id
    addCollaboratorAt("ada", [id], { x: 0, y: 0 })

    editor.zoomToUser(createUserId("ada"))

    // The shape they have selected is now inside the viewport.
    const viewport = editor.getViewportPageBounds()
    const bounds = editor.getShapePageBounds(id)!
    expect(viewport.x).toBeLessThanOrEqual(bounds.x + 1)
    expect(viewport.y).toBeLessThanOrEqual(bounds.y + 1)
    expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(bounds.x + bounds.w - 1)
  })

  it("centres on their cursor when they have nothing selected", () => {
    addCollaboratorAt("ada", [], { x: 500, y: 400 })
    const zoom = editor.getZoomLevel()

    editor.zoomToUser(createUserId("ada"))

    const centre = editor.getViewportPageBounds().center
    expect(centre.x).toBeCloseTo(500, 5)
    expect(centre.y).toBeCloseTo(400, 5)
    // A cursor is a point, so there is nothing to fit: the zoom is left alone.
    expect(editor.getZoomLevel()).toBe(zoom)
  })

  it("does nothing for somebody who is not here", () => {
    const before = editor.getCamera()
    editor.zoomToUser(createUserId("nobody"))
    expect(editor.getCamera()).toEqual(before)
  })

  it("does nothing for somebody with neither a selection nor a cursor", () => {
    addCollaboratorAt("ada", [], null)
    const before = editor.getCamera()
    editor.zoomToUser(createUserId("ada"))
    expect(editor.getCamera()).toEqual(before)
  })
})

describe("container realm", () => {
  it("resolves the document and window the container is painted in", () => {
    const win = { name: "iframe-window" } as unknown as Window
    const doc = { defaultView: win } as unknown as Document
    const el = { ownerDocument: doc } as unknown as Element

    expect(getOwnerDocument(el)).toBe(doc)
    expect(getOwnerWindow(el)).toBe(win)
  })

  it("says nothing rather than guessing when there is no DOM", () => {
    // The package's tests run in node, where there is no ambient document.
    expect(getOwnerDocument(null)).toBeUndefined()
    expect(getOwnerWindow(null)).toBeUndefined()
  })

  it("survives a getContainer that throws, the way a torn-down host does", () => {
    const engine = loadEngineSync(readFileSync(wasmPath))
    const editor = new Editor({
      store: createStore(),
      shapeUtils: [BoxUtil],
      tools: [TestTool],
      engine,
      getContainer: () => {
        throw new Error("editor is gone")
      },
    })
    expect(editor.getContainerDocument()).toBeUndefined()
    expect(editor.getContainerWindow()).toBeUndefined()
    editor.dispose()
  })
})

describe("Timers", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("falls back to a timeout where the realm has no requestAnimationFrame", () => {
    vi.useFakeTimers()
    const timers = new Timers()
    let ran = false
    timers.requestAnimationFrame(() => {
      ran = true
    })
    vi.advanceTimersByTime(20)
    expect(ran).toBe(true)
    expect(timers.getPendingCount()).toBe(0)
  })

  it("uses the supplied window's animation frames when it has them", () => {
    const queue: ((time: number) => void)[] = []
    const win = {
      requestAnimationFrame: (fn: (time: number) => void) => queue.push(fn),
      cancelAnimationFrame: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
    } as unknown as Window
    const timers = new Timers(() => win)

    let ran = false
    timers.requestAnimationFrame(() => {
      ran = true
    })
    expect(queue).toHaveLength(1)
    queue[0]!(0)
    expect(ran).toBe(true)
  })

  it("clears an individual handle and ignores an unknown one", () => {
    vi.useFakeTimers()
    const timers = new Timers()
    let ran = 0
    const handle = timers.setTimeout(() => ran++, 10)
    timers.clearTimeout(handle)
    timers.clearTimeout(9999)
    vi.advanceTimersByTime(100)
    expect(ran).toBe(0)
  })

  it("stops repeating intervals on dispose", () => {
    vi.useFakeTimers()
    const timers = new Timers()
    let ticks = 0
    timers.setInterval(() => ticks++, 10)
    vi.advanceTimersByTime(35)
    expect(ticks).toBe(3)

    timers.dispose()
    vi.advanceTimersByTime(1000)
    expect(ticks).toBe(3)
    // Scheduling after disposal is inert rather than an error.
    timers.setTimeout(() => ticks++, 1)
    vi.advanceTimersByTime(100)
    expect(ticks).toBe(3)
  })
})

describe("a blank document's first page", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })
  afterEach(() => {
    editor.dispose()
  })

  it("has the same id in every editor, so two replicas meet on it", () => {
    const other = makeEditor()
    try {
      expect(editor.getCurrentPageId()).toBe(DEFAULT_PAGE_ID)
      expect(other.getCurrentPageId()).toBe(DEFAULT_PAGE_ID)
    } finally {
      other.dispose()
    }
  })

  it("does not make every later page shared too", () => {
    editor.createPage({ name: "second" })
    const other = makeEditor()
    try {
      other.createPage({ name: "second" })
      const mine = editor.getPages().find((p) => p.name === "second")!
      const theirs = other.getPages().find((p) => p.name === "second")!
      // Two people who each add a page have added two pages, not one.
      expect(mine.id).not.toBe(theirs.id)
    } finally {
      other.dispose()
    }
  })

  it("leaves a document that already has pages alone", () => {
    // Through `initialData`, which is how a document arrives from storage —
    // and which suppresses the store's own seeding, so the only page here is
    // the loaded one. Putting a page into an already-seeded store would leave
    // two, which is a different situation and not the one this asserts.
    const existing = PageRecordType.create({ id: PageRecordType.createId("loaded"), name: "Loaded", index: ZERO_INDEX_KEY })
    const store = createStore({ initialData: { [existing.id]: existing } })
    const loaded = new Editor({
      store,
      shapeUtils: [BoxUtil],
      tools: [TestTool],
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => ({}) as HTMLElement,
    })
    try {
      expect(loaded.getPages().map((p) => p.id)).toEqual([existing.id])
    } finally {
      loaded.dispose()
    }
  })
})

describe("a camera move made before the canvas has been measured", () => {
  /** The `onMount` situation: an editor whose container has no size yet. */
  function makeUnmeasuredEditor(): Editor {
    return new Editor({
      store: createStore(),
      shapeUtils: [BoxUtil, FrameUtil, SectionUtil],
      tools: [TestTool],
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => ({}) as HTMLElement,
    })
  }

  it("runs the fit once the viewport has a size instead of aiming at nothing", () => {
    const editor = makeUnmeasuredEditor()
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      editor.createShapes([{ type: "box", x: 1000, y: 1000, props: { w: 200, h: 200 } }])
      // Unmeasured does not mean zero: the instance record's placeholder is a
      // plausible 1080x720 that belongs to no canvas in particular, which is
      // precisely why fitting against it is wrong without being obviously so.
      expect(editor.getHasMeasuredViewport()).toBe(false)

      const before = { ...editor.getCamera() }
      editor.zoomToFit()
      // Nothing could be computed yet, so nothing was written — in particular
      // not a camera at the zoom floor pointing away from the shapes.
      expect(editor.getCamera()).toMatchObject(before)
      expect(warn).toHaveBeenCalledTimes(1)

      editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })

      // ...and now the shapes are actually in view.
      const viewport = editor.getViewportPageBounds()
      const shapes = editor.getCurrentPageBounds()!
      expect(viewport.x).toBeLessThanOrEqual(shapes.x)
      expect(viewport.y).toBeLessThanOrEqual(shapes.y)
      expect(viewport.maxX).toBeGreaterThanOrEqual(shapes.maxX)
      expect(viewport.maxY).toBeGreaterThanOrEqual(shapes.maxY)
      warn.mockRestore()
    } finally {
      editor.dispose()
    }
  })

  it("is overruled by a camera move the app makes afterwards", () => {
    const editor = makeUnmeasuredEditor()
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      editor.createShapes([{ type: "box", x: 1000, y: 1000, props: { w: 200, h: 200 } }])
      editor.zoomToFit()
      editor.setCamera({ x: 5, y: 6, z: 2 })

      editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })

      expect(editor.getCamera()).toMatchObject({ x: 5, y: 6, z: 2 })
      vi.restoreAllMocks()
    } finally {
      editor.dispose()
    }
  })

  it("fits against the real viewport, not the placeholder the fit was asked with", () => {
    const editor = makeUnmeasuredEditor()
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      editor.createShapes([{ type: "box", x: 0, y: 0, props: { w: 400, h: 400 } }])
      editor.zoomToFit()
      // A tall, narrow canvas — nothing like the 1080x720 placeholder.
      editor.updateViewportScreenBounds({ x: 0, y: 0, w: 400, h: 1200 })

      const measured = { ...editor.getCamera() }
      const reference = makeUnmeasuredEditor()
      try {
        reference.updateViewportScreenBounds({ x: 0, y: 0, w: 400, h: 1200 })
        reference.createShapes([{ type: "box", x: 0, y: 0, props: { w: 400, h: 400 } }])
        reference.zoomToFit()
        expect(measured).toMatchObject({ ...reference.getCamera() })
      } finally {
        reference.dispose()
      }
      vi.restoreAllMocks()
    } finally {
      editor.dispose()
    }
  })

  it("still fits normally when the viewport is known", () => {
    const editor = makeEditor()
    try {
      editor.createShapes([{ type: "box", x: 1000, y: 1000, props: { w: 200, h: 200 } }])
      editor.zoomToFit()
      const viewport = editor.getViewportPageBounds()
      const shapes = editor.getCurrentPageBounds()!
      expect(viewport.x).toBeLessThanOrEqual(shapes.x)
      expect(viewport.maxX).toBeGreaterThanOrEqual(shapes.maxX)
    } finally {
      editor.dispose()
    }
  })
})
