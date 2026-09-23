import { describe, expect, it, beforeEach, afterAll } from "vitest"
import { DEFAULT_COLORS } from "../records/styles"
import { DefaultColorStyle, DefaultLabelColorStyle } from "../records/styleProp"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { getColorValue, getPaletteEntries, mixHexColors } from "./colors"
import { DefaultFontFaces } from "./fonts"
import { getColorNamesFromThemes, registerColorsFromThemes, resolveThemes } from "./resolveThemes"
import type { TLTheme, TLThemeColors, TLThemes } from "./types"

/** The names every registered theme must keep defining — see `registerColorsFromThemes`. */
const BUILT_IN_COLOR_NAMES = [...DEFAULT_COLORS]

/**
 * `DefaultColorStyle` is a module singleton that `registerColorsFromThemes`
 * mutates, so every test here restores it. The snapshot is taken once, before
 * anything has had a chance to register.
 */
const ORIGINAL_COLOR_VALUES = [...DefaultColorStyle.values]

function restoreColorValues(): void {
  const values = DefaultColorStyle.values as string[]
  values.length = 0
  values.push(...ORIGINAL_COLOR_VALUES)
}

beforeEach(restoreColorValues)
afterAll(restoreColorValues)

// ---- colour arithmetic -----------------------------------------------------

describe("mixHexColors", () => {
  it("returns the endpoints unchanged", () => {
    expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000")
    expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff")
  })

  it("mixes per channel and clamps out-of-range amounts", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(mixHexColors("#ff0000", "#0000ff", 0.5)).toBe("#800080")
    expect(mixHexColors("#000000", "#ffffff", 5)).toBe("#ffffff")
  })
})

// ---- the default theme -----------------------------------------------------

/** Relative luminance of an `#rrggbb` literal (WCAG 2.1). */
function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const parts = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((p) => {
    const s = Number.parseInt(p, 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (parts[0] as number) + 0.7152 * (parts[1] as number) + 0.0722 * (parts[2] as number)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi as number) + 0.05) / ((lo as number) + 0.05)
}

