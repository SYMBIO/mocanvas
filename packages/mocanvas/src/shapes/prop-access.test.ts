import { describe, expect, it } from "vitest"
import { toRichText } from "../text/rich-text"
import { readRichText, readText } from "./prop-access"

/** The one-empty-paragraph document that spells "nothing typed yet". */
const EMPTY = toRichText("")

describe("reading a label that has two spellings", () => {
  it("lifts a plain-text-only record into a document", () => {
    expect(readRichText({ text: "hello" })).toEqual(toRichText("hello"))
    expect(readText({ text: "hello" })).toBe("hello")
  })

  it("flattens a rich-text-only record, which is what a v5 writer produces", () => {
    const doc = toRichText("hello")
    expect(readRichText({ richText: doc })).toBe(doc)
    expect(readText({ richText: doc })).toBe("hello")
  })

  it("keeps the document when both agree, so no round trip is spent", () => {
    const doc = toRichText("hello")
    expect(readRichText({ richText: doc, text: "hello" })).toBe(doc)
  })

  it("prefers the document when they disagree — it is the canonical spelling", () => {
    // What `editor.createShape({ props: { richText } })` produces: the util's
    // default `text: ""` is merged under the caller's document.
    const doc = toRichText("from the agent")
    expect(readRichText({ richText: doc, text: "" })).toBe(doc)
    expect(readText({ richText: doc, text: "" })).toBe("from the agent")
  })

  it("prefers the text when the document is the empty one", () => {
    // What spreading a util's default props and setting only `text` produces.
    expect(readRichText({ richText: EMPTY, text: "typed" })).toEqual(toRichText("typed"))
    expect(readText({ richText: EMPTY, text: "typed" })).toBe("typed")
  })

  it("reads an empty label as one empty paragraph, never as an empty document", () => {
    for (const props of [{}, { text: "" }, { richText: EMPTY }, { richText: EMPTY, text: "" }]) {
      expect(readRichText(props), JSON.stringify(props)).toEqual(EMPTY)
      expect(readText(props), JSON.stringify(props)).toBe("")
    }
  })

  it("survives props that are missing, misshapen or of the wrong type", () => {
    for (const props of [undefined, null, 7, "text", [], { text: 42 }, { richText: "not a doc" }]) {
      expect(readRichText(props), String(props)).toEqual(EMPTY)
      expect(readText(props), String(props)).toBe("")
    }
  })

  it("keeps multi-line text lossless in both directions", () => {
    const text = "one\ntwo\n\nfour"
    expect(readText({ richText: toRichText(text) })).toBe(text)
    expect(readText({ text })).toBe(text)
  })

  it("leaves a plain-text-only prop alone — only `text` has a rich counterpart", () => {
    // A frame's `name`: it must not start reading a note's `richText`.
    expect(readText({ name: "Frame 1", richText: toRichText("label") }, "name")).toBe("Frame 1")
    expect(readText({ richText: toRichText("label") }, "name")).toBe("")
  })
})
