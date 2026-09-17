import { describe, expect, it } from "vitest"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { ThemeManager } from "./ThemeManager"
import { DEFAULT_HATCH_TOKENS, DEFAULT_FILL_TOKENS, getDefaultDisplayValues, getDisplayValues } from "./displayValues"
import type { TLDefaultDisplayValues, TLStyledShape, TLTheme } from "./types"

const LIGHT = DEFAULT_THEME.colors.light
const DARK = DEFAULT_THEME.colors.dark

const shape = (props: TLStyledShape["props"]): TLStyledShape => ({ props })

function resolve(props: TLStyledShape["props"], theme: TLTheme = DEFAULT_THEME, mode: "light" | "dark" = "light") {
  return getDefaultDisplayValues(null, shape(props), theme, mode)
}

describe("getDefaultDisplayValues — colour", () => {
  it("resolves the ink from the live ramp", () => {
    expect(resolve({ color: "blue" }).color).toBe(LIGHT.blue.solid)
    expect(resolve({ color: "blue" }, DEFAULT_THEME, "dark").color).toBe(DARK.blue.solid)
  })

  it("defaults to black for a shape with no colour prop", () => {
    expect(resolve({}).color).toBe(LIGHT.black.solid)
  })

  it("labels follow the shape's colour unless the shape says otherwise", () => {
    expect(resolve({ color: "red" }).labelColor).toBe(LIGHT.red.solid)
    expect(resolve({ color: "red", labelColor: "white" }).labelColor).toBe(LIGHT.white.solid)
  })
})

describe("getDefaultDisplayValues — fill", () => {
  it("paints nothing for `none`", () => {
    expect(resolve({ fill: "none" }).fill).toBe("transparent")
    expect(resolve({}).fill).toBe("transparent")
  })

  it("paints the paper for `semi`, so the shape reads as unfilled but opaque", () => {
    expect(resolve({ color: "blue", fill: "semi" }).fill).toBe(LIGHT.solid)
    expect(resolve({ color: "blue", fill: "semi" }, DEFAULT_THEME, "dark").fill).toBe(DARK.solid)
  })

  it("paints the pale tint for `solid` and the full hue for `fill`", () => {
    // The style names and the token names are one step apart on purpose — see
    // DEFAULT_FILL_TOKENS. Reading the same-named token would over-saturate
    // every filled shape, which is exactly the regression this pins.
    expect(resolve({ color: "blue", fill: "solid" }).fill).toBe(LIGHT.blue.semi)
    expect(resolve({ color: "blue", fill: "fill" }).fill).toBe(LIGHT.blue.fill)
  })

  it("paints paper under `pattern` and keeps that colour for the hatch itself", () => {
    // `pattern` used to *fill* with the pattern token, which is the colour the
    // hatch lines are drawn in — so the one style meant to read as texture was
    // the heaviest block of colour on the canvas. The paper goes underneath;
    // the token belongs to the lines on top of it.
    expect(resolve({ color: "blue", fill: "pattern" }).fill).toBe(LIGHT.solid)
    expect(DEFAULT_HATCH_TOKENS.pattern).toBe("pattern")
    expect(DEFAULT_HATCH_TOKENS.solid, "a style that is not hatched must not claim a hatch").toBeUndefined()
  })

  it("keeps that mapping written down in one place", () => {
    expect(DEFAULT_FILL_TOKENS).toEqual({
      none: "none",
      semi: "paper",
      solid: "semi",
      pattern: "paper",
      fill: "fill",
    })
  })
})

describe("getDefaultDisplayValues — size", () => {
  it("takes stroke width and font size from the theme's metrics", () => {
    expect(resolve({ size: "s" }).strokeWidth).toBe(DEFAULT_THEME.strokeWidth.s)
    expect(resolve({ size: "xl" }).strokeWidth).toBe(DEFAULT_THEME.strokeWidth.xl)
    expect(resolve({ size: "l" }).fontSize).toBe(DEFAULT_THEME.fontSize.l)
  })

  it("defaults to medium", () => {
    expect(resolve({}).strokeWidth).toBe(DEFAULT_THEME.strokeWidth.m)
  })

  it("derives the line height from the font size", () => {
    const values = resolve({ size: "m" })
    expect(values.lineHeight).toBeCloseTo(DEFAULT_THEME.fontSize.m * DEFAULT_THEME.lineHeight)
  })

  it("follows a theme that changes the metrics", () => {
    const chunky: TLTheme = { ...DEFAULT_THEME, strokeWidth: { ...DEFAULT_THEME.strokeWidth, m: 9 } }
    expect(resolve({ size: "m" }, chunky).strokeWidth).toBe(9)
  })
})

