import { describe, expect, it } from "vitest"
import { toRichText, type RichText } from "../text/rich-text"
import { textToSvg, wrapRichTextLines, wrapTextLines } from "./text-svg"

const box = { x: 0, y: 0, w: 200, h: 100 }
const opts = { fontFamily: "sans-serif", fontSize: 20, color: "#000", textAlign: "middle" as const, verticalAlign: "middle" as const }

const FORMATTED: RichText = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " " },
        { type: "text", text: "em", marks: [{ type: "italic" }] },
      ],
    },
  ],
}

describe("textToSvg with a plain string", () => {
  it("still renders one tspan per line", () => {
    const svg = textToSvg("one\ntwo", box, opts)
    expect(svg.match(/<tspan/g)).toHaveLength(2)
    expect(svg).toContain("one")
    expect(svg).toContain("two")
  })

  it("renders nothing for an empty label", () => {
    expect(textToSvg("", box, opts)).toBe("")
    expect(textToSvg(null, box, opts)).toBe("")
    expect(textToSvg(toRichText(""), box, opts)).toBe("")
  })
})

describe("textToSvg with a rich-text document", () => {
  it("exports the text of the document", () => {
    const svg = textToSvg(toRichText("Hello box"), box, opts)
    expect(svg).toContain("Hello box")
    expect(svg).toMatch(/^<text /)
  })

  it("puts a document and the plain string it flattens to on the same lines", () => {
    const plain = textToSvg("one\ntwo", box, opts)
    const rich = textToSvg(toRichText("one\ntwo"), box, opts)
    const ys = (svg: string) => [...svg.matchAll(/<tspan x="([^"]+)" y="([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`)
    expect(ys(rich)).toEqual(ys(plain))
  })

  it("carries a run's marks onto its own tspan", () => {
    const svg = textToSvg(FORMATTED, box, opts)
    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('font-style="italic"')
    // The unmarked run is not given a weight of its own.
    expect(svg).toMatch(/<tspan>plain <\/tspan>/)
  })

  it("renders underline and strike as text-decoration", () => {
    const doc: RichText = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "underline" }, { type: "strike" }] }] }],
    }
    expect(textToSvg(doc, box, opts)).toContain('text-decoration="underline line-through"')
  })

  it("wraps a safe link in an anchor and drops an unsafe one", () => {
    const link = (href: string): RichText => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href } }] }] }] })
    expect(textToSvg(link("https://example.com"), box, opts)).toContain('<a href="https://example.com">')
    const unsafe = textToSvg(link("javascript:alert(1)"), box, opts)
    expect(unsafe).not.toContain("<a ")
    expect(unsafe).toContain("go")
  })

  it("escapes text, so a label can never inject markup", () => {
    const svg = textToSvg(toRichText("</text><script>x</script>"), box, opts)
    expect(svg).not.toContain("<script>")
    expect(svg).toContain("&lt;/text&gt;")
  })

  it("honours the deprecated `align` spelling of `textAlign`", () => {
    const { textAlign: _drop, ...rest } = opts
    expect(textToSvg(toRichText("x"), box, { ...rest, align: "start" })).toContain('text-anchor="start"')
    expect(textToSvg(toRichText("x"), box, { ...rest, textAlign: "start" })).toContain('text-anchor="start"')
  })
})

describe("wrapRichTextLines", () => {
  it("breaks where the plain-text wrapper breaks", () => {
    const text = "the quick brown fox jumps over the lazy dog"
    const plain = wrapTextLines(text, 20, 200)
    const rich = wrapRichTextLines(toRichText(text), 20, 200).map((runs) => runs.map((r) => r.text).join(""))
    expect(rich).toEqual(plain)
  })

  it("does not lose a run's style across a wrap", () => {
    const doc: RichText = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "aaaa bbbb cccc dddd", marks: [{ type: "bold" }] }] }] }
    const lines = wrapRichTextLines(doc, 20, 120)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) for (const run of line) expect(run.bold).toBe(true)
  })

  it("breaks a word wider than the line, mid-word", () => {
    const lines = wrapRichTextLines(toRichText("a".repeat(40)), 20, 120)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.map((l) => l.map((r) => r.text).join("")).join("")).toBe("a".repeat(40))
  })
})
