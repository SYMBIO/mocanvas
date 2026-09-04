import { describe, expect, it } from "vitest"
import { DEFAULT_COLORS } from "./styles"
import { DefaultColorStyle, StyleProp } from "./styleProp"

describe("EnumStyleProp value ownership", () => {
  it("does not share its value array with the tuple it was built from", () => {
    expect(DefaultColorStyle.values).not.toBe(DEFAULT_COLORS as unknown as readonly string[])
    expect([...DefaultColorStyle.values]).toEqual([...DEFAULT_COLORS])
  })

  it("survives an in-place extension without rewriting the caller's array", () => {
    // What `registerColorsFromThemes` does when an app supplies a brand palette.
    const before = [...DEFAULT_COLORS]
    ;(DefaultColorStyle.values as string[]).push("brand-teal")
    try {
      expect(DefaultColorStyle.validate("brand-teal")).toBe("brand-teal")
      expect([...DEFAULT_COLORS]).toEqual(before)
    } finally {
      ;(DefaultColorStyle.values as string[]).pop()
    }
  })

  it("keeps the validator in step with an in-place extension", () => {
    const prop = StyleProp.defineEnum("test:enum", { defaultValue: "a", values: ["a", "b"] as const })
    expect(() => prop.validate("c" as never)).toThrow()
    ;(prop.values as string[]).push("c")
    expect(prop.validate("c" as never)).toBe("c")
  })
})
