import { describe, expect, it } from "vitest"
import { bucketTextureResolution } from "@mocanvas/editor"
import {
  getTextTextureKey,
  getTextTextureScale,
  MAX_TEXT_TEXTURE_PX,
  renderTextToCanvas,
  wrapTextTextureLines,
  type TextTextureSpec,
} from "./TextTexture"

const base: TextTextureSpec = {
  text: "hello world",
  fontFamily: "sans-serif",
  fontSize: 24,
  color: "#1d1d1d",
  align: "start",
  verticalAlign: "start",
  lineHeight: 1.3,
  width: 200,
  height: 32,
  resolution: 1,
}

const spec = (over: Partial<TextTextureSpec> = {}): TextTextureSpec => ({ ...base, ...over })

describe("getTextTextureKey", () => {
  it("is stable for equal specs", () => {
    expect(getTextTextureKey(spec())).toBe(getTextTextureKey(spec()))
    // Property order does not matter.
    expect(getTextTextureKey({ ...base })).toBe(getTextTextureKey(spec({ text: base.text })))
  })

  it("changes with every field that changes the pixels", () => {
    const keys = new Set(
      [
        spec(),
        spec({ text: "hello worlds" }),
        spec({ fontFamily: "serif" }),
        spec({ fontSize: 25 }),
        spec({ color: "#000000" }),
        spec({ align: "middle" }),
        spec({ verticalAlign: "end" }),
        spec({ lineHeight: 1.5 }),
        spec({ width: 201 }),
        spec({ height: 33 }),
        spec({ maxWidth: 200 }),
        spec({ padding: 4 }),
        spec({ resolution: 2 }),
      ].map(getTextTextureKey),
    )
    expect(keys.size).toBe(13)
  })

  it("buckets by resolution, so a zoom inside one bucket reuses the texture", () => {
    const at = (zoom: number, dpr: number) => getTextTextureKey(spec({ resolution: bucketTextureResolution(zoom, dpr) }))
    expect(at(1.05, 2)).toBe(at(1.9, 2))
    expect(at(1.05, 2)).not.toBe(at(2.5, 2))
    // Buckets are shared across a dpr/zoom product, and the ceiling is stable.
    expect(at(8, 2)).toBe(at(4, 2))
  })

  it("keeps the text last so keys of the same style share a prefix", () => {
    const a = getTextTextureKey(spec({ text: "a" }))
    const b = getTextTextureKey(spec({ text: "b" }))
    expect(a.slice(0, -1)).toBe(b.slice(0, -1))
  })
})

describe("wrapTextTextureLines", () => {
  it("keeps hard newlines and does not wrap without a maxWidth", () => {
    expect(wrapTextTextureLines(spec({ text: "a\nb\n\nc" }))).toEqual(["a", "b", "", "c"])
    expect(wrapTextTextureLines(spec({ text: "one two three four five six" }))).toEqual(["one two three four five six"])
  })

  it("wraps greedily at the wrap width", () => {
    // The Node fallback measurer estimates ~0.6em per character: 6 chars at 24px in 90px.
    const lines = wrapTextTextureLines(spec({ text: "aaa bbb ccc ddd", maxWidth: 90 }))
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(" ")).toBe("aaa bbb ccc ddd")
  })

  it("breaks a single word that cannot fit", () => {
    const lines = wrapTextTextureLines(spec({ text: "a".repeat(30), maxWidth: 90 }))
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join("")).toBe("a".repeat(30))
  })

  it("takes padding off the wrap width", () => {
    const wide = wrapTextTextureLines(spec({ text: "aaa bbb ccc", maxWidth: 200 }))
    const padded = wrapTextTextureLines(spec({ text: "aaa bbb ccc", maxWidth: 200, padding: 60 }))
    expect(padded.length).toBeGreaterThan(wide.length)
  })
})

describe("getTextTextureScale", () => {
  it("uses the requested resolution when the canvas stays small", () => {
    expect(getTextTextureScale(spec({ resolution: 4 }))).toBe(4)
  })

  it("clamps so neither canvas dimension exceeds the cap", () => {
    const s = getTextTextureScale(spec({ width: 4000, height: 100, resolution: 8 }))
    expect(s).toBeCloseTo(MAX_TEXT_TEXTURE_PX / 4000)
    expect(4000 * s).toBeLessThanOrEqual(MAX_TEXT_TEXTURE_PX)
  })
})

describe("renderTextToCanvas", () => {
  it("refuses to rasterize without a document, so callers keep the DOM label", () => {
    expect(typeof document).toBe("undefined")
    expect(() => renderTextToCanvas(spec())).toThrow(/document/)
  })
})
