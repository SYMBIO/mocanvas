/**
 * The headline use case: an app paints the canvas with its own design tokens.
 *
 * The rule an app is usually enforcing on itself is "no hex literals outside
 * the token file" — so this walks the whole path a brand colour takes, from a
 * token object to the value a shape renders with, and back to the value that
 * gets persisted, without any of it being restated as a literal in between.
 */
import { describe, expect, it, beforeEach, afterAll } from "vitest"
import { DefaultColorStyle } from "../records/styleProp"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { ThemeManager } from "./ThemeManager"
import { createTheme, registerColorsFromThemes, resolveThemes } from "./resolveThemes"
import { getColorValue, getPaletteEntries } from "./colors"
import { getDisplayValues } from "./displayValues"
import type { TLDefaultColor, TLTheme } from "./types"

/**
 * The built-in colour names, snapshotted before anything registers.
 *
 * Taken from the style prop rather than from the exported `DEFAULT_COLORS`
 * tuple on purpose: the two are the *same array* today, so registering a
 * palette that adds a name is visible through both. That aliasing is a
 * property of `records/styleProp.ts`, not of the theme system — see the note
 * on `registerColorsFromThemes`.
 */
const ORIGINAL_COLOR_VALUES = [...DefaultColorStyle.values]

function restoreColorValues(): void {
  const values = DefaultColorStyle.values as string[]
  values.length = 0
  values.push(...ORIGINAL_COLOR_VALUES)
}

beforeEach(restoreColorValues)
afterAll(restoreColorValues)

/** The app's design tokens: the only place a hex literal is allowed to live. */
const TOKENS = {
  brandInk: "#0b3d2c",
  brandInkDark: "#7fd4b1",
  brandTint: "#dff1e9",
  brandPaper: "#fbfcfb",
  brandPaperDark: "#0a0f0d",
  accentInk: "#b4005a",
  accentInkDark: "#ff8ac0",
} as const

/** One palette entry built from tokens, on top of the built-in entry's shape. */
function entry(base: TLDefaultColor, ink: string, tint: string): TLDefaultColor {
  return { ...base, solid: ink, fill: ink, semi: tint, noteFill: tint, noteText: ink }
}

/** The app's theme: every built-in name kept, brand values swapped in. */
function brandTheme(): TLTheme {
  const light = DEFAULT_THEME.colors.light
  const dark = DEFAULT_THEME.colors.dark
  return createTheme("default", {
    colors: {
      light: {
        background: TOKENS.brandPaper,
        green: entry(light.green, TOKENS.brandInk, TOKENS.brandTint),
        red: entry(light.red, TOKENS.accentInk, TOKENS.brandTint),
      },
      dark: {
        background: TOKENS.brandPaperDark,
        green: entry(dark.green, TOKENS.brandInkDark, TOKENS.brandTint),
        red: entry(dark.red, TOKENS.accentInkDark, TOKENS.brandTint),
      },
    },
  })
}

/** An editor stub with a theme manager on it, as a shape util sees one. */
function editorWithTheme(theme: TLTheme): { theme: ThemeManager; getCurrentTheme: () => TLTheme; getColorMode: () => "light" | "dark" } {
  const manager = new ThemeManager({ getContainer: () => null }, { themes: { default: theme }, window: null })
  return {
    theme: manager,
    getCurrentTheme: () => manager.getCurrentTheme(),
    getColorMode: () => manager.getColorMode(),
  }
}

