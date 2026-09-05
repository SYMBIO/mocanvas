import { describe, expect, it } from "vitest"
import { DEFAULT_THEME, getColorValue, hexToRgba, type Editor, type TLTheme } from "@mocanvas/editor"
import { GeoShapeUtil, type GeoShape } from "./GeoShapeUtil"
import { NoteShapeUtil, type NoteShape } from "./NoteShapeUtil"
import { getFillRgba, getLabelFontFaces, getStrokeRgba, getTheme, getThemeColors } from "./shape-theme"

function stubEditor(colorMode: "light" | "dark" = "light", theme: TLTheme = DEFAULT_THEME): Editor {
  return {
    getEditingShapeId: () => null,
    getCurrentTheme: () => theme,
    getColorMode: () => colorMode,
  } as unknown as Editor
}

describe("reading a ramp off a host", () => {
  it("falls back to the built-in light ramp when there is no host to ask", () => {
    for (const source of [null, undefined, {}]) {
      expect(getTheme(source)).toBe(DEFAULT_THEME)
      expect(getThemeColors(source)).toBe(DEFAULT_THEME.colors.light)
    }
  })

  it("reads the half of the theme the host is currently painting with", () => {
    expect(getThemeColors(stubEditor("dark"))).toBe(DEFAULT_THEME.colors.dark)
    expect(getThemeColors(stubEditor("light"))).toBe(DEFAULT_THEME.colors.light)
  })
})

describe("fill styles and palette tokens are one step apart", () => {
  const colors = DEFAULT_THEME.colors.light

  it("paints `solid` with the pale tint and `fill` with the hue at full strength", () => {
    expect(getFillRgba("blue", "solid", colors)).toBe(hexToRgba(getColorValue(colors, "blue", "semi")))
    expect(getFillRgba("blue", "fill", colors)).toBe(hexToRgba(getColorValue(colors, "blue", "fill")))
  })

  it("paints `semi` with the paper and `none` with nothing at all", () => {
    expect(getFillRgba("blue", "semi", colors)).toBe(hexToRgba(colors.solid))
    expect(getFillRgba("blue", "none", colors)).toBe(0)
  })
})

describe("the built-in shapes follow the theme", () => {
  const geo = { id: "shape:g", type: "geo", props: {} } as unknown as GeoShape
  const note = { id: "shape:n", type: "note", props: { color: "blue" } } as unknown as NoteShape

  it("strokes a geo shape in the ramp the editor is painting with", () => {
    const light = new GeoShapeUtil(stubEditor("light")).getRenderStyle(geo)
    const dark = new GeoShapeUtil(stubEditor("dark")).getRenderStyle(geo)
    expect(light.stroke).toBe(getStrokeRgba("black", DEFAULT_THEME.colors.light))
    expect(dark.stroke).toBe(getStrokeRgba("black", DEFAULT_THEME.colors.dark))
    expect(dark.stroke).not.toBe(light.stroke)
  })

  it("fills a note body from the ramp too", () => {
    const light = new NoteShapeUtil(stubEditor("light")).getRenderStyle(note)
    const dark = new NoteShapeUtil(stubEditor("dark")).getRenderStyle(note)
    expect(dark.fill).not.toBe(light.fill)
    expect(dark.fill).toBe(hexToRgba(getColorValue(DEFAULT_THEME.colors.dark, "blue", "noteFill")))
  })

  it("follows a host theme that is not the built-in one", () => {
    const magenta = { ...DEFAULT_THEME.colors.light.black, solid: "#ff00ff" }
    const theme: TLTheme = {
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, light: { ...DEFAULT_THEME.colors.light, black: magenta } },
    }
    const style = new GeoShapeUtil(stubEditor("light", theme)).getRenderStyle(geo)
    expect(style.stroke).toBe(hexToRgba("#ff00ff"))
  })
})

describe("label font faces", () => {
  it("names the four faces of the requested family", () => {
    expect(getLabelFontFaces("mono").map((f) => f.family)).toEqual(Array(4).fill("tldraw_mono"))
  })

  it("answers nothing for a family with no registered faces, rather than throwing", () => {
    expect(getLabelFontFaces("nonesuch" as never)).toEqual([])
  })
})
