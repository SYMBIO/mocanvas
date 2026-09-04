import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  Box,
  createShapeId,
  FONT_SIZES,
  GEO_SHAPE_KINDS,
  Group2d,
  PATH_OP,
  Polygon2d,
  Polyline2d,
  Rectangle2d,
  type Editor,
  type PageId,
  type UnknownShape,
} from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import {
  ArrowShapeUtil,
  DrawShapeUtil,
  FrameShapeUtil,
  GeoShapeUtil,
  LineShapeUtil,
  NoteShapeUtil,
  TextShapeUtil,
  getNoteFontSize,
  getNoteBodyGradientCss,
  getNoteFillCssColor,
  getNoteGradientTopCssColor,
  getNoteShadowCss,
  defaultShapeUtils,
  FRAME_NAME_COLOR,
  FRAME_NAME_GAP,
  FRAME_NAME_HEIGHT,
  FRAME_NAME_OFFSET,
  FRAME_STROKE,
  FRAME_STROKE_WIDTH,
  NOTE_SHADOW_BLUR,
  NOTE_SHADOW_COLOR,
  NOTE_SHADOW_OFFSET_Y,
  NOTE_SHADOW_OPACITY,
  type ArrowShape,
  type ArrowheadKind,
  type DrawShape,
  type FrameShape,
  type GeoShape,
  type LineShape,
  type NoteShape,
  type TextShape,
} from "./index"
import { getDashId } from "./shape-theme"

const editor = {
  getSortedChildIdsForParent: () => [],
  getEditingShapeId: () => null,
  getBindingsFromShape: () => [],
  getShapePageTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  getCurrentPageShapesSorted: () => [],
  getShapeParent: () => undefined,
  options: { hitTestMargin: 8 },
  getZoomLevel: () => 1,
  inputs: { ctrlKey: false },
} as unknown as Editor

function makeShape<T extends UnknownShape>(type: T["type"], props: T["props"]): T {
  return {
    id: createShapeId("test"),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: "page:page" as PageId,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  } as T
}

const ARG_COUNT: Record<number, number> = {
  [PATH_OP.MOVE]: 2,
  [PATH_OP.LINE]: 2,
  [PATH_OP.QUAD]: 4,
  [PATH_OP.CUBIC]: 6,
  [PATH_OP.CLOSE]: 0,
}

/** Every opcode must be followed by exactly its argument count, all finite. */
function expectWellFormedPath(words: number[]): void {
  let i = 0
  let subpathOpen = false
  while (i < words.length) {
    const op = words[i]!
    expect(Number.isInteger(op)).toBe(true)
    expect(op in ARG_COUNT).toBe(true)
    if (op !== PATH_OP.MOVE) expect(subpathOpen).toBe(true)
    if (op === PATH_OP.MOVE) subpathOpen = true
    if (op === PATH_OP.CLOSE) subpathOpen = false
    const n = ARG_COUNT[op]!
    for (let k = 1; k <= n; k++) {
      const v = words[i + k]
      expect(v).toBeDefined()
      expect(Number.isFinite(v)).toBe(true)
    }
    i += 1 + n
  }
  expect(i).toBe(words.length)
}

function expectWellFormedStyle(style: { fill: number; stroke: number; strokeWidth: number; dash: number; opacity: number }) {
  expect(style.fill >>> 0).toBe(style.fill)
  expect(style.stroke >>> 0).toBe(style.stroke)
  expect(style.strokeWidth).toBeGreaterThanOrEqual(0)
  expect(style.opacity).toBe(1)
}

describe("defaultShapeUtils", () => {
  it("registers nine distinct types with the required members", () => {
    expect(defaultShapeUtils).toHaveLength(9)
    const types = defaultShapeUtils.map((U) => U.type)
    expect(new Set(types).size).toBe(9)
    expect(types).toEqual(["group", "geo", "draw", "line", "arrow", "text", "note", "frame", "image"])
    for (const U of defaultShapeUtils) {
      const util = new U(editor)
      expect(util.type).toBe(U.type)
      const shape = makeShape(U.type, util.getDefaultProps())
      const geometry = util.getGeometry(shape)
      expectWellFormedPath(geometry.toPathWords())
      // component/indicator must not throw on default props
      util.component(shape)
      expect(util.indicator(shape)).not.toBeNull()
    }
  })
})

