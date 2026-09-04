/**
 * Rich text through a `.tldr` save and load.
 *
 * Two levels, because they can move independently:
 *  1. the file format — a `richText` prop written out and parsed back must be
 *     the same document, byte for byte;
 *  2. the editor — a file whose labels are documents must load, and the label
 *     must still read as its text after a save and a reload.
 *
 * The second is written against `labelTextOf`, which reads whichever of
 * `props.richText` and `props.text` the record carries. Load-time
 * normalization currently flattens the document into `props.text`
 * (`@mocanvas/editor` `records/normalize.ts`); when it stops doing that and
 * keeps the document, these assertions hold unchanged.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { createStore, Editor, loadEngineSync, type UnknownShape } from "@mocanvas/editor"
import { parseTldrFile, serializeTldrFile } from "@mocanvas/store"
import { defaultBindingUtils } from "../bindings"
import { loadMocanvasFile, serializeMocanvasFile } from "../file"
import { defaultShapeUtils } from "../shapes"
import { defaultTools } from "../tools"
import { richTextToText, toRichText, type RichText } from "./rich-text"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
const fixturePath = fileURLToPath(new URL("../__fixtures__/compare.tldr", import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { schema: unknown; records: Record<string, unknown>[] }

vi.spyOn(console, "warn").mockImplementation(() => {})

/** A document with every mark and block type mocanvas understands. */
const FORMATTED: RichText = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Nadpis" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " & " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ],
    },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "položka" }] }] }] },
  ],
}

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

/** The label of a shape, from whichever prop the record carries. */
function labelTextOf(shape: UnknownShape): string {
  const props = shape.props as Record<string, unknown>
  const rich = props["richText"]
  if (rich !== undefined && rich !== null) return richTextToText(rich as RichText)
  return typeof props["text"] === "string" ? props["text"] : ""
}

/** The fixture with every `richText` prop replaced by `next`. */
function fixtureWithRichText(next: RichText): string {
  const clone = JSON.parse(JSON.stringify(fixture)) as typeof fixture
  for (const record of clone.records) {
    const props = record["props"] as Record<string, unknown> | undefined
    if (props && "richText" in props) props["richText"] = next
  }
  return JSON.stringify(clone)
}

describe("the rich-text value through the file format", () => {
  it("survives serialize → parse unchanged", () => {
    const shape = { id: "shape:rich", typeName: "shape", type: "geo", parentId: "page:page", index: "a1", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { richText: FORMATTED } }
    const text = serializeTldrFile(fixture.schema as never, [shape as never])
    const parsed = parseTldrFile(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const props = (parsed.records[0] as unknown as { props: { richText: RichText } }).props
    expect(props.richText).toEqual(FORMATTED)
  })

  it("survives a document produced by toRichText, for every shape of text", () => {
    for (const source of ["", "Hello box", "one\ntwo", "příliš žluťoučký kůň", "emoji 🎨 & <angle>"]) {
      const doc = toRichText(source)
      const text = serializeTldrFile(fixture.schema as never, [{ id: "shape:a", typeName: "shape", type: "geo", parentId: "page:page", index: "a1", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { richText: doc } } as never])
      const parsed = parseTldrFile(text)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const back = (parsed.records[0] as unknown as { props: { richText: RichText } }).props.richText
      expect(back).toEqual(doc)
      expect(richTextToText(back)).toBe(source)
    }
  })
})

describe("a rich-text label through loadMocanvasFile", () => {
  it("loads a file whose labels are formatted documents", () => {
    const editor = makeEditor()
    const result = loadMocanvasFile(editor, fixtureWithRichText(FORMATTED))
    expect(result.ok).toBe(true)
    const labelled = [...editor.getCurrentPageShapeIds()].map((id) => editor.getShape(id)!).filter((s) => ["geo", "note", "text", "arrow"].includes(s.type))
    expect(labelled.length).toBeGreaterThan(0)
    for (const shape of labelled) expect(labelTextOf(shape)).toBe(richTextToText(FORMATTED))
  })

  it("keeps the label across a save and a reload", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, fixtureWithRichText(toRichText("one\ntwo")))
    const saved = serializeMocanvasFile(editor)

    const reloaded = makeEditor()
    const result = loadMocanvasFile(reloaded, saved)
    expect(result.ok).toBe(true)
    const labelled = [...reloaded.getCurrentPageShapeIds()].map((id) => reloaded.getShape(id)!).filter((s) => ["geo", "note", "text", "arrow"].includes(s.type))
    expect(labelled.length).toBeGreaterThan(0)
    for (const shape of labelled) expect(labelTextOf(shape)).toBe("one\ntwo")
  })

  it("leaves a plain-text label alone — the store may hold either", () => {
    const editor = makeEditor()
    loadMocanvasFile(editor, JSON.stringify(fixture))
    const texts = [...editor.getCurrentPageShapeIds()].map((id) => labelTextOf(editor.getShape(id)!))
    expect(texts).toContain("Hello box")
    expect(texts).toContain("Sticky note")
  })
})
