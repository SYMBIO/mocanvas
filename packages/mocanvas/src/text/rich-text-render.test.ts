// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import type { Editor } from "@mocanvas/editor"
import { renderHtmlFromRichText, renderPlaintextFromRichText, renderRichTextFromHTML } from "./rich-text-render"
import { richTextToText, toRichText } from "./rich-text"

// The three functions take an editor only to read its configured extension
// set; with none configured they fall back to the built-in table, so a stub
// with no text options exercises exactly the default path.
const editor = { getTextOptions: () => undefined } as unknown as Editor

describe("renderHtmlFromRichText", () => {
  it("wraps each block in its own tag", () => {
    expect(renderHtmlFromRichText(editor, toRichText("one\ntwo"))).toBe("<p>one</p><p>two</p>")
  })

  it("escapes text", () => {
    expect(renderHtmlFromRichText(editor, toRichText("a < b & c"))).toContain("a &lt; b &amp; c")
  })
})

describe("renderPlaintextFromRichText", () => {
  it("joins blocks with newlines", () => {
    expect(renderPlaintextFromRichText(editor, toRichText("one\ntwo"))).toBe("one\ntwo")
  })

  it("passes a plain string through", () => {
    expect(renderPlaintextFromRichText(editor, "already plain")).toBe("already plain")
  })
})

describe("renderRichTextFromHTML", () => {
  it("turns paragraphs into paragraph nodes", () => {
    const doc = renderRichTextFromHTML(editor, "<p>one</p><p>two</p>")
    expect(doc.content).toHaveLength(2)
    expect(richTextToText(doc)).toBe("one\ntwo")
  })

  it("reads bold and italic as marks", () => {
    const doc = renderRichTextFromHTML(editor, "<p><strong>bold</strong> and <em>italic</em></p>")
    const marks = JSON.stringify(doc)
    expect(marks).toContain('"bold"')
    expect(marks).toContain('"italic"')
  })

  it("reads a heading's level", () => {
    const doc = renderRichTextFromHTML(editor, "<h3>title</h3>")
    expect(doc.content[0]!.type).toBe("heading")
    expect(doc.content[0]!.attrs).toEqual({ level: 3 })
  })

  it("keeps a safe link as a link mark", () => {
    const doc = renderRichTextFromHTML(editor, '<p><a href="https://example.com">go</a></p>')
    expect(JSON.stringify(doc)).toContain("https://example.com")
  })

  it("keeps the text but drops an unsafe link", () => {
    const doc = renderRichTextFromHTML(editor, '<p><a href="javascript:alert(1)">go</a></p>')
    expect(richTextToText(doc)).toBe("go")
    expect(JSON.stringify(doc)).not.toContain("javascript:")
  })

  it("descends into an element it has no node type for", () => {
    const doc = renderRichTextFromHTML(editor, "<section><p>inside</p></section>")
    expect(richTextToText(doc)).toBe("inside")
  })

  it("turns a br into a hard break", () => {
    const doc = renderRichTextFromHTML(editor, "<p>one<br>two</p>")
    expect(richTextToText(doc)).toBe("one\ntwo")
  })

  it("keeps a list as a list of items", () => {
    const doc = renderRichTextFromHTML(editor, "<ul><li>a</li><li>b</li></ul>")
    expect(doc.content[0]!.type).toBe("bulletList")
    expect(doc.content[0]!.content).toHaveLength(2)
  })

  it("returns a one-empty-paragraph document for nothing", () => {
    expect(renderRichTextFromHTML(editor, "")).toEqual(toRichText(""))
    expect(renderRichTextFromHTML(editor, "   ")).toEqual(toRichText(""))
  })

  it("round-trips through the html renderer", () => {
    const original = toRichText("one\ntwo")
    const html = renderHtmlFromRichText(editor, original)
    expect(richTextToText(renderRichTextFromHTML(editor, html))).toBe("one\ntwo")
  })
})
