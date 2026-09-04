import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  createStore,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  Editor,
  GeoShapeGeoStyle,
  getStylePropsOf,
  loadEngineSync,
  StateNode,
  type ShapeId,
} from "@mocanvas/editor"
import { getStylePanelSections, hasAnyStyleSection } from "./StylePanel"
import {
  ArrowShapeUtil,
  DrawShapeUtil,
  FrameShapeUtil,
  GeoShapeUtil,
  LineShapeUtil,
  NoteShapeUtil,
  TextShapeUtil,
  defaultShapeUtils,
  getDashId,
  type GeoShape,
  type GeoShapeUtil as GeoUtil,
} from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { defaultTools } from "../tools"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function lastShapeId(editor: Editor): ShapeId {
  return editor.getCurrentPageShapes().at(-1)!.id
}

function createGeo(editor: Editor, props: Partial<GeoShape["props"]> = {}): GeoShape {
  editor.createShape<GeoShape>({ type: "geo", x: 0, y: 0, props })
  return editor.getShape<GeoShape>(lastShapeId(editor))!
}

describe("static style props", () => {
  it("declares the style props of each default shape util", () => {
    expect(Object.fromEntries(getStylePropsOf(GeoShapeUtil.props))).toEqual({
      geo: GeoShapeGeoStyle,
      color: DefaultColorStyle,
      labelColor: DefaultLabelColorStyle,
      fill: DefaultFillStyle,
      dash: DefaultDashStyle,
      size: DefaultSizeStyle,
      font: DefaultFontStyle,
      align: DefaultHorizontalAlignStyle,
      verticalAlign: DefaultVerticalAlignStyle,
    })
    expect(Object.fromEntries(getStylePropsOf(DrawShapeUtil.props))).toEqual({
      color: DefaultColorStyle,
      fill: DefaultFillStyle,
      dash: DefaultDashStyle,
      size: DefaultSizeStyle,
    })
    expect(Object.fromEntries(getStylePropsOf(LineShapeUtil.props))).toEqual({
      color: DefaultColorStyle,
      dash: DefaultDashStyle,
      size: DefaultSizeStyle,
    })
    expect(Object.fromEntries(getStylePropsOf(ArrowShapeUtil.props))).toEqual({
      color: DefaultColorStyle,
      labelColor: DefaultLabelColorStyle,
      fill: DefaultFillStyle,
      dash: DefaultDashStyle,
      size: DefaultSizeStyle,
      font: DefaultFontStyle,
    })
    expect(Object.fromEntries(getStylePropsOf(TextShapeUtil.props))).toEqual({
      color: DefaultColorStyle,
      size: DefaultSizeStyle,
      font: DefaultFontStyle,
      textAlign: DefaultHorizontalAlignStyle,
    })
    expect(Object.fromEntries(getStylePropsOf(NoteShapeUtil.props))).toEqual({
      color: DefaultColorStyle,
      labelColor: DefaultLabelColorStyle,
      size: DefaultSizeStyle,
      font: DefaultFontStyle,
      align: DefaultHorizontalAlignStyle,
      verticalAlign: DefaultVerticalAlignStyle,
    })
    expect(getStylePropsOf(FrameShapeUtil.props).size).toBe(0)
  })

  it("every declared style key is a real prop with a valid default", () => {
    for (const Util of defaultShapeUtils) {
      const defaults = new Util({} as Editor).getDefaultProps() as Record<string, unknown>
      for (const [key, style] of getStylePropsOf(Util.props)) {
        expect(key in defaults, `${Util.type}.${key}`).toBe(true)
        expect(() => style.validate(defaults[key]), `${Util.type}.${key}`).not.toThrow()
      }
    }
  })
})

