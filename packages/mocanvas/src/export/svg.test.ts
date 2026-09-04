import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  createStore,
  Editor,
  loadEngineSync,
  Rectangle2d,
  ShapeUtil,
  StateNode,
  type BaseShape,
  type ShapeId,
  type StyleWords,
} from "@mocanvas/editor"
import { defaultBindingUtils } from "../bindings"
import { FRAME_NAME_COLOR, FRAME_STROKE, NOTE_SHADOW_COLOR, NOTE_SHADOW_OPACITY } from "../shapes/shape-theme"
import {
  defaultShapeUtils,
  type ArrowShape,
  type DrawShape,
  type FrameShape,
  type GeoShape,
  type LineShape,
  type NoteShape,
  type TextShape,
} from "../shapes"
import { exportToBlob } from "./image"
import { getExportShapes, getSvgString, SVG_EXPORT_DEFAULT_PADDING } from "./svg"
import { dashArray, rgbaToHex } from "./svg-utils"
import { wrapTextLines } from "./text-svg"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

/** A shape type with no registry entry: exercises the geometry fallback. */
type BlobShape = BaseShape<"blob", { w: number; h: number }>
class BlobShapeUtil extends ShapeUtil<BlobShape> {
  static override type = "blob" as const
  getDefaultProps() {
    return { w: 40, h: 30 }
  }
  getGeometry(shape: BlobShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component() {
    return null
  }
  indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0x00ff00ff, stroke: 0x0000ffff, strokeWidth: 2, dash: 1, opacity: 1 }
  }
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [...defaultShapeUtils, BlobShapeUtil],
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

/** Count `<name ` / `<name>` openings and `</name>` closings. */
function tagBalance(svg: string, name: string): { open: number; close: number } {
  const open = (svg.match(new RegExp(`<${name}[\\s>]`, "g")) ?? []).length
  const close = (svg.match(new RegExp(`</${name}>`, "g")) ?? []).length
  return { open, close }
}

function expectBalanced(svg: string): void {
  for (const tag of ["svg", "g", "text", "tspan", "defs", "clipPath"]) {
    const b = tagBalance(svg, tag)
    expect(b.open, tag).toBe(b.close)
  }
  // Every element is either self-closing or closed; no stray `<` in text content.
  expect(svg.startsWith("<svg ")).toBe(true)
  expect(svg.endsWith("</svg>")).toBe(true)
}

