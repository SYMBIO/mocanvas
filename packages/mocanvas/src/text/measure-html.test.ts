import { describe, expect, it } from "vitest"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import {
  getRichTextExtensions,
  measureRichText,
  renderHtmlFromRichTextForMeasurement,
  renderHtmlFromRichTextWithExtensions,
} from "./measure-html"
import { toRichText, type RichText } from "./rich-text"
import { measureLabel } from "./text-layout"
import { getTextMeasure, TextMeasure } from "./TextMeasure"
import { tipTapDefaultExtensions, type RichTextExtension } from "./tiptap-extensions"

const opts = { fontFamily: "sans-serif", fontSize: 24, lineHeight: LINE_HEIGHT }

describe("renderHtmlFromRichTextForMeasurement", () => {
  it("renders a document to the markup the measurer sizes", () => {
    expect(renderHtmlFromRichTextForMeasurement(null, toRichText("one\ntwo"))).toBe("<p>one</p><p>two</p>")
  })

  it("accepts a plain string, so a caller need not know which prop the store holds", () => {
    expect(renderHtmlFromRichTextForMeasurement(null, "one\ntwo")).toBe(renderHtmlFromRichTextForMeasurement(null, toRichText("one\ntwo")))
  })

  it("emits no whitespace between tags — pre-wrap would measure it as a space", () => {
    expect(renderHtmlFromRichTextForMeasurement(null, toRichText("a\nb\nc"))).not.toMatch(/>\s+</)
  })
})

describe("renderHtmlFromRichTextWithExtensions", () => {
  it("renders with the list it was given, no editor involved", () => {
    expect(renderHtmlFromRichTextWithExtensions(toRichText("one\ntwo"), tipTapDefaultExtensions)).toBe("<p>one</p><p>two</p>")
  })

  it("agrees with the editor-driven renderer when the lists agree", () => {
    const doc = toRichText("hello")
    const editor = { options: { text: { tipTapConfig: { extensions: tipTapDefaultExtensions } } } } as never
    expect(renderHtmlFromRichTextWithExtensions(doc, tipTapDefaultExtensions)).toBe(renderHtmlFromRichTextForMeasurement(editor, doc))
  })

  it("honours a narrower list — a node type left out keeps its text but loses its wrapper", () => {
    const only = tipTapDefaultExtensions.filter((e) => e.name !== "paragraph")
    expect(renderHtmlFromRichTextWithExtensions(toRichText("one\ntwo"), only)).toBe("onetwo")
  })

  it("accepts a plain string, like its sibling", () => {
    expect(renderHtmlFromRichTextWithExtensions("a\nb", tipTapDefaultExtensions)).toBe("<p>a</p><p>b</p>")
  })
})

describe("getRichTextExtensions", () => {
  it("falls back to the default set for an editor with no text options", () => {
    expect(getRichTextExtensions(null)).toBe(tipTapDefaultExtensions)
    expect(getRichTextExtensions({} as never)).toBe(tipTapDefaultExtensions)
  })

  it("reads the v5 `options.text.tipTapConfig` location", () => {
    const extensions: RichTextExtension[] = [{ name: "mine" }]
    expect(getRichTextExtensions({ options: { text: { tipTapConfig: { extensions } } } } as never)).toBe(extensions)
  })

  it("reads the older top-level `textOptions` location too", () => {
    const extensions: RichTextExtension[] = [{ name: "mine" }]
    expect(getRichTextExtensions({ textOptions: { tipTapConfig: { extensions } } } as never)).toBe(extensions)
  })
})

describe("rich-text measurement against plain-text measurement", () => {
  it("measures a rich-text label exactly as the plain text it flattens to", () => {
    for (const text of ["Hello box", "one\ntwo", "a much longer label that has to wrap somewhere"]) {
      const rich = measureLabel(toRichText(text), { fontFamily: "sans", fontSize: 24, maxWidth: 200 })
      const plain = measureLabel(text, { fontFamily: "sans", fontSize: 24, maxWidth: 200 })
      // The rich path returns a `TextHtmlMeasurement`, which is a
      // `TextMeasurement` plus `scrollWidth`; the box itself must be identical.
      expect({ w: rich.w, h: rich.h, lineCount: rich.lineCount }).toEqual(plain)
    }
  })

  it("measures an empty label as one line, both ways", () => {
    expect(measureLabel(toRichText(""), { fontFamily: "sans", fontSize: 24 }).lineCount).toBe(1)
    expect(measureLabel("", { fontFamily: "sans", fontSize: 24 }).lineCount).toBe(1)
  })

  it("takes a label through the same measurer whichever prop it came from", () => {
    const measure = new TextMeasure()
    const html = measure.measureHtml("<p>hello</p>", opts)
    const text = measure.measureText("hello", opts)
    expect(html.w).toBeCloseTo(text.w)
    expect(html.h).toBeCloseTo(text.h)
  })

  it("still honours the deprecated `font` spelling of `fontFamily`", () => {
    expect(measureLabel("hello", { font: "sans", fontSize: 24 })).toEqual(measureLabel("hello", { fontFamily: "sans", fontSize: 24 }))
  })
})