describe("DEFAULT_THEME", () => {
  it("defines every style colour name in both ramps", () => {
    for (const ramp of ["light", "dark"] as const) {
      const names = getPaletteEntries(DEFAULT_THEME.colors[ramp]).map(([name]) => name)
      expect(new Set(names)).toEqual(new Set(BUILT_IN_COLOR_NAMES))
    }
  })

  it("carries the metrics the default shapes already render with", () => {
    expect(DEFAULT_THEME.strokeWidth.m).toBe(3.5)
    expect(DEFAULT_THEME.fontSize.m).toBe(24)
    expect(Object.keys(DEFAULT_THEME.fonts).sort()).toEqual(["draw", "mono", "sans", "serif"])
  })

  it("keeps the light ramp exactly as the shapes painted it before the theme system", () => {
    expect(DEFAULT_THEME.colors.light.red.solid).toBe("#e03131")
    expect(DEFAULT_THEME.colors.light.blue.semi).toBe("#dce1f8")
    expect(DEFAULT_THEME.colors.light.black.noteFill).toBe("#fce19c")
  })

  it("puts every dark ink at or above WCAG AA for text on the dark page", () => {
    const plate = DEFAULT_THEME.colors.dark.background
    for (const [name, color] of getPaletteEntries(DEFAULT_THEME.colors.dark)) {
      expect(contrast(color.solid, plate), `${name} ${color.solid} on ${plate}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps dark note text readable on every dark note body", () => {
    for (const [name, color] of getPaletteEntries(DEFAULT_THEME.colors.dark)) {
      expect(contrast(color.noteText, color.noteFill), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("proves the dark ramp is a ramp of its own, not a copy of the light one", () => {
    expect(DEFAULT_THEME.colors.dark.black.solid).not.toBe(DEFAULT_THEME.colors.light.black.solid)
    expect(DEFAULT_THEME.colors.dark.background).not.toBe(DEFAULT_THEME.colors.light.background)
  })
})

describe("DefaultFontFaces", () => {
  it("exposes an upright normal face per built-in family", () => {
    for (const font of ["draw", "sans", "serif", "mono"] as const) {
      const face = DefaultFontFaces[`tldraw_${font}`]?.normal?.normal
      expect(face, font).toBeDefined()
      expect(face?.family).toBe(`tldraw_${font}`)
      expect(face?.src).toMatch(/^local\(/)
    }
  })

  it("asks for the bold file by name, not just the family", () => {
    // `local("Comic Sans MS")` answers with the regular file whatever weight
    // the descriptor asks for, so every bold face was the regular one — the
    // same string measured the same width in both weights. The bold family is
    // named first and the plain one kept after it for machines without it.
    for (const font of ["draw", "sans", "serif", "mono"] as const) {
      const faces = DefaultFontFaces[`tldraw_${font}`]
      const bold = faces?.normal?.bold
      const normal = faces?.normal?.normal
      expect(bold?.weight, font).toBe("bold")
      expect(bold?.src, font).toMatch(/Bold"\), local\(/)
      expect(bold?.src, font).not.toBe(normal?.src)
    }
  })
})

// ---- reading a ramp --------------------------------------------------------

describe("getColorValue", () => {
  const colors = DEFAULT_THEME.colors.light

  it("defaults to the ink", () => {
    expect(getColorValue(colors, "blue")).toBe(colors.blue.solid)
  })

  it("reads any variant of the entry", () => {
    expect(getColorValue(colors, "blue", "semi")).toBe(colors.blue.semi)
    expect(getColorValue(colors, "yellow", "noteFill")).toBe(colors.yellow.noteFill)
    expect(getColorValue(colors, "black", "frameStroke")).toBe(colors.black.frameStroke)
  })

  it("falls back to black for a name the ramp does not define", () => {
    expect(getColorValue(colors, "chartreuse")).toBe(colors.black.solid)
  })

  it("never returns a surface colour by mistake", () => {
    // `solid` is both a palette variant and a surface colour; the name wins.
    expect(getColorValue(colors, "solid")).toBe(colors.black.solid)
  })
})

describe("getPaletteEntries", () => {
  it("returns the palette and skips the surface colours", () => {
    const entries = getPaletteEntries(DEFAULT_THEME.colors.light)
    expect(entries).toHaveLength(BUILT_IN_COLOR_NAMES.length)
    expect(entries.map(([name]) => name)).not.toContain("background")
  })
})

// ---- resolving -------------------------------------------------------------

const custom = (id: string, colors?: Partial<TLThemeColors>): TLTheme => ({
  ...DEFAULT_THEME,
  id,
  colors: {
    light: { ...DEFAULT_THEME.colors.light, ...colors } as TLThemeColors,
    dark: { ...DEFAULT_THEME.colors.dark, ...colors } as TLThemeColors,
  },
})

describe("resolveThemes", () => {
  it("always yields the built-in default", () => {
    expect(Object.keys(resolveThemes())).toEqual(["default"])
    expect(resolveThemes()["default"]).toBe(DEFAULT_THEME)
  })

  it("lets an app replace `default` outright", () => {
    const mine = custom("default")
    const themes = resolveThemes({ default: mine })
    expect(Object.keys(themes)).toEqual(["default"])
    expect(themes["default"]).toBe(mine)
  })

  it("registers extra ids alongside it", () => {
    const themes = resolveThemes({ brand: custom("brand") })
    expect(Object.keys(themes).sort()).toEqual(["brand", "default"])
  })

  it("takes the id from the key, so a copied theme cannot lie about which it is", () => {
    const themes = resolveThemes({ brand: custom("default") })
    expect(themes["brand"]?.id).toBe("brand")
  })
})

describe("registerColorsFromThemes", () => {
  it("leaves the built-in names alone for a theme that defines all of them", () => {
    registerColorsFromThemes(resolveThemes({ default: custom("default") }))
    expect([...DefaultColorStyle.values]).toEqual(BUILT_IN_COLOR_NAMES)
  })

  it("adds the names a custom ramp introduces, so they start validating", () => {
    const brand = custom("default", { "brand-teal": DEFAULT_THEME.colors.light.green })
    registerColorsFromThemes(resolveThemes({ default: brand }))
    expect([...DefaultColorStyle.values]).toContain("brand-teal")
    expect(() => DefaultColorStyle.validate("brand-teal")).not.toThrow()
  })

  it("keeps the label colour style in step with the colour style", () => {
    const brand = custom("default", { "brand-teal": DEFAULT_THEME.colors.light.green })
    registerColorsFromThemes(resolveThemes({ default: brand }))
    expect([...DefaultLabelColorStyle.values]).toContain("brand-teal")
  })

  it("removes a name no registered ramp defines — the reason a theme must define all of them", () => {
    const withoutViolet = Object.fromEntries(
      Object.entries(DEFAULT_THEME.colors.light).filter(([name]) => name !== "violet"),
    ) as unknown as TLThemeColors
    registerColorsFromThemes({
      default: { ...DEFAULT_THEME, colors: { light: withoutViolet, dark: withoutViolet } },
    })
    expect([...DefaultColorStyle.values]).not.toContain("violet")
    expect(() => DefaultColorStyle.validate("violet")).toThrow()
  })

  it("takes the union across ramps, so a name in only one of them survives", () => {
    const withoutViolet = Object.fromEntries(
      Object.entries(DEFAULT_THEME.colors.dark).filter(([name]) => name !== "violet"),
    ) as unknown as TLThemeColors
    registerColorsFromThemes({
      default: { ...DEFAULT_THEME, colors: { light: DEFAULT_THEME.colors.light, dark: withoutViolet } },
    })
    expect([...DefaultColorStyle.values]).toContain("violet")
  })

  it("never empties the list, however odd the themes are", () => {
    registerColorsFromThemes({} as TLThemes)
    expect([...DefaultColorStyle.values]).toEqual(BUILT_IN_COLOR_NAMES)
  })
})

describe("getColorNamesFromThemes", () => {
  it("keeps first-seen order across every registered theme", () => {
    const names = getColorNamesFromThemes(
      resolveThemes({ brand: custom("brand", { "brand-teal": DEFAULT_THEME.colors.light.green }) }),
    )
    expect(names.slice(0, BUILT_IN_COLOR_NAMES.length)).toEqual(BUILT_IN_COLOR_NAMES)
    expect(names.at(-1)).toBe("brand-teal")
  })
})
