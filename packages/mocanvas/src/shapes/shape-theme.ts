/**
 * Theme lookups shared by the default shapes. Everything resolves against the
 * light theme for now; a theme-aware variant can be threaded through later.
 */
import {
  hexToRgba,
  LIGHT_THEME,
  type DefaultColorStyle,
  type DefaultFillStyle,
  type DefaultFontStyle,
} from "@mocanvas/editor"

/** Engine RGBA for a shape's stroke. */
export function getStrokeRgba(color: DefaultColorStyle): number {
  return hexToRgba(LIGHT_THEME[color].solid)
}

/** Engine RGBA for a shape's interior. `0` means "no fill". */
export function getFillRgba(color: DefaultColorStyle, fill: DefaultFillStyle): number {
  const theme = LIGHT_THEME[color]
  switch (fill) {
    case "none":
      return 0
    case "semi":
      return hexToRgba(theme.semi)
    case "pattern":
      return hexToRgba(theme.pattern)
    case "solid":
    case "fill":
      return hexToRgba(theme.solid)
  }
}

/** Engine RGBA for a sticky note's background. */
export function getNoteFillRgba(color: DefaultColorStyle): number {
  return hexToRgba(LIGHT_THEME[color].note.fill)
}

/** CSS color string for text drawn in the DOM overlay. */
export function getTextCssColor(color: DefaultColorStyle): string {
  return LIGHT_THEME[color].solid
}

/** CSS color string for text on a sticky note. */
export function getNoteTextCssColor(color: DefaultColorStyle): string {
  return LIGHT_THEME[color].note.text
}

/** Local-only font stacks; no web fonts are loaded. */
export function getFontFamily(font: DefaultFontStyle): string {
  switch (font) {
    case "draw":
      return '"Comic Sans MS", "Segoe Print", "Bradley Hand", "Chalkboard SE", cursive'
    case "sans":
      return 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    case "serif":
      return 'Georgia, "Times New Roman", Times, serif'
    case "mono":
      return 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
  }
}