describe("a custom palette, end to end", () => {
  it("replaces `default`, so every mount paints from it with no initial theme to set", () => {
    const themes = resolveThemes({ default: brandTheme() })
    expect(Object.keys(themes)).toEqual(["default"])
    expect(themes["default"]?.colors.light.green.solid).toBe(TOKENS.brandInk)
  })

  it("keeps every built-in colour name, so no persisted shape stops validating", () => {
    registerColorsFromThemes(resolveThemes({ default: brandTheme() }))
    expect([...DefaultColorStyle.values]).toEqual(ORIGINAL_COLOR_VALUES)
    for (const name of ORIGINAL_COLOR_VALUES) {
      expect(() => DefaultColorStyle.validate(name), name).not.toThrow()
    }
  })

  it("leaves the persisted vocabulary alone — a shape still stores `green`, not a hex", () => {
    const editor = editorWithTheme(brandTheme())
    const shape = { props: { color: "green" as const, fill: "solid" as const } }
    expect(getDisplayValues({ editor }, shape).color).toBe(TOKENS.brandInk)
    // What the shape carries is untouched by any of this: the file format is
    // the style *name*, and the theme only decides what that name looks like.
    expect(shape.props.color).toBe("green")
  })

  it("paints a shape with the brand ink in both colour modes", () => {
    const editor = editorWithTheme(brandTheme())
    const shape = { props: { color: "green" as const, fill: "solid" as const } }

    const light = getDisplayValues({ editor }, shape)
    expect(light.color).toBe(TOKENS.brandInk)
    expect(light.fill).toBe(TOKENS.brandTint)

    editor.theme.setColorScheme("dark")
    const dark = getDisplayValues({ editor }, shape)
    expect(dark.color).toBe(TOKENS.brandInkDark)
  })

  it("feeds a swatch UI the paint the shape will actually get", () => {
    const manager = new ThemeManager({ getContainer: () => null }, { themes: { default: brandTheme() }, window: null })
    const swatch = (name: string): string => getColorValue(manager.getColors(), name, "solid")
    expect(swatch("red")).toBe(TOKENS.accentInk)
    manager.setColorScheme("dark")
    expect(swatch("red")).toBe(TOKENS.accentInkDark)
  })

  it("keeps the untouched names on the built-in values, by identity", () => {
    const theme = brandTheme()
    expect(theme.colors.light.blue).toBe(DEFAULT_THEME.colors.light.blue)
    expect(theme.colors.light.green).not.toBe(DEFAULT_THEME.colors.light.green)
  })

  it("can be re-tokenised at runtime without rebuilding the theme", () => {
    const manager = new ThemeManager({ getContainer: () => null }, { themes: { default: brandTheme() }, window: null })
    manager.updateTheme("default", {
      colors: { light: { green: entry(DEFAULT_THEME.colors.light.green, "#004422", TOKENS.brandTint) } },
    })
    expect(manager.getColors().green.solid).toBe("#004422")
    expect(manager.getColors().red.solid).toBe(TOKENS.accentInk)
  })
})

describe("a palette with names of its own", () => {
  /** The same theme, plus a name that does not exist in the built-in ramp. */
  function extendedTheme(): TLTheme {
    const base = brandTheme()
    const extra = { "brand-teal": entry(DEFAULT_THEME.colors.light.green, TOKENS.brandInk, TOKENS.brandTint) }
    return {
      ...base,
      colors: {
        light: { ...base.colors.light, ...extra },
        dark: { ...base.colors.dark, ...extra },
      },
    }
  }

  it("registers the extra name so shapes may be created with it", () => {
    registerColorsFromThemes(resolveThemes({ default: extendedTheme() }))
    expect([...DefaultColorStyle.values]).toEqual([...ORIGINAL_COLOR_VALUES, "brand-teal"])
    expect(DefaultColorStyle.validate("brand-teal")).toBe("brand-teal")
  })

  it("resolves display values for it like any other name", () => {
    const editor = editorWithTheme(extendedTheme())
    const values = getDisplayValues({ editor }, { props: { color: "brand-teal" as never } })
    expect(values.color).toBe(TOKENS.brandInk)
  })

  it("shows up in the ramp a swatch UI iterates", () => {
    const names = getPaletteEntries(extendedTheme().colors.light).map(([name]) => name)
    expect(names).toContain("brand-teal")
    expect(names).toHaveLength(ORIGINAL_COLOR_VALUES.length + 1)
  })
})