describe("GeoShapeUtil", () => {
  const util = new GeoShapeUtil(editor)

  it("has the spec defaults", () => {
    expect(util.getDefaultProps()).toEqual({
      geo: "rectangle",
      w: 100,
      h: 100,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      text: "",
      scale: 1,
    })
  })

  it.each(GEO_SHAPE_KINDS)("%s emits well-formed path words with bounds w×h", (geo) => {
    const shape = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), geo, w: 120, h: 70 })
    const g = util.getGeometry(shape)
    expectWellFormedPath(g.toPathWords())
    const b = g.bounds
    expect(b.x).toBeCloseTo(0, 6)
    expect(b.y).toBeCloseTo(0, 6)
    expect(b.w).toBeCloseTo(120, 3)
    expect(b.h).toBeCloseTo(70, 3)
    expect(g.isClosed).toBe(true)
  })

  it("respects fill and growY", () => {
    const filled = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), fill: "semi", growY: 30 })
    const g = util.getGeometry(filled)
    expect(g.isFilled).toBe(true)
    expect(g.bounds.h).toBe(130)
    expect(util.getGeometry(makeShape<GeoShape>("geo", util.getDefaultProps())).isFilled).toBe(false)
  })

  it("adds a label rect to the group when there is text, excluded from path words", () => {
    const plain = makeShape<GeoShape>("geo", util.getDefaultProps())
    const labelled = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), text: "hello" })
    const g = util.getGeometry(labelled)
    expect(g).toBeInstanceOf(Group2d)
    const children = (g as Group2d).children
    expect(children).toHaveLength(2)
    expect(children[1]).toBeInstanceOf(Rectangle2d)
    expect(children[1]!.isLabel).toBe(true)
    expect(g.toPathWords()).toEqual(util.getGeometry(plain).toPathWords())
    expect(Box.Contains(new Box(0, 0, 100, 100), children[1]!.bounds)).toBe(true)
    expect(util.component(plain)).toBeNull()
    expect(util.component(labelled)).not.toBeNull()
  })

  it("render style follows color/fill/size/scale", () => {
    const shape = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), color: "blue", fill: "solid", size: "l", scale: 2 })
    const style = util.getRenderStyle(shape)
    expectWellFormedStyle(style)
    expect(style.strokeWidth).toBe(10)
    expect(style.stroke).toBe(0x4465e9ff)
    // The fill ramp sits one step below the stroke: `solid` is the hue's pale
    // tint, `semi` is the paper colour, and only `fill` is the hue itself.
    expect(style.fill).toBe(0xdce1f8ff)
    expect(util.getRenderStyle(makeShape<GeoShape>("geo", util.getDefaultProps())).fill).toBe(0)
    expect(util.getRenderStyle(makeShape<GeoShape>("geo", { ...util.getDefaultProps(), fill: "semi" })).fill).toBe(0xfcfffeff)
    expect(util.getRenderStyle(makeShape<GeoShape>("geo", { ...util.getDefaultProps(), color: "blue", fill: "fill" })).fill).toBe(
      0x4465e9ff,
    )
  })

  it("can edit and resizes through the box base class", () => {
    const shape = makeShape<GeoShape>("geo", util.getDefaultProps())
    expect(util.canEdit(shape)).toBe(true)
    const next = util.onResize(shape, {
      newPoint: { x: 5, y: 6 },
      handle: "bottom_right",
      mode: "scale_shape",
      scaleX: 2,
      scaleY: 0.5,
      initialBounds: { x: 0, y: 0, w: 100, h: 100 },
      initialShape: shape,
    })
    expect(next.props?.w).toBe(200)
    expect(next.props?.h).toBe(50)
    expect(next.x).toBe(5)
  })
})

