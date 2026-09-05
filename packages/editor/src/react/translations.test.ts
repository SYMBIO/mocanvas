import { describe, expect, it } from "vitest"
import { getLocaleChain, resolveUiMessage } from "./translations"

const TRANSLATIONS = {
  en: { "tool.comment": "Comment", "tool.note": "Note" },
  cs: { "tool.comment": "Komentář" },
  "cs-CZ": { "tool.note": "Lepík" },
}

describe("getLocaleChain", () => {
  it("tries the locale, then its base language, then English", () => {
    expect(getLocaleChain("cs-CZ")).toEqual(["cs-CZ", "cs", "en"])
  })

  it("does not repeat a locale that is already its own base", () => {
    expect(getLocaleChain("cs")).toEqual(["cs", "en"])
    expect(getLocaleChain("en")).toEqual(["en"])
  })

  it("treats an underscore tag the same as a hyphenated one", () => {
    expect(getLocaleChain("pt_BR")).toEqual(["pt_BR", "pt", "en"])
  })
})

describe("resolveUiMessage", () => {
  it("prefers the most specific locale that has the id", () => {
    expect(resolveUiMessage(TRANSLATIONS, "cs-CZ", "tool.note")).toBe("Lepík")
  })

  it("falls back through the base language before English", () => {
    expect(resolveUiMessage(TRANSLATIONS, "cs-CZ", "tool.comment")).toBe("Komentář")
  })

  it("falls back to English when neither has it", () => {
    expect(resolveUiMessage({ en: { a: "A" } }, "de", "a")).toBe("A")
  })

  it("returns the id itself when nothing has it — a localized literal is always safe as a label", () => {
    expect(resolveUiMessage(TRANSLATIONS, "en", "Zavřít")).toBe("Zavřít")
    expect(resolveUiMessage(undefined, "en", "Zavřít")).toBe("Zavřít")
  })
})
