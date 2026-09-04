import { describe, expect, it } from "vitest"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import { getRichTextExtensions, measureRichText, renderHtmlFromRichTextForMeasurement } from "./measure-html"
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

  it("reports the width the content wanted when asked for scrollWidth", () => {
    const measure = new TextMeasure()
    const long = "word ".repeat(20).trim()
    const measured = measure.measureHtml(`<p>${long}</p>`, { ...opts, maxWidth: 200, measureScrollWidth: true })
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