describe("TextMeasure.measureHtml", () => {
  it("wraps at maxWidth and reports the line count", () => {
    const measure = new TextMeasure()
    const long = "word ".repeat(20).trim()
    const wrapped = measure.measureHtml(`<p>${long}</p>`, { ...opts, maxWidth: 200 })
    expect(wrapped.lineCount).toBeGreaterThan(1)
    expect(wrapped.w).toBeLessThanOrEqual(200)
  })

  /*
   * `scrollWidth` is the DOM's, and the distinction it draws is the reason to
   * ask for it: a box overflows only when something in it cannot be broken to
   * fit. Until 4.11.1 this re-measured the whole text unwrapped, so any label
   * that took two lines reported as an overflow — and a consumer shrinking
   * text to fit a sticky note drove the font down to 3px looking for a size
   * that would fit on one line.
   */
  it("reports the wrap width for text that wraps", () => {
    const measure = new TextMeasure()
    const sentence = "word ".repeat(20).trim()
    const measured = measure.measureHtml(`<p>${sentence}</p>`, { ...opts, maxWidth: 200, measureScrollWidth: true })
    expect(measured.h, "twenty words at this width take more than one line").toBeGreaterThan(opts.fontSize * opts.lineHeight)
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.w)
  })

  it("reports more than the wrap width for a word that cannot be broken", () => {
    const measure = new TextMeasure()
    const unbreakable = "w".repeat(80)
    const measured = measure.measureHtml(`<p>${unbreakable}</p>`, { ...opts, maxWidth: 200, measureScrollWidth: true })
    expect(measured.scrollWidth).toBeGreaterThan(measured.w)
  })

  it("tells the two apart in the same text", () => {
    // A long word among short ones: the box still overflows, by that word.
    const measure = new TextMeasure()
    const mixed = `${"word ".repeat(10)}${"w".repeat(80)} ${"word ".repeat(10)}`.trim()
    const measured = measure.measureHtml(`<p>${mixed}</p>`, { ...opts, maxWidth: 200, measureScrollWidth: true })
    expect(measured.scrollWidth).toBeGreaterThan(measured.w)
  })

  it("reports scrollWidth as w when it was not asked for", () => {
    const measure = new TextMeasure()
    const measured = measure.measureHtml("<p>hello</p>", opts)
    expect(measured.scrollWidth).toBe(measured.w)
  })

  it("adds the padding to the measured box, from a number or a CSS shorthand", () => {
    const measure = new TextMeasure()
    const bare = measure.measureHtml("<p>hello</p>", opts)
    const padded = measure.measureHtml("<p>hello</p>", { ...opts, padding: 8 })
    const shorthand = measure.measureHtml("<p>hello</p>", { ...opts, padding: "8px" })
    expect(padded.h).toBeCloseTo(bare.h + 16)
    expect(shorthand.h).toBeCloseTo(padded.h)
  })

  it("caches by html and options", () => {
    const measure = new TextMeasure()
    const first = measure.measureHtml("<p>hello</p>", opts)
    expect(measure.measureHtml("<p>hello</p>", opts)).toBe(first)
    expect(measure.measureHtml("<p>hello</p>", { ...opts, fontSize: 25 })).not.toBe(first)
  })

  it("measures a batch item for item", () => {
    const measure = new TextMeasure()
    const items = [{ html: "<p>a</p>", opts }, { html: "<p>bb</p>", opts }]
    expect(measure.measureHtmlBatch(items)).toEqual(items.map((i) => measure.measureHtml(i.html, i.opts)))
  })

  it("decodes the entities it wrote when it falls back to the estimate", () => {
    const measure = new TextMeasure()
    // `&lt;` is one glyph wide, not four.
    expect(measure.measureHtml("<p>&lt;</p>", opts).w).toBeCloseTo(measure.measureText("<", opts).w)
  })
})

describe("measureRichText", () => {
  it("renders and measures in one step", () => {
    const doc: RichText = toRichText("hello")
    expect(measureRichText(null, doc, opts)).toEqual(getTextMeasure().measureHtml("<p>hello</p>", opts))
  })
})
