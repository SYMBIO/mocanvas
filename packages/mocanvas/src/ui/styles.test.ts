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

/**
 * The bottom edge stacks four rows — the actions row, the toolbar, the zoom
 * bar and the stats chip — and three of them are placed relative to the
 * toolbar. The toolbar's own offset moves twice as the layout narrows, and
 * each rule that recomputed it was a chance for the rows above to be left
 * behind: the actions row shipped drawn on top of the toolbar because two
 * rules disagreed, and again at phone width because a third one did.
 *
 * So the offset is published once, as a variable, and this asserts that it
 * stays that way — the kind of invariant no rendering test can see, because
 * jsdom lays nothing out and a screenshot only covers the width you took it at.
 */
describe("the bottom edge's stacking", () => {
  const css = readFileSync(fileURLToPath(new URL("./ui.css", import.meta.url)), "utf8")

  /** Every `bottom:` declaration in a rule whose selector mentions the toolbar. */
  function toolbarBottomDeclarations(): string[] {
    const found: string[] = []
    for (const match of css.matchAll(/\.mocanvas-toolbar[^{]*\{([^}]*)\}/g)) {
      for (const decl of match[1]!.split(";")) {
        if (/^\s*bottom\s*:/.test(decl)) found.push(decl.trim())
      }
    }
    return found
  }

  it("places the toolbar from the published variable and nowhere else", () => {
    const declarations = toolbarBottomDeclarations()
    expect(declarations, "the toolbar is not placed at all").toHaveLength(1)
    expect(declarations[0], "a second rule computes the toolbar's offset — the rows above it will not follow").toBe(
      "bottom: var(--mocanvas-ui-toolbar-bottom)",
    )
  })

  it("stacks everything above the toolbar off that same variable", () => {
    for (const selector of [".mocanvas-quick-actions", ".mocanvas-style-dock", ".mocanvas-helper-buttons"]) {
      const rule = css.match(new RegExp(`\\${selector}[^{]*\\{([^}]*)\\}`))
      expect(rule, `${selector} has no rule`).not.toBeNull()
      expect(rule![1], `${selector} is placed by its own arithmetic rather than from the toolbar`).toMatch(/--mocanvas-ui-toolbar-bottom/)
    }
  })

  /*
   * Sharing a line is not the same as fitting on one. The actions row was
   * centred on the whole container with `translateX(-50%)` while the style
   * dock held the right end of the same line, and on a phone-width embed the
   * row grew out from the centre until the two overlapped — the dock drawn on
   * top of the last action. Same class of bug as the rows above disagreeing
   * about the toolbar's offset, one axis over.
   */
  it("leaves the style dock its end of the actions row's line", () => {
    const row = css.match(/\.mocanvas-quick-actions[^{]*\{([^}]*)\}/)
    expect(row![1], "the row is centred on the container, so its width is free to reach the dock").not.toMatch(
      /translateX/,
    )
    expect(row![1], "the row is not centred between the insets the way the toolbar is").toMatch(/margin-inline:\s*auto/)
    expect(row![1], "a row too wide for its line has nowhere to go but over its neighbours").toMatch(
      /flex-wrap:\s*wrap/,
    )

    const reservation = css.match(/:has\(> \.mocanvas-style-dock\) > \.mocanvas-quick-actions\s*\{([^}]*)\}/)
    expect(reservation, "nothing keeps the row off the dock").not.toBeNull()
    expect(reservation![1], "the reservation does not account for the dock's width").toMatch(/--mocanvas-ui-row/)
  })
})

/**
 * The chrome's width rules ask the container, never the window.
 *
 * `BreakPointProvider` measures the editor's container and says why in its own
 * comment: an editor embedded in a sidebar is narrow even on a wide screen,
 * and a media query cannot see that. The stylesheet did not follow. An editor
 * in a 606px column of a 1600px window kept the desktop reservation, so the
 * toolbar's `max-width: calc(100% - 624px)` came out negative and the bar
 * stacked one button per row down the middle of the canvas — on a screen wide
 * enough that nothing about the window suggested a narrow layout.
 *
 * `prefers-color-scheme` and `prefers-reduced-motion` are about the reader,
 * not the room, and stay media queries.
 */