describe("getSvgString", () => {
  let editor: Editor
  let geoId: ShapeId
  let drawId: ShapeId
  let arrowId: ShapeId
  let noteId: ShapeId
  let frameId: ShapeId
  let textId: ShapeId
  let lineId: ShapeId

  beforeEach(() => {
    editor = makeEditor()
    editor.createShape<GeoShape>({ type: "geo", x: 100, y: 100, props: { w: 200, h: 120, text: "Hello <World> & \"friends\"", fill: "semi", color: "blue" } })
    geoId = lastId(editor)
    editor.createShape<DrawShape>({
      type: "draw",
      x: 400,
      y: 100,
      props: {
        dash: "dashed",
        isComplete: true,
        segments: [{ type: "free", points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 15 }, { x: 30, y: 10 }, { x: 40, y: 20 }] }],
      },
    })
    drawId = lastId(editor)
    editor.createShape<ArrowShape>({ type: "arrow", x: 100, y: 300, props: { start: { x: 0, y: 0 }, end: { x: 150, y: 40 }, text: "label" } })
    arrowId = lastId(editor)
    editor.createShape<NoteShape>({ type: "note", x: 500, y: 300, props: { text: "sticky\nnote", color: "yellow" } })
    noteId = lastId(editor)
    editor.createShape<FrameShape>({ type: "frame", x: 800, y: 100, props: { w: 300, h: 200, name: "My Frame" } })
    frameId = lastId(editor)
    editor.createShape<GeoShape>({ type: "geo", x: 20, y: 20, parentId: frameId, props: { w: 400, h: 50, geo: "ellipse" } })
    editor.createShape<TextShape>({ type: "text", x: 100, y: 600, props: { text: "plain text", textAlign: "middle" } })
    textId = lastId(editor)
    editor.createShape<LineShape>({ type: "line", x: 400, y: 600, props: { dash: "dotted" } })
    lineId = lastId(editor)
  })

  it("exports the whole page when nothing is selected, with viewBox = bounds + padding", () => {
    const result = getSvgString(editor)
    expect(result).toBeDefined()
    const { svg, width, height } = result!
    expectBalanced(svg)

    const shapes = editor.getCurrentPageShapesSorted()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of shapes) {
      const b = editor.getShapePageBounds(s)!
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.maxX)
      maxY = Math.max(maxY, b.maxY)
    }
    const p = SVG_EXPORT_DEFAULT_PADDING
    const vb = /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number)
    expect(vb[0]).toBeCloseTo(minX - p, 1)
    expect(vb[1]).toBeCloseTo(minY - p, 1)
    expect(vb[2]).toBeCloseTo(maxX - minX + 2 * p, 1)
    expect(vb[3]).toBeCloseTo(maxY - minY + 2 * p, 1)
    expect(width).toBe(Math.ceil(maxX - minX + 2 * p))
    expect(height).toBe(Math.ceil(maxY - minY + 2 * p))
    expect(Number.isFinite(width) && width > 0).toBe(true)
    expect(Number.isFinite(height) && height > 0).toBe(true)

    expect(svg).toContain("<path")
    // The label soft-wraps, so check the escaped fragments rather than one run.
    expect(svg).toContain("&lt;World&gt; &amp;")
    expect(svg).toContain("&quot;friends&quot;")
    expect(svg).not.toContain("<World>")
    // One group per shape, each carrying a page transform.
    for (const s of shapes) expect(svg).toContain(`data-shape-type="${s.type}"`)
    expect((svg.match(/<g transform="matrix\(/g) ?? []).length).toBe(shapes.length)
  })

  it("each built-in type yields a non-empty element", () => {
    const cases: [ShapeId, string][] = [
      [geoId, "<path"],
      [drawId, "<path"],
      [arrowId, "<path"],
      [noteId, "<rect"],
      [frameId, "<rect"],
      [textId, "<text"],
      [lineId, "<path"],
    ]
    for (const [id, tag] of cases) {
      const result = getSvgString(editor, [id], { padding: 0 })
      expect(result, id).toBeDefined()
      const inner = /<g [^>]*>(.*)<\/g>/s.exec(result!.svg)![1]!
      expect(inner.length, id).toBeGreaterThan(0)
      expect(inner, id).toContain(tag)
      expectBalanced(result!.svg)
    }
  })

  it("renders text labels as <text> with one <tspan> per line", () => {
    const note = getSvgString(editor, [noteId])!.svg
    expect(note).toContain("<text ")
    expect((note.match(/<tspan /g) ?? []).length).toBe(2)
    expect(note).toContain(">sticky</tspan>")
    expect(note).toContain(">note</tspan>")
    expect(note).toContain('text-anchor="middle"')
    // The body is a gradient now, not a flat fill: the engine's flat colour is
    // its bottom stop.
    expect(note).toContain("<linearGradient ")
    expect(note).toContain(`stop-color="#fbe9c9"`) // yellow note fill, at the bottom
    expect(note).toContain(`stop-color="#f6e4c5"`) // a shade deeper, at the top
    expect(note).toMatch(/<rect [^>]*fill="url\(#mc-note-fill-[^"]+\)"/)

    const text = getSvgString(editor, [textId])!.svg
    expect(text).toContain(">plain text</tspan>")
    expect(text).toContain('text-anchor="middle"')
    expect(text).toContain("font-family=")
    expect(text).toContain('font-size="24"')

    const frame = getSvgString(editor, [frameId])!.svg
    expect(frame).toContain(">My Frame</tspan>")
    expect(frame).toContain(`fill="${FRAME_NAME_COLOR}"`)

    const arrow = getSvgString(editor, [arrowId])!.svg
    expect(arrow).toContain(">label</tspan>")
  })

  it("maps dash styles to stroke-dasharray", () => {
    const dashed = getSvgString(editor, [drawId])!.svg
    expect(dashed).toContain("stroke-dasharray=")
    expect(dashed).toContain('stroke-linejoin="round"')
    expect(dashed).toContain('stroke-linecap="round"')
    const dotted = getSvgString(editor, [lineId])!.svg
    expect(dotted).toContain('stroke-dasharray="0.1 7"')
    const solid = getSvgString(editor, [geoId])!.svg
    expect(solid).not.toContain("stroke-dasharray")
  })

  it("converts render styles to #rrggbb colours", () => {
    const geo = getSvgString(editor, [geoId])!.svg
    expect(geo).toContain('stroke="#4465e9"') // blue solid
    expect(geo).toContain('fill="#fcfffe"') // a `semi` fill is the paper colour
    expect(rgbaToHex(0xff000080)).toBe("#ff000080")
    expect(rgbaToHex(0x11223300)).toBeUndefined()
    expect(dashArray(0, 3)).toBeUndefined()
    expect(dashArray(1, 3)).toBe("6 6")
  })

  it("carries the note's trim and the frame's border colour", () => {
    const note = getSvgString(editor, [noteId])!.svg
    // The shadow is its own blurred rect behind the body: `feDropShadow` has
    // no spread, and the shadow needs a negative one to stay under the note.
    expect(note).toContain("<feGaussianBlur ")
    expect(note).toMatch(new RegExp(`<rect [^>]*fill="${NOTE_SHADOW_COLOR}"[^>]*filter="url\\(#mc-note-shadow-[^"]+\\)"`))
    expect(note).toContain(`fill-opacity="${NOTE_SHADOW_OPACITY}"`)
    expect(tagBalance(note, "defs")).toEqual({ open: 1, close: 1 })
    expect(tagBalance(note, "linearGradient")).toEqual({ open: 1, close: 1 })

    const frame = getSvgString(editor, [frameId])!.svg
    expect(frame).toContain(`stroke="${FRAME_STROKE}"`)
    expect(frame).toContain(`stroke="#717171"`)
    expect(frame).not.toContain("#9fa8b2")
  })

  it("gives every note its own gradient and filter ids", () => {
    editor.createShape<NoteShape>({ type: "note", x: 0, y: 0, props: { text: "second", color: "blue" } })
    const second = lastId(editor)
    const { svg } = getSvgString(editor, [noteId, second])!
    const ids = [...svg.matchAll(/id="(mc-note-[^"]+)"/g)].map((m) => m[1]!)
    expect(ids.length).toBe(4)
    expect(new Set(ids).size).toBe(4)
    editor.deleteShapes([second])
  })

  it("frames clip their children and children are included with their parent", () => {
    const shapes = getExportShapes(editor, [frameId])
    expect(shapes).toHaveLength(2)
    expect(shapes[0]!.id).toBe(frameId)
    const { svg } = getSvgString(editor, [frameId])!
    expectBalanced(svg)
    expect(svg).toContain("<clipPath id=")
    expect(svg).toMatch(/<g clip-path="url\(#[^"]+\)">/)
    // The child ellipse comes after the frame body inside the clip group.
    const clipIndex = svg.indexOf('<g clip-path=')
    const childIndex = svg.indexOf('data-shape-type="geo"')
    expect(childIndex).toBeGreaterThan(clipIndex)
  })

  it("uses the selection when no ids are passed", () => {
    editor.select(noteId)
    const { svg } = getSvgString(editor)!
    expect(svg).toContain('data-shape-type="note"')
    expect(svg).not.toContain('data-shape-type="geo"')
  })

  it("falls back to the geometry path for unknown shape types", () => {
    editor.createShape<BlobShape>({ type: "blob", x: 0, y: 0, opacity: 0.5 })
    const id = lastId(editor)
    const { svg } = getSvgString(editor, [id], { padding: 0 })!
    expect(svg).toContain('data-shape-type="blob"')
    expect(svg).toContain("<path d=\"M0 0 L40 0 L40 30 L0 30 Z\"")
    expect(svg).toContain('fill="#00ff00"')
    expect(svg).toContain('stroke="#0000ff"')
    expect(svg).toContain('stroke-dasharray="4 4"')
    expect(svg).toContain('opacity="0.5"')
    expect(svg).toContain('viewBox="0 0 40 30"')
  })

  it("adds a background rect and honours dark mode and scale", () => {
    const light = getSvgString(editor, [geoId], { background: true, padding: 0 })!
    expect(light.svg).toContain('fill="#f9fafb"')
    const dark = getSvgString(editor, [geoId], { background: true, darkMode: true, padding: 0, scale: 2 })!
    expect(dark.svg).toContain('fill="#101011"')
    expect(dark.width).toBe(light.width * 2)
    expect(dark.height).toBe(light.height * 2)
    // viewBox stays in page units regardless of scale.
    expect(/viewBox="([^"]+)"/.exec(dark.svg)![1]).toBe(/viewBox="([^"]+)"/.exec(light.svg)![1])
  })

  it("returns undefined for an empty page or unknown ids", () => {
    const empty = makeEditor()
    expect(getSvgString(empty)).toBeUndefined()
    expect(getSvgString(editor, ["shape:nope" as ShapeId])).toBeUndefined()
  })
})

describe("wrapTextLines", () => {
  it("splits on newlines and soft-wraps by estimated width", () => {
    expect(wrapTextLines("a\nb", 24)).toEqual(["a", "b"])
    // 24px font → 14.4px per char; 72px fits 5 chars.
    expect(wrapTextLines("hello world", 24, 72)).toEqual(["hello", "world"])
    expect(wrapTextLines("abcdefghij", 24, 72)).toEqual(["abcde", "fghij"])
    expect(wrapTextLines("", 24)).toEqual([""])
  })
})

describe("exportToBlob", () => {
  it("returns an SVG blob in Node and rejects raster formats without a DOM", async () => {
    const editor = makeEditor()
    editor.createShape<GeoShape>({ type: "geo", x: 0, y: 0 })
    const blob = await exportToBlob(editor, { format: "svg" })
    expect(blob.type).toBe("image/svg+xml")
    expect(await blob.text()).toContain("<svg ")
    await expect(exportToBlob(editor, { format: "png" })).rejects.toThrow(/browser/)
    await expect(exportToBlob(makeEditor(), { format: "svg" })).rejects.toThrow(/Nothing to export/)
  })
})