describe("DrawShapeUtil", () => {
  const util = new DrawShapeUtil(editor)
  const zig = Array.from({ length: 8 }, (_, i) => ({ x: i * 10, y: i % 2 ? 10 : 0 }))

  it("concatenates and smooths free segments into a polyline", () => {
    const shape = makeShape<DrawShape>("draw", {
      ...util.getDefaultProps(),
      segments: [
        { type: "free", points: zig },
        { type: "straight", points: [{ x: 70, y: 10 }, { x: 100, y: 50 }] },
      ],
    })
    const g = util.getGeometry(shape)
    expect(g).toBeInstanceOf(Polyline2d)
    expect(g.vertices).toHaveLength(10)
    expect(g.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(g.vertices[9]).toEqual({ x: 100, y: 50 })
    // interior smoothed
    expect(g.vertices[1]!.y).not.toBe(10)
    expectWellFormedPath(g.toPathWords())
    expect(util.getRenderStyle(shape).fill).toBe(0)
  })

  it("closed strokes become filled polygons when fill is set", () => {
    const shape = makeShape<DrawShape>("draw", {
      ...util.getDefaultProps(),
      isClosed: true,
      fill: "solid",
      segments: [{ type: "straight", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] }],
    })
    const g = util.getGeometry(shape)
    expect(g).toBeInstanceOf(Polygon2d)
    expect(g.isFilled).toBe(true)
    const words = g.toPathWords()
    expectWellFormedPath(words)
    expect(words.at(-1)).toBe(PATH_OP.CLOSE)
    expect(util.getRenderStyle(shape).fill).not.toBe(0)
  })

  it("empty shape still yields a well-formed path and null component", () => {
    const shape = makeShape<DrawShape>("draw", util.getDefaultProps())
    expectWellFormedPath(util.getGeometry(shape).toPathWords())
    expect(util.component(shape)).toBeNull()
    expect(util.canResize(shape)).toBe(true)
    expect(util.hideResizeHandles(shape)).toBe(false)
  })

  it("keeps props.dash but strokes a draw shape solid", () => {
    // A recorded pen stroke is already hand-drawn; asking the engine to sketch it
    // again only adds bulges. The record has to stay untouched so the style panel
    // and a .tldr round trip still see "draw".
    const drawn = makeShape<DrawShape>("draw", { ...util.getDefaultProps(), dash: "draw", segments: [{ type: "free", points: zig }] })
    expect(drawn.props.dash).toBe("draw")
    expect(util.getRenderStyle(drawn).dash).toBe(getDashId("solid"))

    for (const dash of ["solid", "dashed", "dotted"] as const) {
      const shape = makeShape<DrawShape>("draw", { ...util.getDefaultProps(), dash, segments: [{ type: "free", points: zig }] })
      expect(util.getRenderStyle(shape).dash).toBe(getDashId(dash))
    }
    // …and only draw shapes are exempt: a geo shape styled `draw` still sketches.
    const geo = new GeoShapeUtil(editor)
    const box = makeShape("geo", { ...geo.getDefaultProps(), dash: "draw" })
    expect(geo.getRenderStyle(box as never).dash).toBe(getDashId("draw"))
  })

  it("onResize scales every point", () => {
    const shape = makeShape<DrawShape>("draw", {
      ...util.getDefaultProps(),
      segments: [{ type: "free", points: [{ x: 10, y: 10, z: 0.5 }, { x: 20, y: 40 }] }],
    })
    const next = util.onResize(shape, {
      newPoint: { x: 1, y: 2 },
      handle: "bottom_right",
      mode: "scale_shape",
      scaleX: 2,
      scaleY: 0.5,
      initialBounds: { x: 0, y: 0, w: 20, h: 40 },
      initialShape: shape,
    })
    expect(next.props?.segments[0]?.points).toEqual([{ x: 20, y: 5, z: 0.5 }, { x: 40, y: 20 }])
    expect(next.x).toBe(1)
  })
})

