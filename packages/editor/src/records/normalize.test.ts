import { describe, expect, it } from "vitest"
import type { UnknownRecord } from "@mocanvas/store"
import { decodeDrawSegmentPath, normalizeLoadedRecords, richTextToPlainText } from "./normalize"

const shapeUtils = {
  geo: { getDefaultProps: () => ({ w: 100, h: 100, text: "", color: "black" }) },
  draw: { getDefaultProps: () => ({ segments: [], isClosed: false }) },
}

function shape(type: string, props: unknown, id = `shape:${type}`): UnknownRecord {
  return { id, typeName: "shape", type, props } as unknown as UnknownRecord
}

function propsOf(record: UnknownRecord): Record<string, unknown> {
  return (record as unknown as { props: Record<string, unknown> }).props
}

describe("richTextToPlainText", () => {
  it("reads a single paragraph", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello box" }] }] }
    expect(richTextToPlainText(doc)).toBe("Hello box")
  })

  it("joins paragraphs with newlines and concatenates runs within one", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one " }, { type: "text", text: "line" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    }
    expect(richTextToPlainText(doc)).toBe("one line\ntwo")
  })

  it("turns a hard break into a newline", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] }],
    }
    expect(richTextToPlainText(doc)).toBe("a\nb")
  })

  it("recurses into nodes it does not know", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
          ],
        },
      ],
    }
    expect(richTextToPlainText(doc)).toBe("first\nsecond")
  })

  it("reads an empty document, an empty paragraph and a non-document as empty", () => {
    expect(richTextToPlainText({ type: "doc", content: [] })).toBe("")
    expect(richTextToPlainText({ type: "doc", content: [{ type: "paragraph" }] })).toBe("")
    expect(richTextToPlainText(undefined)).toBe("")
    expect(richTextToPlainText(null)).toBe("")
    expect(richTextToPlainText(42)).toBe("")
  })

  it("passes a plain string straight through", () => {
    expect(richTextToPlainText("already plain")).toBe("already plain")
  })

  it("collects the node types it did not understand", () => {
    const unknown = new Set<string>()
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", content: [{ type: "text", text: "x" }] }] }] }
    expect(richTextToPlainText(doc, unknown)).toBe("x")
    expect([...unknown]).toEqual(["mention"])
  })
})

describe("decodeDrawSegmentPath", () => {
  // A first point as three float32 (x, y, pressure), then float16 deltas.
  const twoPoints = "AAAAAAAAIEIAAAA/AEgAyQAA"

  it("decodes the leading point and the deltas that follow", () => {
    expect(decodeDrawSegmentPath(twoPoints)).toEqual([
      { x: 0, y: 40, z: 0.5 },
      { x: 8, y: 30, z: 0.5 },
    ])
  })

  it("rejects a blob that is not base64, is too short, or has a partial delta", () => {
    expect(decodeDrawSegmentPath("not base64!")).toBeNull()
    expect(decodeDrawSegmentPath("AAAA")).toBeNull()
    expect(decodeDrawSegmentPath("AAAAAAAAIEIAAAA/AAAA")).toBeNull()
    expect(decodeDrawSegmentPath("")).toBeNull()
  })
})

describe("normalizeLoadedRecords", () => {
  it("derives plain text from a rich text label and keeps the document", () => {
    const rich = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello box" }] }] }
    const { records, warnings } = normalizeLoadedRecords([shape("geo", { w: 1, h: 2, color: "red", richText: rich })], { shapeUtils })
    expect(propsOf(records[0]!)["text"]).toBe("Hello box")
    // Kept, not dropped: discarding it here lost every mark on the next save.
    expect("richText" in propsOf(records[0]!)).toBe(true)
    expect(warnings).toEqual([])
  })

  it("keeps an existing plain text prop over the rich text document", () => {
    const rich = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "from rich" }] }] }
    const { records } = normalizeLoadedRecords([shape("geo", { w: 1, h: 2, color: "red", text: "from text", richText: rich })], { shapeUtils })
    expect(propsOf(records[0]!)["text"]).toBe("from text")
  })

  it("decodes a packed freehand path into points", () => {
    const input = shape("draw", { isClosed: false, segments: [{ type: "free", path: "AAAAAAAAIEIAAAA/AEgAyQAA" }] })
    const { records, warnings } = normalizeLoadedRecords([input], { shapeUtils })
    const segments = propsOf(records[0]!)["segments"] as { type: string; points: unknown[]; path?: string }[]
    expect(segments[0]!.type).toBe("free")
    expect(segments[0]!.points).toHaveLength(2)
    expect(segments[0]!.path).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it("drops a segment whose path it cannot decode, and says so", () => {
    const input = shape("draw", { isClosed: false, segments: [{ type: "free", path: "AAAA" }] })
    const { records, warnings } = normalizeLoadedRecords([input], { shapeUtils })
    expect(propsOf(records[0]!)["segments"]).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("unrecognized path encoding")
  })

  it("leaves segments that already carry points alone", () => {
    const segments = [{ type: "free", points: [{ x: 1, y: 2 }] }]
    const input = shape("draw", { isClosed: false, segments })
    const { records } = normalizeLoadedRecords([input], { shapeUtils })
    expect(propsOf(records[0]!)["segments"]).toEqual(segments)
    expect(records[0]).toBe(input)
  })

  it("fills in props the util declares but the file omits, and warns", () => {
    const { records, warnings } = normalizeLoadedRecords([shape("geo", { w: 200 })], { shapeUtils })
    expect(propsOf(records[0]!)).toEqual({ w: 200, h: 100, text: "", color: "black" })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("filled in from defaults")
  })

  it("keeps props the util does not declare so a round trip preserves them", () => {
    const { records } = normalizeLoadedRecords([shape("geo", { w: 1, h: 2, text: "", color: "red", elbowMidPoint: 0.5 })], { shapeUtils })
    expect(propsOf(records[0]!)["elbowMidPoint"]).toBe(0.5)
  })

  it("passes a shape with no registered util through untouched, warning once per type", () => {
    const a = shape("bookmark", { url: "https://example.com" }, "shape:a")
    const b = shape("bookmark", { url: "https://example.org" }, "shape:b")
    const { records, warnings } = normalizeLoadedRecords([a, b], { shapeUtils })
    expect(records[0]).toBe(a)
    expect(records[1]).toBe(b)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("no registered util")
  })

  it("leaves records that are not shapes alone", () => {
    const page = { id: "page:page", typeName: "page", name: "Page 1" } as unknown as UnknownRecord
    const { records, warnings } = normalizeLoadedRecords([page], { shapeUtils })
    expect(records[0]).toBe(page)
    expect(warnings).toEqual([])
  })

  it("survives a shape whose props are missing entirely", () => {
    const { records, warnings } = normalizeLoadedRecords([shape("geo", undefined)], { shapeUtils })
    expect(propsOf(records[0]!)).toEqual({ w: 100, h: 100, text: "", color: "black" })
    expect(warnings).toHaveLength(1)
  })

  it("does not copy a record that needed no change", () => {
    const input = shape("geo", { w: 1, h: 2, text: "hi", color: "red" })
    const { records } = normalizeLoadedRecords([input], { shapeUtils })
    expect(records[0]).toBe(input)
  })
})
