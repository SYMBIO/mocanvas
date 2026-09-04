import { describe, expect, it } from "vitest"
import { applyPlainTextToRichText, asRichText, escapeHtml, isRichText, richTextEquals, richTextToBlocks, richTextToHtml, richTextToText, safeHref, toRichText, type RichText } from "./rich-text"

const bold = (text: string) => ({ type: "text", text, marks: [{ type: "bold" }] })

describe("toRichText", () => {
  it("produces the document shape the .tldr format already carries", () => {
    // Verbatim from `src/__fixtures__/compare.tldr`, which was written by a
    // current release of the format.
    expect(toRichText("Hello box")).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello box" }] }] })
  })

  it("spells an empty label as one empty paragraph, not an empty document", () => {
    expect(toRichText("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] })
  })

  it("makes one paragraph per line", () => {
    expect(toRichText("one\ntwo")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    })
  })

  it.each(["", "plain", "one\ntwo\nthree", "trailing\n", "\nleading", "blank\n\nline", "diakritika: příliš žluťoučký kůň", "emoji 🎨 and <angle> & 'quotes'"])("round trips %j through richTextToText", (text) => {
    expect(richTextToText(toRichText(text))).toBe(text)
  })

  it("is total: a non-string still yields a document", () => {
    expect(toRichText(undefined as unknown as string)).toEqual({ type: "doc", content: [{ type: "paragraph" }] })
  })
})

describe("isRichText / asRichText", () => {
  it("recognises a document and nothing else", () => {
    expect(isRichText(toRichText("x"))).toBe(true)
    expect(isRichText({ type: "doc" })).toBe(true)
    expect(isRichText("x")).toBe(false)
    expect(isRichText(null)).toBe(false)
    expect(isRichText([])).toBe(false)
    expect(isRichText({ type: "paragraph" })).toBe(false)
  })

  it("passes a document through and converts everything else", () => {
    const doc = toRichText("x")
    expect(asRichText(doc)).toBe(doc)
    expect(asRichText("x")).toEqual(doc)
    expect(asRichText(null)).toEqual(toRichText(""))
  })
})

describe("richTextToText", () => {
  it("flattens marks, breaks and unknown wrappers", () => {
    const doc: RichText = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a " }, bold("b")] },
        { type: "paragraph", content: [{ type: "text", text: "c" }, { type: "hardBreak" }, { type: "text", text: "d" }] },
      ],
    }
    expect(richTextToText(doc)).toBe("a b\nc\nd")
  })

  it("passes a plain string through and reads nothing as empty", () => {
    expect(richTextToText("already plain")).toBe("already plain")
    expect(richTextToText(undefined)).toBe("")
    expect(richTextToText(null)).toBe("")
  })
})

describe("richTextEquals", () => {
  it("compares by value, and across the two spellings of the same label", () => {
    expect(richTextEquals(toRichText("a"), toRichText("a"))).toBe(true)
    expect(richTextEquals("a", toRichText("a"))).toBe(true)
    expect(richTextEquals("a", "b")).toBe(false)
  })
})

describe("applyPlainTextToRichText", () => {
  it("keeps the document — and its marks — when the text did not change", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [bold("bold")] }] }
    expect(applyPlainTextToRichText(doc, "bold")).toBe(doc)
  })

  it("rebuilds from the new text when the text did change", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [bold("bold")] }] }
    expect(applyPlainTextToRichText(doc, "bolder")).toEqual(toRichText("bolder"))
  })
})

describe("richTextToHtml", () => {
  it("renders one paragraph per block, with no whitespace between tags", () => {
    expect(richTextToHtml(toRichText("one\ntwo"))).toBe("<p>one</p><p>two</p>")
  })

  it("keeps an empty paragraph one line tall", () => {
    expect(richTextToHtml(toRichText(""))).toBe("<p>​</p>")
  })

  it("escapes text so a label can never inject markup", () => {
    expect(richTextToHtml(toRichText('<img src=x onerror="boom">&'))).toBe("<p>&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;</p>")
  })

  it("renders the default marks", () => {
    const doc: RichText = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] }] }],
    }
    expect(richTextToHtml(doc)).toBe("<p><em><strong>x</strong></em></p>")
  })

  it("renders a heading at its level and a list as a list", () => {
    const doc: RichText = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
      ],
    }
    expect(richTextToHtml(doc)).toBe("<h3>Title</h3><ul><li><p>item</p></li></ul>")
  })

  it("keeps the text of a node type it does not know, and reports the type", () => {
    const unknown = new Set<string>()
    const doc: RichText = { type: "doc", content: [{ type: "mention", content: [{ type: "text", text: "@ada" }] }] }
    expect(richTextToHtml(doc, { unknownTypes: unknown })).toBe("@ada")
    expect([...unknown]).toEqual(["mention"])
  })

  it("renders a safe link and drops an unsafe one, keeping its text", () => {
    const link = (href: string): RichText => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href } }] }] }] })
    expect(richTextToHtml(link("https://example.com"))).toBe('<p><a href="https://example.com" rel="noopener noreferrer">go</a></p>')
    expect(richTextToHtml(link("javascript:alert(1)"))).toBe("<p>go</p>")
  })
})

describe("escapeHtml / safeHref", () => {
  it("escapes every character that could end an attribute or open a tag", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })

  it("allows only schemes that cannot execute", () => {
    expect(safeHref("https://x.test")).toBe("https://x.test")
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test")
    expect(safeHref("/relative")).toBe("/relative")
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("data:text/html,<script>")).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})

describe("richTextToBlocks", () => {
  it("splits into blocks that line up with the plain-text lines", () => {
    const doc = toRichText("one\ntwo\n")
    expect(richTextToBlocks(doc)).toHaveLength(richTextToText(doc).split("\n").length)
  })

  it("carries each run's marks", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a " }, bold("b")] }] }
    const [block] = richTextToBlocks(doc)
    expect(block!.runs.map((r) => [r.text, r.bold])).toEqual([
      ["a ", false],
      ["b", true],
    ])
  })

  it("inherits marks from a wrapping node onto its runs", () => {
    const doc: RichText = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "link-wrapper", marks: [{ type: "italic" }], content: [{ type: "text", text: "x" }] }] }],
    }
    expect(richTextToBlocks(doc)[0]!.runs[0]).toMatchObject({ text: "x", italic: true })
  })

  it("starts a new block at a hard break", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] }] }
    expect(richTextToBlocks(doc).map((b) => b.runs.map((r) => r.text).join(""))).toEqual(["a", "b"])
  })

  it("treats a plain string as its lines", () => {
    expect(richTextToBlocks("a\nb").map((b) => b.runs.map((r) => r.text).join(""))).toEqual(["a", "b"])
  })
})
