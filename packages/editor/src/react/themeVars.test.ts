import { describe, expect, it } from "vitest"
import { DEFAULT_THEME } from "../theme"
import { CANVAS_THEME_VARS, getThemeCssVars } from "./themeVars"

const LIGHT = DEFAULT_THEME.colors.light

describe("getThemeCssVars", () => {
  it("stamps the theme's surface colours under the names the canvas already reads", () => {
    const vars = getThemeCssVars(LIGHT) as Record<string, string>
    expect(vars["--mocanvas-selection"]).toBe(LIGHT.selectStroke)
    expect(vars["--mocanvas-brush-fill"]).toBe(LIGHT.selectFill)
    expect(vars["--mocanvas-snap"]).toBe(LIGHT.hint)
    expect(vars["--mocanvas-background"]).toBe(LIGHT.background)
  })

  it("publishes exactly the mapped names — nothing from the shape palette leaks in", () => {
    const vars = getThemeCssVars(LIGHT)
    expect(Object.keys(vars).sort()).toEqual(Object.keys(CANVAS_THEME_VARS).sort())
    expect(Object.keys(vars).every((name) => name.startsWith("--mocanvas-"))).toBe(true)
  })

  it("differs between the light and dark ramps", () => {
    const light = getThemeCssVars(DEFAULT_THEME.colors.light) as Record<string, string>
    const dark = getThemeCssVars(DEFAULT_THEME.colors.dark) as Record<string, string>
    expect(dark["--mocanvas-background"]).not.toBe(light["--mocanvas-background"])
  })

  it("skips a colour the ramp does not carry, so the literal fallback in `var(--x, …)` still applies", () => {
    const partial = { selectStroke: "#123456" } as unknown as typeof LIGHT
    const vars = getThemeCssVars(partial) as Record<string, string>
    expect(vars["--mocanvas-selection"]).toBe("#123456")
    expect("--mocanvas-snap" in vars).toBe(false)
  })

  it("is empty for an editor with no theme at all", () => {
    expect(getThemeCssVars(undefined)).toEqual({})
  })
})
