import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createStore,
  Editor,
  loadEngineSync,
  Rectangle2d,
  ShapeUtil,
  StateNode,
  type BaseShape,
  type ShapeId,
  type ShapeSvgContext,
  type StyleWords,
} from "@mocanvas/editor"
import { defaultBindingUtils } from "../bindings"
import { defaultShapeUtils } from "../shapes"
import { registerShapeSvgRenderer, shapeSvgRenderers, svgResultToMarkup } from "./shape-svg"
import { getSvgString } from "./svg"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

type BoxProps = { w: number; h: number }
type SigilShape = BaseShape<"sigil", BoxProps>
type RelicShape = BaseShape<"relic", BoxProps>
type BlobShape = BaseShape<"blob", BoxProps>
type BannerShape = BaseShape<"banner", BoxProps>

const STYLE: StyleWords = { fill: 0x00ff00ff, stroke: 0x0000ffff, strokeWidth: 2, dash: 0, opacity: 1 }

abstract class TestBoxUtil<T extends BaseShape<string, BoxProps>> extends ShapeUtil<T> {
  getDefaultProps() {
    return { w: 40, h: 30 }
  }
  getGeometry(shape: T) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return STYLE
  }
}

/** Has its own `toSvg` *and* a registered renderer: the util must win. */
class SigilShapeUtil extends TestBoxUtil<SigilShape> {
  static override type = "sigil" as const
  seen: ShapeSvgContext[] = []
  override toSvg(shape: SigilShape, ctx: ShapeSvgContext) {
    this.seen.push(ctx)
    return <circle data-source="util" cx={shape.props.w / 2} cy={shape.props.h / 2} r={4} />
  }
}

/** No `toSvg`: the registry entry below is what should be drawn. */
class RelicShapeUtil extends TestBoxUtil<RelicShape> {
  static override type = "relic" as const
}

/** Neither a `toSvg` nor a registry entry: the geometry fallback. */
class BlobShapeUtil extends TestBoxUtil<BlobShape> {
  static override type = "blob" as const
}

/** Returns raw markup rather than a node, and paints a backdrop. */
class BannerShapeUtil extends TestBoxUtil<BannerShape> {
  static override type = "banner" as const
  override toSvg(shape: BannerShape) {
    return `<rect data-source="string" width="${shape.props.w}" height="${shape.props.h}"/>`
  }
  override toBackgroundSvg(_shape: BannerShape, ctx: ShapeSvgContext) {
    return `<rect data-source="backdrop" width="1000" height="1000" fill="${ctx.background}"/>`
  }
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [...defaultShapeUtils, SigilShapeUtil, RelicShapeUtil, BlobShapeUtil, BannerShapeUtil],
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function lastId(editor: Editor): ShapeId {
  return editor.getCurrentPageShapes().at(-1)!.id
}

describe("SVG export precedence", () => {
  let editor: Editor

  beforeEach(() => {
    editor = makeEditor()
    registerShapeSvgRenderer<SigilShape>("sigil", () => `<rect data-source="registry" width="40" height="30"/>`)
    registerShapeSvgRenderer<RelicShape>("relic", () => `<rect data-source="registry" width="40" height="30"/>`)
  })

  afterEach(() => {
    shapeSvgRenderers.delete("sigil")
    shapeSvgRenderers.delete("relic")
  })

  it("prefers the util's own toSvg over a registered renderer", () => {
    editor.createShape<SigilShape>({ type: "sigil", x: 0, y: 0 })
    const { svg } = getSvgString(editor, [lastId(editor)], { padding: 0 })!
    expect(svg).toContain('data-source="util"')
    expect(svg).not.toContain('data-source="registry"')
    // The React node was serialized into the document, in shape-local space.
    expect(svg).toContain('<circle data-source="util" cx="20" cy="15" r="4"')
  })

  it("uses a registered renderer when the util has no toSvg", () => {
    editor.createShape<RelicShape>({ type: "relic", x: 0, y: 0 })
    const { svg } = getSvgString(editor, [lastId(editor)], { padding: 0 })!
    expect(svg).toContain('data-source="registry"')
    expect(svg).toContain('data-shape-type="relic"')
    expect(svg).not.toContain("<path")
  })

  it("falls back to the geometry when there is neither", () => {
    editor.createShape<BlobShape>({ type: "blob", x: 0, y: 0 })
    const { svg } = getSvgString(editor, [lastId(editor)], { padding: 0 })!
    expect(svg).not.toContain("data-source=")
    expect(svg).toContain('<path d="M0 0 L40 0 L40 30 L0 30 Z"')
    expect(svg).toContain('fill="#00ff00"')
  })

  it("hands the export context to toSvg", () => {
    editor.createShape<SigilShape>({ type: "sigil", x: 0, y: 0 })
    const util = editor.getShapeUtil(editor.getShape(lastId(editor))!) as SigilShapeUtil
    getSvgString(editor, [lastId(editor)], { darkMode: true, padding: 0 })
    expect(util.seen).toEqual([{ darkMode: true, background: "#101011" }])
  })

  it("takes raw markup from toSvg and draws toBackgroundSvg behind every shape", () => {
    editor.createShape<BannerShape>({ type: "banner", x: 0, y: 0 })
    const bannerId = lastId(editor)
    editor.createShape<BlobShape>({ type: "blob", x: 100, y: 0 })
    const { svg } = getSvgString(editor, [bannerId, lastId(editor)], { padding: 0 })!
    expect(svg).toContain('data-source="string"')
    expect(svg).toContain('data-shape-background="true"')
    // The backdrop precedes both shapes, not just its own.
    expect(svg.indexOf('data-source="backdrop"')).toBeLessThan(svg.indexOf('data-source="string"'))
    expect(svg.indexOf('data-source="backdrop"')).toBeLessThan(svg.indexOf('data-shape-type="blob"'))
    // It carries the shape's page transform like any other shape group.
    expect(svg).toMatch(/<g transform="matrix\([^"]+\) *"? *data-shape-type="banner" data-shape-background="true">/)
  })

  it("adds no backdrop for shapes without toBackgroundSvg", () => {
    editor.createShape<BlobShape>({ type: "blob", x: 0, y: 0 })
    const { svg } = getSvgString(editor, [lastId(editor)], { padding: 0 })!
    expect(svg).not.toContain("data-shape-background")
  })
})

describe("svgResultToMarkup", () => {
  it("passes strings through, serializes nodes and drops React's empty values", () => {
    expect(svgResultToMarkup("<rect/>")).toBe("<rect/>")
    expect(svgResultToMarkup(<circle r={2} />)).toBe('<circle r="2"></circle>')
    expect(svgResultToMarkup(undefined)).toBeUndefined()
    expect(svgResultToMarkup(null)).toBeUndefined()
    expect(svgResultToMarkup(false)).toBeUndefined()
    expect(svgResultToMarkup(12)).toBe("12")
  })
})
