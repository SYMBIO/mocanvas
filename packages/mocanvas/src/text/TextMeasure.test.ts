import { describe, expect, it } from "vitest"
import { estimateTextSize, LINE_HEIGHT } from "../shapes/text-helpers"
import { getTextMeasure, TextMeasure, toDisplayText } from "./TextMeasure"

const opts = { fontFamily: "sans-serif", fontSize: 24, lineHeight: LINE_HEIGHT }

describe("TextMeasure (no DOM)", () => {
  it("falls back to the estimate when document is undefined", () => {
    expect(typeof document).toBe("undefined")
    const tm = new TextMeasure()
    const m = tm.measureText("hello world", opts)
    const est = estimateTextSize("hello world", 24)
    expect(m.w).toBeCloseTo(est.w)
    expect(m.h).toBeCloseTo(est.h)
    expect(m.lineCount).toBe(1)
  })

  it("wraps at maxWidth minus padding and adds padding to the result", () => {
    const tm = new TextMeasure()
    const text = "a".repeat(30)
    const m = tm.measureText(text, { ...opts, maxWidth: 100 + 16, padding: 8 })
    const est = estimateTextSize(text, 24, 100)
    expect(m.lineCount).toBe(est.lines)
    expect(m.lineCount).toBeGreaterThan(1)
    expect(m.w).toBeCloseTo(est.w + 16)
    expect(m.h).toBeCloseTo(est.lines * 24 * LINE_HEIGHT + 16)
  })

  it("empty text still occupies one line", () => {
    const m = new TextMeasure().measureText("", opts)
    expect(m.lineCount).toBe(1)
    expect(m.h).toBeCloseTo(24 * LINE_HEIGHT)
    expect(m.w).toBe(0)
  })

  it("returns the cached object for identical arguments and distinguishes options", () => {
    const tm = new TextMeasure()
    const a = tm.measureText("cache me", opts)
    const b = tm.measureText("cache me", { ...opts })
    expect(b).toBe(a)
    expect(tm.cacheSize).toBe(1)
    const c = tm.measureText("cache me", { ...opts, fontSize: 36 })
    expect(c).not.toBe(a)
    expect(c.h).toBeGreaterThan(a.h)
    expect(tm.cacheSize).toBe(2)
    tm.clearCache()
    expect(tm.cacheSize).toBe(0)
  })

  it("bounds the cache at 2000 entries, evicting the oldest", () => {
    const tm = new TextMeasure()
    const first = tm.measureText("entry 0", opts)
    for (let i = 1; i <= 2000; i++) tm.measureText(`entry ${i}`, opts)
    expect(tm.cacheSize).toBe(2000)
    // "entry 0" was evicted: a fresh measurement is a new object.
    expect(tm.measureText("entry 0", opts)).not.toBe(first)
    expect(tm.cacheSize).toBe(2000)
  })

  it("exposes a singleton", () => {
    expect(getTextMeasure()).toBe(getTextMeasure())
    expect(getTextMeasure()).toBeInstanceOf(TextMeasure)
  })

  it("toDisplayText keeps a trailing newline and an empty string visible", () => {
    expect(toDisplayText("abc")).toBe("abc")
    expect(toDisplayText("abc\n")).toBe("abc\n\u200b")
    expect(toDisplayText("")).toBe("\u200b")
  })
})
