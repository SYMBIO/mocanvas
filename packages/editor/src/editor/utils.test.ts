import { describe, expect, it } from "vitest"
import { getIncrementedName, isSafeFloat, toFixed, uniq } from "./utils"

describe("toFixed", () => {
  it("removes float dust", () => {
    expect(toFixed(0.1 + 0.2)).toBe(0.3)
  })
  it("honours precision", () => {
    expect(toFixed(1.23456, 3)).toBe(1.235)
    expect(toFixed(1.23456, 0)).toBe(1)
  })
  it("leaves an exact number alone", () => {
    expect(toFixed(42)).toBe(42)
  })
})

describe("isSafeFloat", () => {
  it("accepts ordinary coordinates", () => {
    expect(isSafeFloat(0)).toBe(true)
    expect(isSafeFloat(-12.5)).toBe(true)
  })
  it("rejects the non-numbers a corrupt record carries", () => {
    expect(isSafeFloat(NaN)).toBe(false)
    expect(isSafeFloat(Infinity)).toBe(false)
    expect(isSafeFloat("3")).toBe(false)
    expect(isSafeFloat(undefined)).toBe(false)
  })
  it("rejects a magnitude past exact integer arithmetic", () => {
    expect(isSafeFloat(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isSafeFloat(Number.MAX_SAFE_INTEGER * 2)).toBe(false)
  })
})

describe("uniq", () => {
  it("keeps first-seen order", () => {
    expect(uniq(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"])
  })
  it("takes any iterable", () => {
    expect(uniq(new Set([1, 2]))).toEqual([1, 2])
  })
})

describe("getIncrementedName", () => {
  it("leaves a free name alone", () => {
    expect(getIncrementedName("Page", [])).toBe("Page")
  })
  it("appends the first free counter", () => {
    expect(getIncrementedName("Page", ["Page"])).toBe("Page 1")
    expect(getIncrementedName("Page", ["Page", "Page 1"])).toBe("Page 2")
  })
  it("continues an existing counter rather than nesting one", () => {
    expect(getIncrementedName("Page 2", ["Page 2"])).toBe("Page 3")
    expect(getIncrementedName("Page 2", ["Page 2", "Page 3"])).toBe("Page 4")
  })
})