describe("the chrome measures its container", () => {
  const css = readFileSync(fileURLToPath(new URL("./ui.css", import.meta.url)), "utf8")

  it("asks no media query about width", () => {
    const widthQueries = [...css.matchAll(/@media[^{]*\((?:max|min)-width[^{]*\{/g)].map((match) => match[0].trim())
    expect(widthQueries, "a width rule that the window answers and the container cannot").toEqual([])
  })

  it("asks the container instead", () => {
    const containerQueries = [...css.matchAll(/@container\s+([\w-]+)\s*\(/g)].map((match) => match[1])
    expect(containerQueries.length, "no container query at all — the narrow layout has nowhere to come from").toBeGreaterThan(0)
    for (const name of containerQueries) {
      expect(name, "a container query naming something other than the container Mocanvas names").toBe("mocanvas-ui")
    }
  })

  it("names the container it queries", () => {
    // The two halves are in different files and neither fails loudly on its
    // own: a container that is not named answers no query, and every rule in
    // here quietly reverts to the wide layout.
    const component = readFileSync(fileURLToPath(new URL("../Mocanvas.tsx", import.meta.url)), "utf8")
    expect(component, "`Mocanvas` no longer names a container for the stylesheet to ask").toMatch(
      /containerName:\s*"mocanvas-ui"/,
    )
    expect(component, "the named container is not a query container").toMatch(/containerType:\s*"inline-size"/)
  })
})


/**
 * `--mocanvas-ui-dock` is read by JavaScript as well as by the cascade.
 *
 * `readBarMetrics` parses this property to decide how many tools stay inline,
 * with `Number.parseFloat`. A `calc()` — the obvious way to write "a button and
 * a half" — parses to `NaN`, the fallback of 300 takes over, and the toolbar
 * silently collapses to two buttons on a 600px canvas. The declaration has to
 * stay a plain length.
 */
describe("the toolbar's reservation stays readable by both halves", () => {
  const css = readFileSync(fileURLToPath(new URL("./ui.css", import.meta.url)), "utf8")

  it("is a plain length everywhere any of the three are set", () => {
    const values = [...css.matchAll(/--mocanvas-ui-dock(?:-left|-right)?:\s*([^;]+);/g)].map((match) => match[1]!.trim())
    expect(values.length, "nothing reserves room for the docks at all").toBeGreaterThan(0)
    for (const value of values) {
      // `var()` is substituted into a custom property's computed value, so
      // `parseFloat` still sees a length through one; `calc()` is not, and
      // reads as `NaN`.
      expect(value, "a value `parseFloat` cannot read — the bar will fall back to 300px").toMatch(
        /^(\d+(\.\d+)?px|var\(--mocanvas-ui-dock\))$/,
      )
    }
  })

  it("is read per side by the code that splits the bar", () => {
    // The stylesheet reserves the two ends separately — the stats chip is a
    // debug panel and usually absent — and the split has to reserve the same
    // two, or the bar keeps room for a plate that is not on the row.
    const bar = readFileSync(fileURLToPath(new URL("./toolbar-items.tsx", import.meta.url)), "utf8")
    expect(bar, "the split still reserves one symmetric dock").toMatch(/--mocanvas-ui-dock-left/)
    expect(bar, "the split still reserves one symmetric dock").toMatch(/--mocanvas-ui-dock-right/)
  })
})


/**
 * The popover plate says nothing about what is in it.
 *
 * It was five 40px columns itself, and every popover opened through
 * `TldrawUiPopoverContent` wraps its children in one element — so those columns
 * laid nothing out and only fixed the plate at five buttons wide whatever it
 * held. The toolbar's spill-over is four across and sat there with an empty
 * fifth column beside it; the style panel is 292px of rows and hung out of the
 * plate altogether. Two visible bugs from one rule describing the wrong thing.
 */
describe("the popover plate", () => {
  const css = readFileSync(fileURLToPath(new URL("./ui.css", import.meta.url)), "utf8")

  it("does not impose a column count on its contents", () => {
    const rule = css.match(/\.mocanvas-popover\s*\{([^}]*)\}/)
    expect(rule, ".mocanvas-popover has no rule at all").not.toBeNull()
    expect(rule![1], "the plate is a grid again, so its width is a column count rather than its content").not.toMatch(
      /grid-template-columns/,
    )
  })

  it("leaves the grid to the popover that lays its own children out", () => {
    // `Popover` in overlays.tsx passes buttons straight in rather than
    // wrapping them, so for that one the columns are real.
    const component = readFileSync(fileURLToPath(new URL("./overlays.tsx", import.meta.url)), "utf8")
    expect(component, "the picker popover no longer carries the class that grids it").toMatch(
      /mocanvas-popover mocanvas-popover-grid/,
    )
    const rule = css.match(/\.mocanvas-popover-grid\s*\{([^}]*)\}/)
    expect(rule![1], "and that class no longer grids anything").toMatch(/grid-template-columns/)
  })
})


/**
 * Two class names that were written without a rule.
 *
 * Both failed the same way and neither showed up in a test: the element
 * rendered, the cascade had nothing to say about it, and the browser fell back
 * to normal flow. The actions row landed unstyled at the top of the canvas;
 * the toolbar's spill-over became a column of nine buttons taller than the
 * canvas. A class the markup uses and the stylesheet has never heard of is a
 * bug that only a screenshot can see — unless something asserts the pair.
 */
describe("every class the chrome relies on has a rule", () => {
  const css = readFileSync(fileURLToPath(new URL("./ui.css", import.meta.url)), "utf8")

  it.each([
    ["mocanvas-toolbar-overflow", /display:\s*grid/],
    ["mocanvas-action-row", /display:\s*flex/],
    ["mocanvas-popover", /display:\s*block/],
  ])("%s is laid out, not left to normal flow", (className, expected) => {
    const rule = css.match(new RegExp(`\\.${className}[^{]*\\{([^}]*)\\}`))
    expect(rule, `.${className} has no rule at all`).not.toBeNull()
    expect(rule![1], `.${className} renders but nothing lays it out`).toMatch(expected)
  })
})
