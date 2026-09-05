import { describe, expect, it } from "vitest"
import { DEFAULT_THEME, type Editor, type InstancePresence, type Scribble } from "@mocanvas/editor"
import { ArrowBindingHintOverlayUtil, ArrowHintOverlayUtil } from "./ArrowHintOverlayUtil"
import { BrushOverlayUtil, ZoomBrushOverlayUtil } from "./BrushOverlayUtil"
import {
  CollaboratorBrushOverlayUtil,
  CollaboratorCursorOverlayUtil,
  CollaboratorHintOverlayUtil,
  CollaboratorScribbleOverlayUtil,
  CollaboratorShapeIndicatorOverlayUtil,
} from "./CollaboratorOverlayUtils"
import { ScribbleOverlayUtil, resolveScribbleColor } from "./ScribbleOverlayUtil"
import { SelectionForegroundOverlayUtil } from "./SelectionForegroundOverlayUtil"
import { ShapeHandleOverlayUtil } from "./ShapeHandleOverlayUtil"
import { SnapIndicatorOverlayUtil } from "./SnapIndicatorOverlayUtil"
import { defaultOverlayUtils } from "./defaultOverlayUtils"
import { traceTaperedStroke } from "./paint"

// ── Doubles ─────────────────────────────────────────────────────────────────
// These tests run in Node, so there is no canvas. A recording context keeps the
// part worth testing — which paths were traced, in which colour, at which width
// — observable, and leaves rasterization to the browser.

/** Records every call `render` makes, and checks save/restore stayed balanced. */
class FakeCtx {
  readonly calls: string[] = []
  private depth = 0
  fillStyle = ""
  strokeStyle = ""
  lineWidth = 0
  lineCap = ""
  globalAlpha = 1
  font = ""
  textBaseline = ""
  textAlign = ""

