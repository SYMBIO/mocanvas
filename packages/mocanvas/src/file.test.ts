import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStore, Editor, loadEngineSync, type UnknownShape } from "@mocanvas/editor"
import { parseTldrFile } from "@mocanvas/store"
import { defaultShapeUtils } from "./shapes"
import { defaultBindingUtils } from "./bindings"
import { defaultTools } from "./tools"
import { loadMocanvasFile } from "./file"

const wasmPath = fileURLToPath(new URL("../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
const fixturePath = fileURLToPath(new URL("./__fixtures__/compare.tldr", import.meta.url))

/** The same fixture ships in `apps/playground/public` and `apps/bench/public`. */
const fixture = readFileSync(fixturePath, "utf8")

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1200, h: 900 })
  return editor
}

function shapesOf(editor: Editor): UnknownShape[] {
  return [...editor.getCurrentPageShapeIds()].map((id) => editor.getShape(id)!)
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
afterEach(() => warn.mockClear())

describe("loadMocanvasFile", () => {
  it("loads a document authored by a current release of the format", () => {
    const editor = makeEditor()
    const result = loadMocanvasFile(editor, fixture)
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    expect(editor.getCurrentPageShapeIds().size).toBe(14)
  })

  it("gives every label-bearing shape a plain string text", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, fixture)
    const labelled = shapesOf(editor).filter((s) => ["geo", "note", "text", "arrow"].includes(s.type))
    expect(labelled).toHaveLength(11)
    for (const shape of labelled) {
      const props = shape.props as Record<string, unknown>
      expect(typeof props["text"]).toBe("string")
    }
    // The rich-text document is kept alongside the derived plain text: dropping
    // it on load lost every mark in the file on the next save.
    const withRichText = labelled.filter((s) => (s.props as Record<string, unknown>)["richText"] !== undefined)
    expect(withRichText.length).toBeGreaterThan(0)
    const texts = labelled.map((s) => (s.props as { text: string }).text).filter(Boolean)
    expect(texts).toContain("Hello box")
    expect(texts).toContain("Sticky note")
    expect(texts).toContain("Plain text shape")
  })

  it("decodes the freehand stroke into points", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, fixture)
    const draw = shapesOf(editor).find((s) => s.type === "draw")!
    const segments = (draw.props as { segments: { points: { x: number; y: number }[] }[] }).segments
    expect(segments).toHaveLength(1)
    expect(segments[0]!.points.length).toBeGreaterThan(30)
    expect(segments[0]!.points[0]).toMatchObject({ x: 0, y: 40 })
    const geometry = editor.getShapeGeometry(draw)
    expect(geometry.bounds.w).toBeGreaterThan(200)
    expect(geometry.bounds.h).toBeGreaterThan(40)
  })

  it("keeps props no util declares, so a round trip preserves them", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, fixture)
    // `note.textLastEditedBy` is a prop no util here declares.
    const note = shapesOf(editor).find((s) => s.type === "note")!
    expect((note.props as Record<string, unknown>)["textLastEditedBy"]).toBeDefined()
    // `geo.flipX` is declared now, and read back as stored.
    const geo = shapesOf(editor).find((s) => s.type === "geo")!
    expect((geo.props as Record<string, unknown>)["flipX"]).toBe(false)
    // The arrow's `kind` and `elbowMidPoint` are declared now, and read back.
    const arrow = shapesOf(editor).find((s) => s.type === "arrow")!
    expect((arrow.props as Record<string, unknown>)["kind"]).toBe("arc")
    expect((arrow.props as Record<string, unknown>)["elbowMidPoint"]).toBe(0.5)
  })

  it("draws every shape when a frame is rendered", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, fixture)
    let drawn = 0
    editor.renderFrame({
      kind: "webgl2" as const,
      resize() {},
      draw(frame: { drawn: number }) {
        drawn = frame.drawn
      },
      uploadTexture() {},
      deleteTexture() {},
      dispose() {},
    })
    expect(editor.engine.shapeCount).toBe(14)
    expect(editor.getLastFrameStats().culled).toBe(0)
    // 13 rather than 14: Node cannot rasterize text, so the text shape has no
    // GPU style here and is left to the DOM overlay. In a browser it is 14.
    expect(drawn).toBe(13)
    expect(editor.getOverlayShapeIds()).toContain(shapesOf(editor).find((s) => s.type === "text")!.id)
    // The store warns about migration sequences it does not know; no shape may fail.
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("shape util threw"))).toEqual([])
  })

  it("reports a shape type it has no util for instead of failing the load", () => {
    const editor = makeEditor()
    const parsed = parseTldrFile(fixture)
    if (!parsed.ok) throw new Error("fixture did not parse")
    const withUnknown = {
      tldrawFileFormatVersion: 1,
      schema: parsed.schema,
      records: [...parsed.records, { id: "shape:odd", typeName: "shape", type: "widget", parentId: "page:page", index: "a9", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { url: "https://example.com" } }],
    }
    const result = loadMocanvasFile(editor, withUnknown)
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("widget")
    expect(editor.getCurrentPageShapeIds().size).toBe(15)
    expect(editor.getShape("shape:odd" as never)).toBeDefined()
  })

  it("loads bookmark, embed and video shapes as known types", () => {
    const editor = makeEditor()
    const parsed = parseTldrFile(fixture)
    if (!parsed.ok) throw new Error("fixture did not parse")
    const base = { typeName: "shape", parentId: "page:page", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {} }
    const result = loadMocanvasFile(editor, {
      tldrawFileFormatVersion: 1,
      schema: parsed.schema,
      records: [
        ...parsed.records,
        { ...base, id: "shape:bm", type: "bookmark", index: "a9", props: { w: 300, h: 320, assetId: null, url: "https://example.com" } },
        { ...base, id: "shape:em", type: "embed", index: "aA", props: { w: 720, h: 500, url: "https://vimeo.com/123456789" } },
        { ...base, id: "shape:vi", type: "video", index: "aB", props: { w: 640, h: 360, assetId: null, time: 0, playing: true, url: "", altText: "" } },
      ],
    })
    expect(result.ok).toBe(true)
    // None of the three is reported as a type we have no util for.
    expect(result.warnings.filter((w) => w.includes("no registered util"))).toEqual([])
    expect(editor.getCurrentPageShapeIds().size).toBe(17)
  })

  it("returns an empty warnings array when the file cannot be parsed at all", () => {
    const editor = makeEditor()
    const result = loadMocanvasFile(editor, "{}")
    expect(result.ok).toBe(false)
    expect(result.warnings).toEqual([])
  })
})