describe("LineShapeUtil", () => {
  const util = new LineShapeUtil(editor)
  const three = {
    b: { id: "b", index: "a2", x: 50, y: 40 },
    a: { id: "a", index: "a1", x: 0, y: 0 },
    c: { id: "c", index: "a3", x: 100, y: 0 },
  }

  it("sorts points by index and draws a polyline", () => {
    const shape = makeShape<LineShape>("line", { ...util.getDefaultProps(), points: three })
    const g = util.getGeometry(shape)
    expect(g).toBeInstanceOf(Polyline2d)
    expect(g.vertices.map((v) => v.x)).toEqual([0, 50, 100])
    expectWellFormedPath(g.toPathWords())
  })

  it("cubic spline passes through the points using cubics", () => {
    const shape = makeShape<LineShape>("line", { ...util.getDefaultProps(), spline: "cubic", points: three })
    const words = util.getGeometry(shape).toPathWords()
    expectWellFormedPath(words)
    expect(words.filter((w, i) => i % 7 === 3 && w === PATH_OP.CUBIC)).toHaveLength(2)
    expect(words.slice(1, 3)).toEqual([0, 0])
    expect(words.slice(-2)).toEqual([100, 0])
    // two points fall back to a straight line even in cubic mode
    const two = makeShape<LineShape>("line", { ...util.getDefaultProps(), spline: "cubic" })
    expect(util.getGeometry(two)).toBeInstanceOf(Polyline2d)
  })

  it("exposes vertex and virtual midpoint handles and moves points on drag", () => {
    const shape = makeShape<LineShape>("line", { ...util.getDefaultProps(), points: three })
    const handles = util.getHandles(shape)
    expect(handles.filter((h) => h.type === "vertex")).toHaveLength(3)
    const mids = handles.filter((h) => h.type === "virtual")
    expect(mids).toHaveLength(2)
    expect(mids[0]).toMatchObject({ x: 25, y: 20 })
    expect(mids[0]!.index > "a1" && mids[0]!.index < "a2").toBe(true)

    const moved = util.onHandleDrag(shape, { handle: { ...handles[0]!, x: 7, y: 8 } })
    expect(moved.props?.points.a).toMatchObject({ x: 7, y: 8 })
    expect(shape.props.points.a!.x).toBe(0)

    const added = util.onHandleDrag(shape, { handle: { ...mids[0]!, x: 30, y: 30 } })
    expect(Object.keys(added.props!.points)).toHaveLength(4)
    expect(added.props!.points[mids[0]!.id]).toMatchObject({ x: 30, y: 30, index: mids[0]!.index })
  })

  it("render style is stroke only", () => {
    const style = util.getRenderStyle(makeShape<LineShape>("line", util.getDefaultProps()))
    expectWellFormedStyle(style)
    expect(style.fill).toBe(0)
    expect(style.strokeWidth).toBe(3.5)
  })
})

