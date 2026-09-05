import { describe, expect, it } from "vitest"
import { getFontsFromRichText, resolveLineHeightPx, richTextValidator, type TLRichTextFontSource } from "./richText"
import type { TLFontFace, TLTheme } from "../theme/types"

describe("resolveLineHeightPx", () => {
  it("treats a bare number as a multiplier", () => {
    expect(resolveLineHeightPx(1.5, 16)).toBe(24)
  })
  it("treats a unitless string as a multiplier", () => {
    expect(resolveLineHeightPx("1.5", 16)).toBe(24)
  })
  it("reads px as absolute", () => {
    expect(resolveLineHeightPx("22px", 16)).toBe(22)
  })
  it("reads em and % against the font size", () => {
    expect(resolveLineHeightPx("2em", 16)).toBe(32)
    expect(resolveLineHeightPx("150%", 16)).toBe(24)
  })
  it("falls back to the font size for nothing usable", () => {
    expect(resolveLineHeightPx(undefined, 16)).toBe(16)
    expect(resolveLineHeightPx("normal", 16)).toBe(16)
  })
})

describe("richTextValidator", () => {
  it("accepts a doc envelope whatever is inside it", () => {
    expect(richTextValidator.validate({ type: "doc", content: [{ type: "myCustomNode" }] })).toBeTruthy()
  })
  it("rejects anything that is not a doc", () => {
    expect(() => richTextValidator.validate({ type: "paragraph", content: [] })).toThrow()
    expect(() => richTextValidator.validate("hello")).toThrow()
  })
})

const regular: TLFontFace = { family: "brand", src: { url: "/brand.woff2" }, weight: "normal", style: "normal" }
const bold: TLFontFace = { family: "brand", src: { url: "/brand-bold.woff2" }, weight: "bold", style: "normal" }

function source(): TLRichTextFontSource {
  const theme = { fonts: { brand: { fontFamily: "brand", faces: [regular, bold] } } } as unknown as TLTheme
  return { getCurrentTheme: () => theme }
}

describe("getFontsFromRichText", () => {
  const base = { family: "brand", weight: "normal", style: "normal" }

  it("collects nothing for an empty document", () => {
    expect(getFontsFromRichText(source(), null, base)).toEqual([])
  })

  it("collects the face for the base font", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "hi" }] }
    expect(getFontsFromRichText(source(), doc, base)).toEqual([regular])
  })

  it("collects the bold face when a bold mark is in force", () => {
    const doc = {
      type: "doc",
      content: [{ type: "text", text: "hi", marks: [{ type: "bold" }] }],
    }
    expect(getFontsFromRichText(source(), doc, base)).toEqual([regular, bold])
  })

  it("does not repeat a face", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    }
    expect(getFontsFromRichText(source(), doc, base)).toEqual([regular])
  })
})
