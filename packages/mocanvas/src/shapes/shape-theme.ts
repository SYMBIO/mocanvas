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

// ---- frame chrome ---------------------------------------------------------

/** A frame's body. */
export const FRAME_FILL = "#ffffff"

/**
 * A frame's border.
 *
 * Measured off a reference render: a neutral grey hairline, not the blue-grey
 * (`#9fa8b2`) this used to be. The difference reads as a colour cast along
 * every frame edge, so it is worth being exact about.
 */
export const FRAME_STROKE = "#717171"

/** Width of that border, in page units. */
export const FRAME_STROKE_WIDTH = 1

/**
 * The frame's name, drawn in the strip above it. A shade darker than the
 * border so the caption carries more weight than the hairline it labels.
 */
export const FRAME_NAME_COLOR = "#5f5f5f"

export const FRAME_NAME_FONT_SIZE = 12

/** Height of the strip above the frame that the name is laid out in. */
export const FRAME_NAME_OFFSET = 24

/**
 * Gap between the bottom of that strip and the frame's top edge. The name is
 * bottom-aligned in the strip, so this is what sets how far above the frame it
 * sits — measured two pixels higher than the four this used to be.
 */
export const FRAME_NAME_GAP = 6

/** Box the frame name is laid out in: the strip above the frame, minus the gap. */
export const FRAME_NAME_HEIGHT = FRAME_NAME_OFFSET - FRAME_NAME_GAP

// ---- sticky-note chrome ---------------------------------------------------

/**
 * A note body is not flat. It runs from a slightly deeper tint at the top to
 * the palette's `note.fill` at the bottom — `#f7dc99` → `#fce19c` for the
 * default yellow, i.e. the fill scaled by this factor channel-wise, which is
 * the ratio measured off the reference render and holds for every hue.
 */
export const NOTE_GRADIENT_TOP_SCALE = 0.9785

/**
 * The soft shadow that falls below a note. Chosen so the darkest pixel just
 * under the body composites to `#c0c4c5` over the `#f9fafb` page and fades out
 * about twelve pixels down, matching the reference.
 *
 * The shadow is decoration *outside* the body: it is drawn by the DOM overlay
 * (and by a filter in SVG export) and never enters the shape's geometry,
 * bounds or hit-testing.
 */
export const NOTE_SHADOW_COLOR = "#152223"
export const NOTE_SHADOW_OPACITY = 0.36
/**
 * A note's shadow falls almost entirely *below* it. A wide blur with no spread
 * haloes the note on every side, which reads as a glow rather than as paper
 * lifted off the page; the negative spread pulls the shadow rect in so the
 * sides stay tight while the offset keeps the soft falloff underneath.
 */
export const NOTE_SHADOW_OFFSET_Y = 12
export const NOTE_SHADOW_BLUR = 13
export const NOTE_SHADOW_SPREAD = -9

/** `#rrggbb` with every channel scaled by `factor`, clamped to the byte range. */
function scaleHexColor(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift: number): number => Math.max(0, Math.min(255, Math.round(((n >> shift) & 0xff) * factor)))
  return `#${(((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0).toString(16).padStart(6, "0")}`
}

/** `#rrggbb` as a CSS `rgba()` string at `alpha`. */
export function hexToCssRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

/** CSS colour at the bottom of a note's body gradient (the palette's note fill). */
export function getNoteFillCssColor(color: DefaultColorStyle): string {
  return LIGHT_THEME[color].note.fill
}

/**
 * Top of a note's body gradient, derived from the colour at its bottom. Takes
 * a `#rrggbb`; anything else (an `#rrggbbaa`, a named colour) is returned
 * unchanged, so the gradient degrades to a flat body rather than to garbage.
 */
export function getNoteGradientTopFrom(fill: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return fill
  return scaleHexColor(fill, NOTE_GRADIENT_TOP_SCALE)
}

/** CSS colour at the top of a note's body gradient. */
export function getNoteGradientTopCssColor(color: DefaultColorStyle): string {
  return getNoteGradientTopFrom(getNoteFillCssColor(color))
}

/** CSS `background` for a note body: the vertical gradient, top to bottom. */
export function getNoteBodyGradientCss(color: DefaultColorStyle): string {
  return `linear-gradient(to bottom, ${getNoteGradientTopCssColor(color)} 0%, ${getNoteFillCssColor(color)} 100%)`
}

/** CSS `box-shadow` for a note body, in shape-local units at `scale`. */
export function getNoteShadowCss(scale = 1): string {
  const dy = NOTE_SHADOW_OFFSET_Y * scale
  const blur = NOTE_SHADOW_BLUR * scale
  const spread = NOTE_SHADOW_SPREAD * scale
  return `0 ${dy}px ${blur}px ${spread}px ${hexToCssRgba(NOTE_SHADOW_COLOR, NOTE_SHADOW_OPACITY)}`
}

/**
 * The note shadow's geometry for an SVG export, in shape-local units.
 * `feDropShadow` has no spread, so the exporter draws the shadow as its own
 * rect — the body inset by the spread and offset down — behind the body, and
 * blurs just that rect.
 */
export function getNoteShadowSvgRect(w: number, h: number, scale = 1): { x: number; y: number; w: number; h: number; stdDeviation: number } {
  const inset = -NOTE_SHADOW_SPREAD * scale
  return {
    x: inset,
    y: NOTE_SHADOW_OFFSET_Y * scale + inset,
    w: Math.max(0, w - inset * 2),
    h: Math.max(0, h - inset * 2),
    // CSS blur radius is twice the Gaussian standard deviation.
    stdDeviation: (NOTE_SHADOW_BLUR * scale) / 2,
  }
}