describe("ArrowShapeUtil", () => {
  const util = new ArrowShapeUtil(editor)
  const base = () => ({ ...util.getDefaultProps(), end: { x: 200, y: 0 } })

  it("has the spec defaults", () => {
    const d = util.getDefaultProps()
    expect(d.start).toEqual({ x: 0, y: 0 })
    expect(d.end).toEqual({ x: 2, y: 0 })
    expect(d.bend).toBe(0)
    expect(d.arrowheadStart).toBe("none")
    expect(d.arrowheadEnd).toBe("arrow")
    expect(d.labelPosition).toBe(0.5)
  })

  it("straight arrow is a group of body + chevron, unfilled", () => {
    const shape = makeShape<ArrowShape>("arrow", base())
    const g = util.getGeometry(shape)
    expect(g).toBeInstanceOf(Group2d)
    const children = (g as Group2d).children
    expect(children).toHaveLength(2)
    expect(children[0]).toBeInstanceOf(Polyline2d)
    expect(children[1]).toBeInstanceOf(Polyline2d)
    expect(g.isFilled).toBe(false)
    expectWellFormedPath(g.toPathWords())
    expect(g.bounds.w).toBeCloseTo(200)
  })

  it("triangle head is filled and the body stops at its base", () => {
    const shape = makeShape<ArrowShape>("arrow", { ...base(), arrowheadEnd: "triangle", arrowheadStart: "dot" })
    const g = util.getGeometry(shape) as Group2d
    expect(g.children).toHaveLength(3)
    const body = g.children[0] as Polyline2d
    expect(body.isFilled).toBe(false)
    expect(body.points[0]!.x).toBeCloseTo(14) // dot inset
    expect(body.points[1]!.x).toBeCloseTo(186) // triangle inset
    expect(g.children[2]!.isFilled).toBe(true)
    expect(g.isFilled).toBe(true)
    expectWellFormedPath(g.toPathWords())
    const style = util.getRenderStyle(shape)
    expectWellFormedStyle(style)
    expect(style.fill).toBe(style.stroke)
  })

  it.each<ArrowheadKind>(["none", "arrow", "triangle", "square", "dot", "diamond", "inverted", "bar", "pipe"])(
    "arrowhead %s at both ends serializes cleanly",
    (kind) => {
      const shape = makeShape<ArrowShape>("arrow", { ...base(), bend: 30, arrowheadStart: kind, arrowheadEnd: kind })
      expectWellFormedPath(util.getGeometry(shape).toPathWords())
    },
  )

  it("bent arrow body is a cubic arc through the bend point", () => {
    const shape = makeShape<ArrowShape>("arrow", { ...base(), bend: 40, arrowheadEnd: "none" })
    const g = util.getGeometry(shape) as Group2d
    const words = g.toPathWords()
    expectWellFormedPath(words)
    expect(words[0]).toBe(PATH_OP.MOVE)
    expect(words[3]).toBe(PATH_OP.CUBIC)
    expect(g.bounds.h).toBeCloseTo(40, 0)
    const handles = util.getHandles(shape)
    const bend = handles.find((h) => h.id === "bend")!
    expect(bend.x).toBeCloseTo(100)
    expect(bend.y).toBeCloseTo(40)
  })

  it("handles update start/end/bend", () => {
    const shape = makeShape<ArrowShape>("arrow", base())
    const handles = util.getHandles(shape)
    expect(handles.map((h) => h.id)).toEqual(["start", "bend", "end"])
    const drag = (handle: (typeof handles)[number]) => util.onHandleDrag(shape, { handle, isPrecise: false })
    expect(drag({ ...handles[0]!, x: -5, y: 3 })?.props?.start).toEqual({ x: -5, y: 3 })
    expect(drag({ ...handles[2]!, x: 250, y: 9 })?.props?.end).toEqual({ x: 250, y: 9 })
    expect(drag({ ...handles[1]!, x: 100, y: 60 })?.props?.bend).toBeCloseTo(60)
    expect(drag({ ...handles[1]!, x: 100, y: 0.2 })?.props?.bend).toBe(0)
    expect(drag({ ...handles[1]!, id: "nope" })).toBeUndefined()
  })

  it("label rect is added and excluded from path words", () => {
    const plain = makeShape<ArrowShape>("arrow", base())
    const labelled = makeShape<ArrowShape>("arrow", { ...base(), text: "go" })
    const g = util.getGeometry(labelled) as Group2d
    expect(g.children.at(-1)!.isLabel).toBe(true)
    expect(g.toPathWords()).toEqual(util.getGeometry(plain).toPathWords())
    expect(g.children.at(-1)!.center.x).toBeCloseTo(100)
    expect(util.component(plain)).toBeNull()
    expect(util.component(labelled)).not.toBeNull()
  })
})

describe("TextShapeUtil", () => {
  const util = new TextShapeUtil(editor)

  it("renders in the overlay only", () => {
    const shape = makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "hi" })
    expect(util.getRenderStyle(shape)).toBeNull()
    expect(util.canEdit(shape)).toBe(true)
    expect(util.isAspectRatioLocked(shape)).toBe(false)
    expect(util.component(shape)).not.toBeNull()
  })

  it("geometry is w × estimated wrapped height", () => {
    const one = makeShape<TextShape>("text", { ...util.getDefaultProps(), w: 200, text: "short" })
    const g1 = util.getGeometry(one)
    expectWellFormedPath(g1.toPathWords())
    expect(g1.bounds.w).toBe(200)
    expect(g1.bounds.h).toBeCloseTo(24 * 1.3)
    expect(g1.isFilled).toBe(true)

    const wrapped = makeShape<TextShape>("text", { ...util.getDefaultProps(), w: 100, autoSize: false, text: "a".repeat(30) })
    // 100 / (24 * 0.6) = 6 chars per line → 5 lines
    expect(util.getGeometry(wrapped).bounds.h).toBeCloseTo(5 * 24 * 1.3)

    const multi = makeShape<TextShape>("text", { ...util.getDefaultProps(), w: 500, text: "a\nb\n\nc", scale: 2 })
    expect(util.getGeometry(multi).bounds.h).toBeCloseTo(4 * 48 * 1.3)
  })

  it("resizing changes width and disables auto-size", () => {
    const shape = makeShape<TextShape>("text", { ...util.getDefaultProps(), w: 100 })
    const next = util.onResize(shape, {
      newPoint: { x: 0, y: 0 },
      handle: "right",
      mode: "resize_bounds",
      scaleX: 3,
      scaleY: 1,
      initialBounds: { x: 0, y: 0, w: 100, h: 30 },
      initialShape: shape,
    })
    expect(next.props?.w).toBe(300)
    expect(next.props?.autoSize).toBe(false)
  })
})