describe("editor styles", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("reads shared styles from one selected geo shape", () => {
    const geo = createGeo(editor, { color: "blue", fill: "semi", dash: "dashed" })
    editor.select(geo.id)
    const styles = editor.getSharedStyles()
    expect(styles.get(DefaultColorStyle)).toEqual({ type: "shared", value: "blue" })
    expect(styles.get(DefaultFillStyle)).toEqual({ type: "shared", value: "semi" })
    expect(styles.get(DefaultDashStyle)).toEqual({ type: "shared", value: "dashed" })
    expect(styles.get(GeoShapeGeoStyle)).toEqual({ type: "shared", value: "rectangle" })
    expect(styles.getAsKnownValue(DefaultSizeStyle)).toBe("m")
    expect(styles.size).toBe(getStylePropsOf(GeoShapeUtil.props).size)
  })

  it("reports mixed when two geos disagree and shared where they agree", () => {
    const a = createGeo(editor, { color: "blue" })
    const b = createGeo(editor, { color: "red" })
    editor.select(a.id, b.id)
    const styles = editor.getSharedStyles()
    expect(styles.get(DefaultColorStyle)).toEqual({ type: "mixed" })
    expect(styles.getAsKnownValue(DefaultColorStyle)).toBeUndefined()
    expect(styles.get(DefaultFillStyle)).toEqual({ type: "shared", value: "none" })
  })

  it("setStyleForSelectedShapes updates every selected shape that declares the style", () => {
    const a = createGeo(editor, { color: "blue" })
    const b = createGeo(editor, { color: "green" })
    editor.createShape({ type: "frame", x: 0, y: 0 })
    const frameId = lastShapeId(editor)
    editor.select(a.id, b.id, frameId)

    editor.markHistoryStoppingPoint("style")
    editor.setStyleForSelectedShapes(DefaultColorStyle, "red")

    expect(editor.getShape<GeoShape>(a.id)!.props.color).toBe("red")
    expect(editor.getShape<GeoShape>(b.id)!.props.color).toBe("red")
    expect((editor.getShape(frameId)!.props as { color?: string }).color).toBeUndefined()
    expect(editor.getSharedStyles().get(DefaultColorStyle)).toEqual({ type: "shared", value: "red" })

    editor.undo()
    expect(editor.getShape<GeoShape>(a.id)!.props.color).toBe("blue")
    expect(editor.getShape<GeoShape>(b.id)!.props.color).toBe("green")
  })

  it("setStyleForNextShapes is applied to newly created shapes", () => {
    editor.setStyleForNextShapes(DefaultColorStyle, "red")
    editor.setStyleForNextShapes(DefaultDashStyle, "dotted")
    expect(editor.getStyleForNextShape(DefaultColorStyle)).toBe("red")
    // With nothing selected the shared styles describe the next shape.
    expect(editor.getSharedStyles().get(DefaultColorStyle)).toEqual({ type: "shared", value: "red" })

    editor.createShape({ type: "geo" })
    const geo = editor.getShape<GeoShape>(lastShapeId(editor))!
    expect(geo.props.color).toBe("red")
    expect(geo.props.dash).toBe("dotted")
    expect(geo.props.fill).toBe("none")

    // Explicit props win over the remembered style.
    const explicit = createGeo(editor, { color: "blue" })
    expect(explicit.props.color).toBe("blue")
  })

  it("geo and arrow render styles carry the dash id of the dash prop", () => {
    const util = editor.getShapeUtil<GeoShape>("geo") as GeoUtil
    const draw = createGeo(editor, { dash: "draw" })
    const solid = createGeo(editor, { dash: "solid" })
    const dashed = createGeo(editor, { dash: "dashed" })
    const dotted = createGeo(editor, { dash: "dotted" })
    expect(util.getRenderStyle(draw).dash).toBe(getDashId("draw"))
    expect(util.getRenderStyle(solid).dash).toBe(getDashId("solid"))
    expect(util.getRenderStyle(dashed).dash).toBe(getDashId("dashed"))
    expect(util.getRenderStyle(dotted).dash).toBe(getDashId("dotted"))
    expect(new Set([draw, solid, dashed, dotted].map((s) => util.getRenderStyle(s).dash)).size).toBe(4)

    editor.select(draw.id)
    editor.setStyleForSelectedShapes(DefaultDashStyle, "dashed")
    expect(util.getRenderStyle(editor.getShape<GeoShape>(draw.id)!).dash).toBe(getDashId("dashed"))

    editor.createShape({ type: "arrow", x: 0, y: 0, props: { dash: "dotted" } })
    const arrow = editor.getShape(lastShapeId(editor))!
    expect(editor.getShapeUtil(arrow).getRenderStyle(arrow)?.dash).toBe(getDashId("dotted"))
  })
})