  save(): void {
    this.depth++
    this.calls.push("save")
  }
  restore(): void {
    this.depth--
    this.calls.push("restore")
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.calls.push(`transform(${a},${b},${c},${d},${e},${f})`)
  }
  translate(x: number, y: number): void {
    this.calls.push(`translate(${x},${y})`)
  }
  rotate(r: number): void {
    this.calls.push(`rotate(${r.toFixed(3)})`)
  }
  beginPath(): void {
    this.calls.push("beginPath")
  }
  closePath(): void {
    this.calls.push("closePath")
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo(${round(x)},${round(y)})`)
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo(${round(x)},${round(y)})`)
  }
  quadraticCurveTo(): void {
    this.calls.push("quad")
  }
  arc(x: number, y: number, r: number): void {
    this.calls.push(`arc(${round(x)},${round(y)},${round(r)})`)
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect(${round(x)},${round(y)},${round(w)},${round(h)})`)
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`strokeRect(${round(x)},${round(y)},${round(w)},${round(h)},c=${this.strokeStyle})`)
  }
  fill(): void {
    this.calls.push(`fill(${this.fillStyle},a=${round(this.globalAlpha)})`)
  }
  stroke(): void {
    this.calls.push(`stroke(${this.strokeStyle},w=${round(this.lineWidth)},a=${round(this.globalAlpha)})`)
  }
  setLineDash(dash: number[]): void {
    this.calls.push(`dash(${dash.map(round).join(",")})`)
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(`text(${text},${round(x)},${round(y)})`)
  }
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } {
    return { width: text.length * 6, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }
  }
  get balanced(): boolean {
    return this.depth === 0
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function ctx(): CanvasRenderingContext2D {
  return new FakeCtx() as unknown as CanvasRenderingContext2D
}

const SELECT_STROKE = DEFAULT_THEME.colors.light.selectStroke
const SELECT_FILL = DEFAULT_THEME.colors.light.selectFill
const HINT = DEFAULT_THEME.colors.light.hint

interface EditorStub {
  camera: { x: number; y: number; z: number }
  brush: { x: number; y: number; w: number; h: number } | null
  zoomBrush: { x: number; y: number; w: number; h: number } | null
  scribbles: Scribble[]
  snapLines: { id: string; points: { x: number; y: number }[] }[]
  toolId: string
  selected: string[]
  hinting: string[]
  shapes: Record<string, { id: string; type: string; isLocked?: boolean }>
  handles: Record<string, { id: string; type: "vertex" | "virtual" | "create" | "clone"; x: number; y: number }[]>
  bindings: Record<string, { id: string; toId: string; props: { terminal: "start" | "end"; normalizedAnchor: { x: number; y: number } } }[]>
  people: InstancePresence[]
  idle: Set<string>
  viewport: { w: number; h: number }
}

function stub(over: Partial<EditorStub> = {}): { editor: Editor; state: EditorStub } {
  const state: EditorStub = {
    camera: { x: 0, y: 0, z: 1 },
    brush: null,
    zoomBrush: null,
    scribbles: [],
    snapLines: [],
    toolId: "select",
    selected: [],
    hinting: [],
    shapes: {},
    handles: {},
    bindings: {},
    people: [],
    idle: new Set(),
    viewport: { w: 1000, h: 800 },
    ...over,
  }
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const editor = {
    getCamera: () => state.camera,
    getZoomLevel: () => state.camera.z,
    getInstanceState: () => ({ brush: state.brush, zoomBrush: state.zoomBrush, scribbles: state.scribbles }),
    getCurrentToolId: () => state.toolId,
    getSelectedShapes: () => state.selected.map((id) => state.shapes[id]).filter(Boolean),
    getOnlySelectedShape: () => (state.selected.length === 1 ? state.shapes[state.selected[0]!] : undefined),
    getSelectionPageBounds: () => (state.selected.length ? { x: 0, y: 0, w: 100, h: 50, maxX: 100, maxY: 50 } : null),
    getHintingShapeIds: () => state.hinting,
    getHintingShapes: () => state.hinting.map((id) => state.shapes[id]).filter(Boolean),
    getShape: (id: string) => state.shapes[id],
    getShapeUtil: (shape: { id: string }) => ({
      getHandles: () => state.handles[shape.id] ?? [],
      hideResizeHandles: () => false,
      hideRotateHandle: () => false,
    }),
    getSelectionRotation: () => 0,
    getShapePageTransform: () => identity,
    getShapeGeometryBounds: () => ({ x: 0, y: 0, w: 100, h: 50 }),
    getShapePageBounds: () => ({ x: 10, y: 20, w: 100, h: 50 }),
    getBindingsFromShape: (shape: { id: string }) => state.bindings[shape.id] ?? [],
    getViewportScreenBounds: () => ({ x: 0, y: 0, ...state.viewport }),
    pageToViewport: (p: { x: number; y: number }) => ({
      x: (p.x + state.camera.x) * state.camera.z,
      y: (p.y + state.camera.y) * state.camera.z,
    }),
    viewportToPage: (p: { x: number; y: number }) => ({
      x: p.x / state.camera.z - state.camera.x,
      y: p.y / state.camera.z - state.camera.y,
    }),
    snaps: { getLines: () => state.snapLines },
    theme: { getCurrentTheme: () => DEFAULT_THEME, getColorMode: () => "light" as const },
    collaborators: {
      getVisibleCollaboratorsOnCurrentPage: () => state.people,
      isCollaboratorIdle: (p: InstancePresence) => state.idle.has(p.id),
    },
  }
  return { editor: editor as unknown as Editor, state }
}

function person(over: Partial<InstancePresence> = {}): InstancePresence {
  return {
    id: "presence:a",
    typeName: "instance_presence",
    userId: "user:a",
    userName: "Ada",
    color: "#e0575b",
    currentPageId: "page:main",
    cursor: { x: 10, y: 20, type: "default", rotation: 0 },
    camera: { x: 0, y: 0, z: 1 },
    selectedShapeIds: [],
    brush: null,
    scribbles: [],
    followingUserId: null,
    lastActivityTimestamp: Date.now(),
    chatMessage: "",
    meta: {},
    ...over,
  } as InstancePresence
}

function scribble(over: Partial<Scribble> = {}): Scribble {
  return {
    id: "s1",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ],
    size: 4,
    color: "accent",
    opacity: 0.8,
    state: "active",
    delay: 0,
    shrink: 0.1,
    taper: true,
    ...over,
  }
}

const calls = (c: CanvasRenderingContext2D): string[] => (c as unknown as FakeCtx).calls
const balanced = (c: CanvasRenderingContext2D): boolean => (c as unknown as FakeCtx).balanced

// ── The brushes ─────────────────────────────────────────────────────────────

describe("BrushOverlayUtil", () => {
  it("is inactive and paints nothing with no brush", () => {
    const { editor } = stub()
    const util = new BrushOverlayUtil(editor)
    expect(util.isActive()).toBe(false)
    expect(util.getOverlays()).toEqual([])
    const c = ctx()
    util.render(c)
    expect(calls(c)).toEqual([])
  })

  it("names one overlay and strokes it in the theme's selection colours", () => {
    const { editor } = stub({ brush: { x: 5, y: 6, w: 30, h: 20 } })
    const util = new BrushOverlayUtil(editor)
    expect(util.isActive()).toBe(true)
    expect(util.getOverlays()).toEqual([{ id: "brush", type: "brush", bounds: { x: 5, y: 6, w: 30, h: 20 } }])
    const c = ctx()
    util.render(c)
    expect(calls(c)).toContain(`fill(${SELECT_FILL},a=1)`)
    expect(calls(c)).toContain(`stroke(${SELECT_STROKE},w=1.5,a=1)`)
    expect(balanced(c)).toBe(true)
  })

  it("keeps the outline a hairline by dividing the width by the zoom", () => {
    const { editor } = stub({ brush: { x: 0, y: 0, w: 10, h: 10 }, camera: { x: 0, y: 0, z: 4 } })
    const c = ctx()
    new BrushOverlayUtil(editor).render(c)
    // 1.5 CSS px at 400% is 0.375 page units, which the camera scales back to 1.5.
    expect(calls(c)).toContain(`stroke(${SELECT_STROKE},w=0.375,a=1)`)
  })

  it("configures onto a subclass without touching the class it came from", () => {
    const Square = BrushOverlayUtil.configure({ radius: 0 })
    expect(Square.options.radius).toBe(0)
    // The unspecified keys are inherited, not reset.
    expect(Square.options.lineWidth).toBe(BrushOverlayUtil.options.lineWidth)
    expect(BrushOverlayUtil.options.radius).toBe(2)
  })

  it("reads its colours through the display-value override point", () => {
    class Red extends BrushOverlayUtil {
      getCustomDisplayValues(): { stroke: string } {
        return { stroke: "#ff0000" }
      }
    }
    const { editor } = stub({ brush: { x: 0, y: 0, w: 10, h: 10 } })
    const util = new Red(editor)
    expect(util.getDisplayValues()).toEqual({ fill: SELECT_FILL, stroke: "#ff0000" })
  })
})

describe("ZoomBrushOverlayUtil", () => {
  it("reads the zoom brush slot, not the selection brush", () => {
    const { editor } = stub({ brush: { x: 1, y: 1, w: 1, h: 1 }, zoomBrush: { x: 9, y: 9, w: 50, h: 40 } })
    const util = new ZoomBrushOverlayUtil(editor)
    expect(util.getOverlays()).toEqual([{ id: "zoomBrush", type: "zoomBrush", bounds: { x: 9, y: 9, w: 50, h: 40 } }])
  })

  it("draws an unfilled outline, so it does not read as a selection", () => {
    const { editor } = stub({ zoomBrush: { x: 0, y: 0, w: 10, h: 10 } })
    const c = ctx()
    new ZoomBrushOverlayUtil(editor).render(c)
    expect(calls(c).some((call) => call.startsWith("fill("))).toBe(false)
    expect(calls(c)).toContain(`stroke(${SELECT_STROKE},w=1.5,a=1)`)
  })
})

// ── Scribbles ───────────────────────────────────────────────────────────────

describe("ScribbleOverlayUtil", () => {
  it("names one overlay per live scribble", () => {
    const { editor } = stub({ scribbles: [scribble({ id: "a" }), scribble({ id: "b" })] })
    const util = new ScribbleOverlayUtil(editor)
    expect(util.getOverlays().map((o) => o.id)).toEqual(["a", "b"])
    expect(util.isActive()).toBe(true)
  })

  it("skips a scribble with fewer than two points — a ribbon needs a direction", () => {
    const { editor } = stub({ scribbles: [scribble({ points: [{ x: 0, y: 0 }] })] })
    const c = ctx()
    new ScribbleOverlayUtil(editor).render(c)
    expect(calls(c).some((call) => call.startsWith("fill("))).toBe(false)
  })

  it("fills a closed ribbon rather than stroking a line", () => {
    const { editor } = stub({ scribbles: [scribble()] })
    const c = ctx()
    new ScribbleOverlayUtil(editor).render(c)
    expect(calls(c)).toContain("closePath")
    expect(calls(c).some((call) => call.startsWith("stroke("))).toBe(false)
    expect(calls(c).some((call) => call.startsWith(`fill(${SELECT_STROKE}`))).toBe(true)
  })

  it("maps a theme colour name onto the theme, and passes CSS through", () => {
    expect(resolveScribbleColor("accent", DEFAULT_THEME, "light")).toBe(SELECT_STROKE)
    expect(resolveScribbleColor("blue", DEFAULT_THEME, "light")).toBe(DEFAULT_THEME.colors.light.blue.solid)
    expect(resolveScribbleColor("#abcdef", DEFAULT_THEME, "light")).toBe("#abcdef")
  })
})

describe("traceTaperedStroke", () => {
  it("walks down one side of the stroke and back along the other", () => {
    const c = ctx()
    traceTaperedStroke(
      c,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      4,
      false,
    )
    // Three points, one moveTo, then 2 + 3 lineTo, then a close.
    const ops = calls(c)
    expect(ops.filter((o) => o.startsWith("moveTo")).length).toBe(1)
    expect(ops.filter((o) => o.startsWith("lineTo")).length).toBe(5)
    expect(ops.at(-1)).toBe("closePath")
  })

  it("tapers the head of the stroke to a point, and does not when told not to", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i * 5, y: 0 }))
    const tapered = ctx()
    traceTaperedStroke(tapered, points, 4, true)
    const flat = ctx()
    traceTaperedStroke(flat, points, 4, false)
    // The first offset point sits on the centreline when tapering, and half a
    // width off it when not.
    expect(calls(tapered)[1]).toBe("moveTo(0,0)")
    expect(calls(flat)[1]).toBe("moveTo(0,2)")
  })
})

// ── Snap guides ─────────────────────────────────────────────────────────────

describe("SnapIndicatorOverlayUtil", () => {
  it("is inactive with no guides", () => {
    const { editor } = stub()
    expect(new SnapIndicatorOverlayUtil(editor).isActive()).toBe(false)
  })

  it("draws a guide plus a cross at each aligned point, in the hint colour", () => {
    const { editor } = stub({
      snapLines: [
        {
          id: "x:40",
          points: [
            { x: 40, y: 0 },
            { x: 40, y: 100 },
          ],
        },
      ],
    })
    const c = ctx()
    const util = new SnapIndicatorOverlayUtil(editor)
    expect(util.getOverlays()).toEqual([{ id: "x:40", type: "snapIndicator", points: [{ x: 40, y: 0 }, { x: 40, y: 100 }] }])
    util.render(c)
    expect(calls(c)).toContain(`stroke(${HINT},w=1,a=1)`)
    // One polyline (1 moveTo) plus one cross per point (2 moveTo each).
    expect(calls(c).filter((o) => o.startsWith("moveTo")).length).toBe(5)
  })

  it("keeps the cross arms a constant size on screen", () => {
    const { editor } = stub({
      camera: { x: 0, y: 0, z: 2 },
      snapLines: [{ id: "g", points: [{ x: 0, y: 0 }, { x: 0, y: 10 }] }],
    })
    const c = ctx()
    new SnapIndicatorOverlayUtil(editor).render(c)
    // A 4px arm at 200% is 2 page units.
    expect(calls(c)).toContain("lineTo(2,2)")
  })
})

// ── Handles ─────────────────────────────────────────────────────────────────

describe("ShapeHandleOverlayUtil", () => {
  const shaped = () =>
    stub({
      selected: ["shape:a"],
      shapes: { "shape:a": { id: "shape:a", type: "line" } },
      handles: {
        "shape:a": [
          { id: "start", type: "vertex", x: 0, y: 0 },
          { id: "mid", type: "virtual", x: 5, y: 5 },
        ],
      },
    })

  it("shows handles for a single selection only", () => {
    const { editor, state } = shaped()
    const util = new ShapeHandleOverlayUtil(editor)
    expect(util.getOverlays().map((o) => o.handleId)).toEqual(["start", "mid"])
    state.selected = ["shape:a", "shape:b"]
    expect(util.getOverlays()).toEqual([])
  })

  it("shows nothing while another tool is active, or the shape is locked", () => {
    const { editor, state } = shaped()
    const util = new ShapeHandleOverlayUtil(editor)
    state.toolId = "draw"
    expect(util.isActive()).toBe(false)
    state.toolId = "select"
    state.shapes["shape:a"]!.isLocked = true
    expect(util.isActive()).toBe(false)
  })

  it("survives a shape util that throws while describing its handles", () => {
    const { editor } = shaped()
    ;(editor as unknown as { getShapeUtil: () => unknown }).getShapeUtil = () => ({
      getHandles: () => {
        throw new Error("boom")
      },
    })
    expect(new ShapeHandleOverlayUtil(editor).getOverlays()).toEqual([])
  })

  it("gives a handle a page-space hit target bigger than the dot you can see", () => {
    const { editor } = shaped()
    const util = new ShapeHandleOverlayUtil(editor)
    const overlay = util.getOverlays()[0]!
    const geometry = util.getGeometry(overlay)!
    // radius 6 + padding 6, at zoom 1.
    expect(geometry.bounds.w).toBe(24)
    expect(geometry.bounds.x).toBe(-12)
  })

  it("scales the hit target with the zoom so it stays constant on screen", () => {
    const { editor, state } = shaped()
    state.camera = { x: 0, y: 0, z: 4 }
    const util = new ShapeHandleOverlayUtil(editor)
    expect(util.getGeometry(util.getOverlays()[0]!)!.bounds.w).toBe(6)
  })

  it("draws a virtual handle as a filled dot and a real one as a ring", () => {
    const { editor } = shaped()
    const c = ctx()
    new ShapeHandleOverlayUtil(editor).render(c)
    const ops = calls(c)
    // The real handle fills with the paper colour and then strokes; the virtual
    // one fills with the selection colour and does not stroke.
    expect(ops.filter((o) => o.startsWith("stroke(")).length).toBe(1)
    expect(ops.filter((o) => o.startsWith("fill(")).length).toBe(2)
    expect(ops).toContain(`fill(${SELECT_STROKE},a=0.6)`)
  })
})

// ── Selection foreground ────────────────────────────────────────────────────

describe("SelectionForegroundOverlayUtil", () => {
  it("is inactive with nothing selected, and while another tool is active", () => {
    const { editor, state } = stub()
    const util = new SelectionForegroundOverlayUtil(editor)
    expect(util.isActive()).toBe(false)
    state.selected = ["shape:a"]
    state.shapes = { "shape:a": { id: "shape:a", type: "box" } }
    expect(util.isActive()).toBe(true)
    state.toolId = "draw"
    expect(util.isActive()).toBe(false)
  })

  it("names the box first so handles paint over it and win the hit test", () => {
    const { editor } = stub({ selected: ["shape:a"], shapes: { "shape:a": { id: "shape:a", type: "box" } } })
    const overlays = new SelectionForegroundOverlayUtil(editor).getOverlays()
    expect(overlays[0]!.handle).toBeNull()
    expect(overlays.length).toBeGreaterThan(1)
  })

  it("gives the box outline no geometry — a click on it belongs to the select tool", () => {
    const { editor } = stub({ selected: ["shape:a"], shapes: { "shape:a": { id: "shape:a", type: "box" } } })
    const util = new SelectionForegroundOverlayUtil(editor)
    expect(util.getGeometry(util.getOverlays()[0]!)).toBeUndefined()
  })

  it("names a resize cursor per handle, by the axis the drag acts on", () => {
    const { editor } = stub({ selected: ["shape:a"], shapes: { "shape:a": { id: "shape:a", type: "box" } } })
    const util = new SelectionForegroundOverlayUtil(editor)
    const cursors = new Map(util.getOverlays().map((o) => [o.handle, util.getCursor(o)]))
    expect(cursors.get("top_left")).toBe("nwse-resize")
    expect(cursors.get("top_right")).toBe("nesw-resize")
    expect(cursors.get("rotate")).toBe("grab")
    expect(cursors.get(null)).toBeUndefined()
  })

  it("draws handles at a fixed CSS size, whatever the zoom", () => {
    const { editor, state } = stub({ selected: ["shape:a"], shapes: { "shape:a": { id: "shape:a", type: "box" } } })
    const at1 = ctx()
    new SelectionForegroundOverlayUtil(editor).render(at1)
    state.camera = { x: 0, y: 0, z: 3 }
    const at3 = ctx()
    new SelectionForegroundOverlayUtil(editor).render(at3)
    const width = (c: CanvasRenderingContext2D) => calls(c).find((o) => o.startsWith("stroke("))
    expect(width(at1)).toBe(width(at3))
    expect(balanced(at3)).toBe(true)
  })
})

// ── Arrow hints ─────────────────────────────────────────────────────────────

describe("ArrowHintOverlayUtil", () => {
  it("stays quiet unless an arrow gesture is what produced the hints", () => {
    const { editor, state } = stub({
      hinting: ["shape:target"],
      shapes: { "shape:target": { id: "shape:target", type: "geo" } },
    })
    const util = new ArrowHintOverlayUtil(editor)
    // A drop-target hint during a plain drag belongs to the indicator compositor.
    expect(util.isActive()).toBe(false)
    state.toolId = "arrow"
    expect(util.isActive()).toBe(true)
  })

  it("wakes for a selected arrow whose terminal is being dragged", () => {
    const { editor } = stub({
      selected: ["shape:arrow"],
      hinting: ["shape:target"],
      shapes: {
        "shape:arrow": { id: "shape:arrow", type: "arrow" },
        "shape:target": { id: "shape:target", type: "geo" },
      },
    })
    expect(new ArrowHintOverlayUtil(editor).isActive()).toBe(true)
  })

  it("never hints at the arrow itself", () => {
    const { editor } = stub({
      toolId: "arrow",
      hinting: ["shape:arrow", "shape:target"],
      shapes: {
        "shape:arrow": { id: "shape:arrow", type: "arrow" },
        "shape:target": { id: "shape:target", type: "geo" },
      },
    })
    expect(new ArrowHintOverlayUtil(editor).getOverlays().map((o) => o.shapeId)).toEqual(["shape:target"])
  })

  it("draws a dashed outline in the hint colour, not the selection colour", () => {
    const { editor } = stub({
      toolId: "arrow",
      hinting: ["shape:target"],
      shapes: { "shape:target": { id: "shape:target", type: "geo" } },
    })
    const c = ctx()
    new ArrowHintOverlayUtil(editor).render(c)
    expect(calls(c)).toContain("dash(4,3)")
    expect(calls(c)).toContain(`stroke(${HINT},w=2,a=1)`)
  })
})

describe("ArrowBindingHintOverlayUtil", () => {
  const bound = () =>
    stub({
      selected: ["shape:arrow"],
      shapes: {
        "shape:arrow": { id: "shape:arrow", type: "arrow" },
        "shape:box": { id: "shape:box", type: "geo" },
      },
      bindings: {
        "shape:arrow": [
          { id: "binding:1", toId: "shape:box", props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 } } },
        ],
      },
    })

  it("marks a bound terminal at the anchor it is attached to", () => {
    const { editor } = bound()
    const overlays = new ArrowBindingHintOverlayUtil(editor).getOverlays()
    expect(overlays).toEqual([
      {
        id: "shape:arrow:end",
        type: "arrowBindingHint",
        arrowId: "shape:arrow",
        boundShapeId: "shape:box",
        terminal: "end",
        // The stub's geometry bounds are 100x50, so the centre anchor is (50, 25).
        point: { x: 50, y: 25 },
      },
    ])
  })

  it("only marks selected arrows — the dots are an editing aid, not decoration", () => {
    const { editor, state } = bound()
    state.selected = []
    expect(new ArrowBindingHintOverlayUtil(editor).isActive()).toBe(false)
  })

  it("skips a binding whose target has gone", () => {
    const { editor, state } = bound()
    delete state.shapes["shape:box"]
    expect(new ArrowBindingHintOverlayUtil(editor).getOverlays()).toEqual([])
  })
})

// ── Collaborators ───────────────────────────────────────────────────────────

describe("CollaboratorCursorOverlayUtil", () => {
  it("skips a collaborator with no pointer at all", () => {
    const { editor } = stub({ people: [person({ cursor: null })] })
    expect(new CollaboratorCursorOverlayUtil(editor).getOverlays()).toEqual([])
  })

  it("draws the pointer in their own colour, never the theme's", () => {
    const { editor } = stub({ people: [person({ color: "#123456" })] })
    const c = ctx()
    new CollaboratorCursorOverlayUtil(editor).render(c)
    expect(calls(c)).toContain("fill(#123456,a=1)")
  })

  it("dims everything drawn for somebody who has gone quiet", () => {
    const { editor } = stub({ people: [person()], idle: new Set(["presence:a"]) })
    const util = new CollaboratorCursorOverlayUtil(editor)
    expect(util.getOverlays()[0]!.isIdle).toBe(true)
    const c = ctx()
    util.render(c)
    expect(calls(c)).toContain("fill(#e0575b,a=0.5)")
  })

  it("labels the cursor with the chat message when there is one, else the name", () => {
    const { editor, state } = stub({ people: [person()] })
    const named = ctx()
    new CollaboratorCursorOverlayUtil(editor).render(named)
    expect(calls(named).some((o) => o.startsWith("text(Ada,"))).toBe(true)
    state.people = [person({ chatMessage: "brb" })]
    const chatting = ctx()
    new CollaboratorCursorOverlayUtil(editor).render(chatting)
    expect(calls(chatting).some((o) => o.startsWith("text(brb,"))).toBe(true)
  })
})

describe("CollaboratorBrushOverlayUtil", () => {
  it("draws their brush tinted in their colour", () => {
    const { editor } = stub({ people: [person({ brush: { x: 0, y: 0, w: 10, h: 10 }, color: "#00ff00" })] })
    const c = ctx()
    new CollaboratorBrushOverlayUtil(editor).render(c)
    expect(calls(c)).toContain("fill(#00ff00,a=0.12)")
    expect(calls(c)).toContain("stroke(#00ff00,w=1.5,a=1)")
  })
})

describe("CollaboratorScribbleOverlayUtil", () => {
  it("names one overlay per person per scribble", () => {
    const { editor } = stub({ people: [person({ scribbles: [scribble({ id: "s1" }), scribble({ id: "s2" })] })] })
    expect(new CollaboratorScribbleOverlayUtil(editor).getOverlays().map((o) => o.id)).toEqual([
      "presence:a:s1",
      "presence:a:s2",
    ])
  })

  it("paints in the person's colour, not the scribble's", () => {
    const { editor } = stub({ people: [person({ color: "#0000ff", scribbles: [scribble({ color: "#ff0000" })] })] })
    const c = ctx()
    new CollaboratorScribbleOverlayUtil(editor).render(c)
    expect(calls(c).some((o) => o.startsWith("fill(#0000ff"))).toBe(true)
  })
})

describe("CollaboratorShapeIndicatorOverlayUtil", () => {
  it("outlines each shape they have selected, in their colour", () => {
    const { editor } = stub({
      people: [person({ selectedShapeIds: ["shape:a"] as never })],
      shapes: { "shape:a": { id: "shape:a", type: "box" } },
    })
    const util = new CollaboratorShapeIndicatorOverlayUtil(editor)
    expect(util.getOverlays().map((o) => o.id)).toEqual(["presence:a:shape:a"])
    const c = ctx()
    util.render(c)
    expect(calls(c)).toContain("strokeRect(0,0,100,50,c=#e0575b)")
  })

  it("skips a shape that is no longer there", () => {
    const { editor } = stub({ people: [person({ selectedShapeIds: ["shape:gone"] as never })] })
    expect(new CollaboratorShapeIndicatorOverlayUtil(editor).getOverlays()).toEqual([])
  })
})

describe("CollaboratorHintOverlayUtil", () => {
  it("says nothing about somebody whose cursor is already on screen", () => {
    const { editor } = stub({ people: [person({ cursor: { x: 100, y: 100, type: "default", rotation: 0 } })] })
    expect(new CollaboratorHintOverlayUtil(editor).getOverlays()).toEqual([])
  })

  it("clamps an off-screen collaborator to the viewport edge and points at them", () => {
    const { editor } = stub({ people: [person({ cursor: { x: 5000, y: 400, type: "default", rotation: 0 } })] })
    const overlay = new CollaboratorHintOverlayUtil(editor).getOverlays()[0]!
    // Inset 12 from the 1000px-wide viewport; due east of centre.
    expect(overlay.point).toEqual({ x: 988, y: 400 })
    expect(overlay.rotation).toBeCloseTo(0)
  })

  it("points back the other way for somebody off the left edge", () => {
    const { editor } = stub({ people: [person({ cursor: { x: -900, y: 400, type: "default", rotation: 0 } })] })
    const overlay = new CollaboratorHintOverlayUtil(editor).getOverlays()[0]!
    expect(overlay.point.x).toBe(12)
    expect(Math.abs(overlay.rotation)).toBeCloseTo(Math.PI)
  })
})

// ── The set ─────────────────────────────────────────────────────────────────

describe("defaultOverlayUtils", () => {
  it("registers every built-in painter under a unique type", () => {
    const types = defaultOverlayUtils.map((U) => U.type)
    expect(new Set(types).size).toBe(types.length)
    expect(types).toContain("brush")
    expect(types).toContain("shapeIndicator")
    expect(types).toContain("collaboratorCursor")
    expect(types.length).toBe(14)
  })

  it("is listed in the order it paints in", () => {
    const z = defaultOverlayUtils.map((U) => U.zIndex ?? 0)
    expect([...z].sort((a, b) => a - b)).toEqual(z)
  })

  it("puts cursors above the selection chrome, so a cursor is never hidden", () => {
    const zOf = (type: string) => defaultOverlayUtils.find((U) => U.type === type)!.zIndex ?? 0
    expect(zOf("collaboratorCursor")).toBeGreaterThan(zOf("selectionForeground"))
    expect(zOf("collaboratorCursor")).toBeGreaterThan(zOf("shapeHandle"))
    expect(zOf("shapeIndicator")).toBeGreaterThan(zOf("collaboratorShapeIndicator") - 1)
  })
})