describe("NoteShapeUtil", () => {
  const util = new NoteShapeUtil(editor)

  it("is a fixed 200×200 filled square plus growY", () => {
    const shape = makeShape<NoteShape>("note", { ...util.getDefaultProps(), growY: 40 })
    const g = util.getGeometry(shape)
    expect(g.bounds).toEqual(new Box(0, 0, 200, 240))
    expect(g.isFilled).toBe(true)
    expectWellFormedPath(g.toPathWords())
    expect(util.hideResizeHandles(shape)).toBe(true)
    expect(util.canEdit(shape)).toBe(true)
  })

  it("fills with the note color and has no stroke", () => {
    const style = util.getRenderStyle(makeShape<NoteShape>("note", { ...util.getDefaultProps(), color: "yellow" }))
    expectWellFormedStyle(style)
    expect(style.fill).toBe(0xfbe9c9ff)
    expect(style.stroke).toBe(0)
    expect(style.strokeWidth).toBe(0)
  })

  it("uses the size style unless the stored adjustment is a plausible font size", () => {
    const props = { ...util.getDefaultProps(), text: "Sticky note" }
    expect(getNoteFontSize(makeShape<NoteShape>("note", { ...props, fontSizeAdjustment: 0 }))).toBe(FONT_SIZES.m)
    // A placeholder `1` would otherwise render the label at one pixel.
    expect(getNoteFontSize(makeShape<NoteShape>("note", { ...props, fontSizeAdjustment: 1 }))).toBe(FONT_SIZES.m)
    expect(getNoteFontSize(makeShape<NoteShape>("note", { ...props, fontSizeAdjustment: 14 }))).toBe(14)
    expect(getNoteFontSize(makeShape<NoteShape>("note", { ...props, fontSizeAdjustment: 14, scale: 2 }))).toBe(28)
  })

  it("reads a shape whose props are missing or misshapen without throwing", () => {
    const shape = { ...makeShape<NoteShape>("note", util.getDefaultProps()), props: { text: null, size: "enormous", scale: "1" } } as unknown as NoteShape
    expect(util.getGeometry(shape).bounds).toEqual(new Box(0, 0, 200, 200))
    expect(util.getText(shape)).toBe("")
    expect(util.hasOverlayLabel(shape)).toBe(true)
    expectWellFormedStyle(util.getRenderStyle(shape))
  })
})

describe("FrameShapeUtil", () => {
  const util = new FrameShapeUtil(editor)

  it("defaults to 160×90 with an empty name", () => {
    expect(util.getDefaultProps()).toEqual({ w: 160, h: 90, name: "" })
    const shape = makeShape<FrameShape>("frame", util.getDefaultProps())
    const g = util.getGeometry(shape)
    expect(g.bounds).toEqual(new Box(0, 0, 160, 90))
    expect(g.isFilled).toBe(true)
    expectWellFormedPath(g.toPathWords())
  })

  it("draws white with a thin grey border and accepts children", () => {
    const shape = makeShape<FrameShape>("frame", util.getDefaultProps())
    const style = util.getRenderStyle(shape)
    expectWellFormedStyle(style)
    expect(style.fill).toBe(0xffffffff)
    // The measured reference border: a neutral grey, not a blue-grey.
    expect(FRAME_STROKE).toBe("#717171")
    expect(style.stroke).toBe(0x717171ff)
    expect(style.strokeWidth).toBe(FRAME_STROKE_WIDTH)
    expect(FRAME_STROKE_WIDTH).toBe(1)
    expect(util.canReceiveNewChildrenOfType(shape, "geo")).toBe(true)
    expect(util.canDropShapes(shape, [])).toBe(true)
    expect(util.component(shape)).not.toBeNull()
    expect(util.indicator(shape)).not.toBeNull()
  })
})

