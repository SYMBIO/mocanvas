import { describe, expect, it } from "vitest"
import { toRichText, type RichText } from "./rich-text"
import { getTextTextureKey, textTextureAlign, textTextureText, wrapTextTextureLines, wrapTextTextureRuns, type TextTextureSpec } from "./TextTexture"

const base: TextTextureSpec = {
  text: "",
  fontFamily: "sans-serif",
  fontSize: 20,
  color: "#000",
  textAlign: "start",
  verticalAlign: "start",
  lineHeight: 1.3,
  width: 200,
  height: 100,
  resolution: 1,
}

const BOLD: RichText = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "one " },
        { type: "text", text: "two", marks: [{ type: "bold" }] },
      ],
    },
  ],
}

describe("the texture spec's two spellings", () => {
  it("takes the alignment from either name", () => {
    expect(textTextureAlign({ ...base, textAlign: "end" })).toBe("end")
    const { textAlign: _drop, ...rest } = base
    expect(textTextureAlign({ ...rest, align: "end" })).toBe("end")
    expect(textTextureAlign(rest)).toBe("start")
  })

  it("derives the plain text from the document when there is one", () => {
    expect(textTextureText({ ...base, text: "ignored", richText: toRichText("used") })).toBe("used")
    expect(textTextureText({ ...base, text: "used" })).toBe("used")
  })

  it("keys the cache on the document, so editing a mark re-rasterizes", () => {
    const plain = getTextTextureKey({ ...base, richText: toRichText("one two") })
    expect(getTextTextureKey({ ...base, richText: BOLD })).not.toBe(plain)
  })
})

describe("wrapTextTextureRuns", () => {
  it("produces the same lines as the plain-text wrapper for the same text", () => {
    const text = "the quick brown fox jumps over the lazy dog"
    const spec = { ...base, text, maxWidth: 160 }
    const plain = wrapTextTextureLines(spec)
    const rich = wrapTextTextureRuns({ ...spec, richText: toRichText(text) }).map((line) => line.runs.map((r) => r.text).join(""))
    expect(rich).toEqual(plain)
  })

  it("keeps each run's marks, and merges neighbours that share a style", () => {
    const lines = wrapTextTextureRuns({ ...base, richText: BOLD })
    expect(lines).toHaveLength(1)
    expect(lines[0]!.runs.map((r) => [r.text, r.bold])).toEqual([
      ["one ", false],
      ["two", true],
    ])
  })

  it("reports a line width that is the sum of its runs", () => {
    const [line] = wrapTextTextureRuns({ ...base, richText: BOLD })
    expect(line!.width).toBeGreaterThan(0)
  })

  it("splits a word wider than the box, keeping every character", () => {
    const lines = wrapTextTextureRuns({ ...base, richText: toRichText("a".repeat(60)), maxWidth: 100 })
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.map((l) => l.runs.map((r) => r.text).join("")).join("")).toBe("a".repeat(60))
  })

  it("gives a plain spec one unstyled run per line", () => {
    const lines = wrapTextTextureRuns({ ...base, text: "one\ntwo" })
    expect(lines.map((l) => l.runs.map((r) => r.text).join(""))).toEqual(["one", "two"])
    expect(lines.every((l) => l.runs.every((r) => !r.bold && !r.italic))).toBe(true)
  })

  it("breaks at a hard break inside a paragraph", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] }] }
    expect(wrapTextTextureRuns({ ...base, richText: doc }).map((l) => l.runs.map((r) => r.text).join(""))).toEqual(["a", "b"])
  })
})
