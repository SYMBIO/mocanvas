import { describe, expect, it } from "vitest"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import { computeGrowY, getTextShapeSize, measureLabel, TEXT_SHAPE_MIN_WIDTH, trimTrailingWhitespace } from "./text-layout"

describe("computeGrowY", () => {
  it("is zero when the label fits", () => {
    expect(computeGrowY(40, 100)).toBe(0)
    expect(computeGrowY(100, 100)).toBe(0)
  })

  it("is the overflow when the label is taller than the box", () => {
    expect(computeGrowY(130, 100)).toBe(30)
    expect(computeGrowY(100.5, 100)).toBeCloseTo(0.5)
  })

  it("ignores non-finite input", () => {
    expect(computeGrowY(Number.NaN, 100)).toBe(0)
    expect(computeGrowY(Number.POSITIVE_INFINITY, 100)).toBe(0)
    expect(computeGrowY(100, Number.NaN)).toBe(0)
  })
})

describe("trimTrailingWhitespace", () => {
  it("removes trailing spaces and newlines only", () => {
    expect(trimTrailingWhitespace("  hi there \n\n ")).toBe("  hi there")
    expect(trimTrailingWhitespace("a\n  b")).toBe("a\n  b")
    expect(trimTrailingWhitespace("")).toBe("")
  })
})

describe("measureLabel / getTextShapeSize (estimate fallback)", () => {
  it("measures with padding and wrap width", () => {
    const m = measureLabel("x".repeat(20), { font: "draw", fontSize: 24, maxWidth: 100 + 32, padding: 16 })
    // 100px inner width / 14.4px per char = 6 chars per line → 4 lines
    expect(m.lineCount).toBe(4)
    expect(m.h).toBeCloseTo(4 * 24 * LINE_HEIGHT + 32)
  })

  it("auto-size follows the text width, with a floor for empty text", () => {
    const empty = getTextShapeSize({ text: "", font: "draw", fontSize: 24, autoSize: true, w: 100 })
    expect(empty.w).toBe(TEXT_SHAPE_MIN_WIDTH)
    expect(empty.h).toBeCloseTo(24 * LINE_HEIGHT)

    const short = getTextShapeSize({ text: "hi", font: "draw", fontSize: 24, autoSize: true, w: 100 })
    const long = getTextShapeSize({ text: "hello there", font: "draw", fontSize: 24, autoSize: true, w: 100 })
    expect(long.w).toBeGreaterThan(short.w)
    expect(long.h).toBe(short.h)
    expect(long.lineCount).toBe(1)

    const multi = getTextShapeSize({ text: "a\nb\nc", font: "draw", fontSize: 24, autoSize: true, w: 100 })
    expect(multi.lineCount).toBe(3)
    expect(multi.h).toBeCloseTo(3 * 24 * LINE_HEIGHT)
  })

  it("fixed width wraps and keeps w", () => {
    const s = getTextShapeSize({ text: "a".repeat(30), font: "draw", fontSize: 24, autoSize: false, w: 100 })
    expect(s.w).toBe(100)
    expect(s.lineCount).toBe(5)
    expect(s.h).toBeCloseTo(5 * 24 * LINE_HEIGHT)
  })
})