describe("shape chrome constants", () => {
  const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")

  /** Any `#rgb`/`#rrggbb`/`rgb()`/`rgba()` literal outside a comment. */
  function colorLiterals(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    return withoutComments.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? []
  }

  it("leaves no colour literals in the note and frame components", () => {
    expect(colorLiterals(read("./NoteShapeUtil.tsx"))).toEqual([])
    expect(colorLiterals(read("./FrameShapeUtil.tsx"))).toEqual([])
  })

  it("names the frame chrome in the theme", () => {
    expect(FRAME_STROKE).toBe("#717171")
    expect(FRAME_NAME_COLOR).toBe("#5f5f5f")
    // Darker than the border it labels, and darker than it used to be (#5c6470).
    const luma = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16)
      return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)
    }
    expect(luma(FRAME_NAME_COLOR)).toBeLessThan(luma("#5c6470"))
    // The name sits two pixels higher than the four-pixel gap it used to have.
    expect(FRAME_NAME_GAP).toBe(6)
    expect(FRAME_NAME_HEIGHT).toBe(FRAME_NAME_OFFSET - FRAME_NAME_GAP)
  })

  it("gradates a note body from a deeper top to the palette's note fill", () => {
    // Measured off the reference render for the default (black) note.
    expect(getNoteFillCssColor("black")).toBe("#fce19c")
    expect(getNoteGradientTopCssColor("black")).toBe("#f7dc99")
    const css = getNoteBodyGradientCss("black")
    expect(css).toBe("linear-gradient(to bottom, #f7dc99 0%, #fce19c 100%)")
    // Every hue gradates, never inverts.
    for (const color of ["yellow", "blue", "red", "white"] as const) {
      expect(getNoteGradientTopCssColor(color) < getNoteFillCssColor(color)).toBe(true)
    }
  })

  it("builds a note shadow that scales with the note", () => {
    expect(getNoteShadowCss()).toBe(`0 ${NOTE_SHADOW_OFFSET_Y}px ${NOTE_SHADOW_BLUR}px rgba(21, 34, 35, ${NOTE_SHADOW_OPACITY})`)
    expect(NOTE_SHADOW_COLOR).toBe("#152223")
    expect(getNoteShadowCss(2)).toContain(`0 ${NOTE_SHADOW_OFFSET_Y * 2}px ${NOTE_SHADOW_BLUR * 2}px`)
  })
})

describe("note shadow is decoration only", () => {
  const util = new NoteShapeUtil(editor)

  it("leaves geometry, bounds and hit-testing untouched", () => {
    const shape = makeShape<NoteShape>("note", { ...util.getDefaultProps(), growY: 40 })
    const g = util.getGeometry(shape)
    // The body is exactly the note's box: nothing is added below it for the shadow.
    expect(g.bounds).toEqual(new Box(0, 0, 200, 240))
    expect(g.isFilled).toBe(true)
    // A point inside the shadow strip below the note is outside the shape.
    expect(g.hitTestPoint({ x: 100, y: 240 + NOTE_SHADOW_OFFSET_Y }, 0, true)).toBe(false)
    expect(g.hitTestPoint({ x: 100, y: 239 }, 0, true)).toBe(true)
  })

  it("keeps the engine quad a flat fill with no stroke", () => {
    const shape = makeShape<NoteShape>("note", { ...util.getDefaultProps(), color: "yellow" })
    const style = util.getRenderStyle(shape)
    expectWellFormedStyle(style)
    // The flat quad is the gradient's bottom stop; the trim rides on top of it.
    expect(style.fill).toBe(0xfbe9c9ff)
    expect(style.stroke).toBe(0)
  })
})