describe("getDefaultDisplayValues — dash", () => {
  it("leaves a continuous stroke with an empty pattern", () => {
    expect(resolve({ dash: "draw" }).dashArray).toEqual([])
    expect(resolve({ dash: "solid" }).dashArray).toEqual([])
    expect(resolve({ dash: "none" }).dashArray).toEqual([])
  })

  it("scales the dash pattern with the stroke width", () => {
    const thin = resolve({ dash: "dashed", size: "s" })
    const thick = resolve({ dash: "dashed", size: "xl" })
    expect(thin.dashArray).toEqual([3 * DEFAULT_THEME.strokeWidth.s, 2 * DEFAULT_THEME.strokeWidth.s])
    expect(thick.dashArray[0]).toBeGreaterThan(thin.dashArray[0] as number)
  })

  it("passes the style itself through for renderers that draw their own", () => {
    expect(resolve({ dash: "dotted" }).dash).toBe("dotted")
    expect(resolve({}).dash).toBe("draw")
  })
})

describe("getDefaultDisplayValues — font", () => {
  it("resolves the family from the theme's stacks", () => {
    expect(resolve({ font: "serif" }).fontFamily).toBe(DEFAULT_THEME.fonts.serif)
    expect(resolve({}).fontFamily).toBe(DEFAULT_THEME.fonts.draw)
  })

  it("follows a theme that supplies its own stacks", () => {
    const branded: TLTheme = { ...DEFAULT_THEME, fonts: { ...DEFAULT_THEME.fonts, sans: "Brand Grotesk, sans-serif" } }
    expect(resolve({ font: "sans" }, branded).fontFamily).toBe("Brand Grotesk, sans-serif")
  })
})

// ---- reading them off a util ----------------------------------------------

interface NoteDisplayValues extends TLDefaultDisplayValues {
  noteWidth: number
  labelPadding: number
}

/** An editor stub carrying a real theme manager, as a shape util's would. */
function editorWith(mode: "light" | "dark" = "light"): { getCurrentTheme: () => TLTheme; getColorMode: () => "light" | "dark"; theme: ThemeManager } {
  const theme = new ThemeManager({ getContainer: () => null }, { window: null, colorScheme: mode })
  return {
    theme,
    getCurrentTheme: () => theme.getCurrentTheme(),
    getColorMode: () => theme.getColorMode(),
  }
}

describe("getDisplayValues", () => {
  it("resolves against whatever the editor is currently painting with", () => {
    const editor = editorWith()
    const util = { editor }
    expect(getDisplayValues(util, shape({ color: "blue" })).color).toBe(LIGHT.blue.solid)
    editor.theme.setColorScheme("dark")
    expect(getDisplayValues(util, shape({ color: "blue" })).color).toBe(DARK.blue.solid)
  })

  it("prefers the util's own default display values", () => {
    const util = {
      editor: editorWith(),
      options: {
        getDefaultDisplayValues: (e: unknown, s: TLStyledShape, theme: TLTheme, mode: "light" | "dark"): NoteDisplayValues => ({
          ...getDefaultDisplayValues(e, s, theme, mode),
          noteWidth: 200,
          labelPadding: 16,
        }),
      },
    }
    const values = getDisplayValues<TLStyledShape, NoteDisplayValues>(util, shape({ color: "yellow" }))
    expect(values.noteWidth).toBe(200)
    expect(values.color).toBe(LIGHT.yellow.solid)
  })

  it("lets `getCustomDisplayValues` override part of them", () => {
    const util = {
      editor: editorWith(),
      getCustomDisplayValues: (): Partial<TLDefaultDisplayValues> => ({ strokeWidth: 42 }),
    }
    const values = getDisplayValues(util, shape({ size: "s" }))
    expect(values.strokeWidth).toBe(42)
    expect(values.color).toBe(LIGHT.black.solid)
  })

  it("keeps the defaults when the override returns nothing", () => {
    const util = { editor: editorWith(), getCustomDisplayValues: () => undefined }
    expect(getDisplayValues(util, shape({ size: "s" })).strokeWidth).toBe(DEFAULT_THEME.strokeWidth.s)
  })

  it("hands the override the theme and mode, not just the shape", () => {
    const editor = editorWith("dark")
    const seen: string[] = []
    const util = {
      editor,
      getCustomDisplayValues: (_e: unknown, _s: TLStyledShape, theme: TLTheme, mode: "light" | "dark") => {
        seen.push(`${theme.id}/${mode}`)
        return undefined
      },
    }
    getDisplayValues(util, shape({}))
    expect(seen).toEqual(["default/dark"])
  })

  it("falls back to the default theme for a util whose editor has no theme yet", () => {
    const values = getDisplayValues({ editor: {} }, shape({ color: "green" }))
    expect(values.color).toBe(LIGHT.green.solid)
  })
})
