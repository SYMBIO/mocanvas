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