// ---------------------------------------------------------------------------
// Style panel
// ---------------------------------------------------------------------------

/** An editor with the real tool set, so the "creating" fallback can be driven. */
function makeToolEditor(): Editor {
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

describe("style panel sections", () => {
  let editor: Editor

  beforeEach(() => {
    editor = makeToolEditor()
  })

  const select = (type: string, props: Record<string, unknown> = {}): void => {
    editor.createShape({ type, x: 0, y: 0, props })
    editor.setSelectedShapes([lastShapeId(editor)])
  }

  it("shows every row a geo shape can carry", () => {
    select("geo", { geo: "rectangle", w: 10, h: 10 })
    const s = getStylePanelSections(editor)
    expect(s.shape).toBe(true)
    expect(s.color).toBe(true)
    expect(s.fill).toBe(true)
    expect(s.font).toBe(true)
    expect(s.align).toBe(true)
    expect(s.verticalAlign).toBe(true)
    expect(s.opacity).toBe(true)
  })

  it("omits the text rows for a selection that carries no text style", () => {
    select("line")
    const s = getStylePanelSections(editor)
    expect(s.color).toBe(true)
    expect(s.dash).toBe(true)
    expect(s.size).toBe(true)
    // A line has no label, so Font, Align and Vertical align must not appear.
    expect(s.font).toBe(false)
    expect(s.align).toBe(false)
    expect(s.verticalAlign).toBe(false)
    expect(s.shape).toBe(false)
    expect(s.fill).toBe(false)
  })

  it("omits Shape, Fill and Vertical align for a text shape", () => {
    select("text", { text: "hi" })
    const s = getStylePanelSections(editor)
    expect(s.font).toBe(true)
    expect(s.align).toBe(true)
    expect(s.verticalAlign).toBe(false)
    expect(s.shape).toBe(false)
    expect(s.fill).toBe(false)
    expect(s.dash).toBe(false)
  })

  it("shows a row a mixed selection partly carries, and drops one it never carries", () => {
    // Shared styles are the union over the selection: a row shows when at least
    // one selected shape declares it, and setting it skips the shapes that do
    // not. Two lines carry no Font at all, so that row disappears.
    editor.createShape({ type: "line", x: 0, y: 0, props: {} })
    const line = lastShapeId(editor)
    editor.createShape({ type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 10, h: 10 } })
    editor.setSelectedShapes([line, lastShapeId(editor)])
    expect(getStylePanelSections(editor).font).toBe(true)

    editor.createShape({ type: "line", x: 0, y: 0, props: {} })
    editor.setSelectedShapes([line, lastShapeId(editor)])
    const s = getStylePanelSections(editor)
    expect(s.color).toBe(true)
    expect(s.font).toBe(false)
    expect(s.shape).toBe(false)
    expect(s.fill).toBe(false)
  })

  it("shows nothing with an empty selection and a non-creating tool", () => {
    editor.selectNone()
    editor.setCurrentTool("select")
    expect(hasAnyStyleSection(getStylePanelSections(editor))).toBe(false)
  })

  it("falls back to the active drawing tool when nothing is selected", () => {
    editor.selectNone()
    editor.setCurrentTool("geo")
    const s = getStylePanelSections(editor)
    expect(s.shape).toBe(true)
    expect(s.color).toBe(true)
    // Opacity edits the selection, so it stays out with nothing selected.
    expect(s.opacity).toBe(false)
  })

  it("offers a line tool only the styles a line carries", () => {
    editor.selectNone()
    editor.setCurrentTool("line")
    const s = getStylePanelSections(editor)
    expect(s.color).toBe(true)
    expect(s.dash).toBe(true)
    expect(s.font).toBe(false)
    expect(s.shape).toBe(false)
  })
})
