import { afterEach, describe, expect, it, vi } from "vitest"
import { getGraphemeLength, getGraphemes, iterateGraphemes } from "./graphemes"

const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"

describe("iterateGraphemes", () => {
  it("yields plain ASCII one character at a time", () => {
    expect(getGraphemes("abc")).toEqual(["a", "b", "c"])
    expect(getGraphemeLength("abc")).toBe(3)
  })

  it("is empty for an empty string", () => {
    expect(getGraphemes("")).toEqual([])
    expect(getGraphemeLength("")).toBe(0)
  })

  it("keeps a surrogate pair together", () => {
    // "𝒜" is a single astral code point, i.e. two UTF-16 code units.
    expect("𝒜".length).toBe(2)
    expect(getGraphemes("a𝒜b")).toEqual(["a", "𝒜", "b"])
  })

  it("is a generator, so it can be stopped early", () => {
    const it = iterateGraphemes("abcdef")
    expect(it.next().value).toBe("a")
    expect(it.next().value).toBe("b")
    it.return?.(undefined)
  })

  it.runIf(hasSegmenter)("joins a skin-tone modifier to its emoji", () => {
    expect(getGraphemes("a👍🏽b")).toEqual(["a", "👍🏽", "b"])
    expect(getGraphemeLength("👩‍👩‍👧")).toBe(1)
  })

  it.runIf(hasSegmenter)("joins a combining mark to its base letter", () => {
    const decomposed = "é"
    expect(decomposed.length).toBe(2)
    expect(getGraphemes(decomposed)).toEqual([decomposed])
  })
})

describe("iterateGraphemes without Intl.Segmenter", () => {
  const original = Intl.Segmenter

  afterEach(() => {
    Object.defineProperty(Intl, "Segmenter", { value: original, configurable: true, writable: true })
    vi.resetModules()
  })

  it("falls back to code points, which still keeps surrogate pairs whole", async () => {
    Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true, writable: true })
    // A fresh module instance, so the lazily-created segmenter is probed again.
    vi.resetModules()
    const fresh = await import("./graphemes")
    expect(fresh.getGraphemes("a𝒜b")).toEqual(["a", "𝒜", "b"])
    expect(fresh.getGraphemeLength("abc")).toBe(3)
  })
})
