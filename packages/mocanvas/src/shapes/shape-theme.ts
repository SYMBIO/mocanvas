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

/**
 * Engine RGBA for a shape's interior. `0` means "no fill".
 *
 * The fill *styles* and the palette *tokens* share names but are one step
 * apart, which is easy to get wrong: `semi` paints the paper colour with a
 * barely-there tint, `solid` paints the hue's pale tint (the `semi` token),
 * and only `fill` paints the hue at full strength (the `solid` token). Reading
 * the token whose name matches the style makes every filled shape a step too
 * saturated. The stroke always uses the full-strength colour, so a `solid`
 * fill reads as a pale body inside a saturated outline.
 */
export function getFillRgba(color: DefaultColorStyle, fill: DefaultFillStyle): number {
  const theme = LIGHT_THEME[color]
  switch (fill) {
    case "none":
      return 0
    case "semi":
      return hexToRgba(LIGHT_THEME.solid)
    case "pattern":
      return hexToRgba(theme.pattern)
    case "solid":
      return hexToRgba(theme.semi)
    case "fill":
      return hexToRgba(theme.fill)
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

/** Engine dash pattern id for a dash style (see `mocanvas-render::dash`). */
export function getDashId(dash: string): number {
  switch (dash) {
    case "dashed":
      return 1
    case "dotted":
      return 2
    case "draw":
      return 3
    default:
      return 0
  }
}
