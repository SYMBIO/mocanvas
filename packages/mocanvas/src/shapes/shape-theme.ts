/**
 * Theme lookups shared by the default shapes.
 *
 * Everything here resolves against a *ramp* — `theme.colors[colorMode]` — never
 * against a hardcoded palette. A util passes the ramp its editor is currently
 * painting with, which is what makes the built-in shapes follow the theme and
 * the colour mode; a caller with no editor to ask (an exporter rendering a
 * detached snapshot, a preview swatch) omits it and gets the built-in light
 * ramp, which is exactly what these functions used to return unconditionally.
 *
 * The *shape-level* resolution — which colour a shape's `color` prop means,
 * how wide its stroke is, what font size its label uses — belongs to
 * `getDisplayValues(util, shape)` and is not restated here. What is left is the
 * chrome no style prop describes: a note's gradient and shadow, a frame's
 * border and heading strip.
 */
import {
  DEFAULT_FILL_TOKENS,
  DEFAULT_THEME,
  DefaultFontFaces,
  getColorValue,
  hexToRgba,
  type DefaultColorStyle,
  type DefaultFillStyle,
  type DefaultFontStyle,
  type TLColorMode,
  type TLFontFace,
  type TLTheme,
  type TLThemeColors,
} from "@mocanvas/editor"

/**
 * The ramp a caller that has no editor resolves against: the built-in theme's
 * light half. Named rather than inlined so it is obvious that every default
 * below is one decision, not eight.
 */
export const FALLBACK_THEME_COLORS: TLThemeColors = DEFAULT_THEME.colors.light

/** What a ramp can be read off: the editor, or anything else theme-shaped. */
export interface ThemeSource {
  getCurrentTheme?(): TLTheme
  getColorMode?(): TLColorMode
}

/**
 * The theme `source` is currently painting with, or the built-in one.
 *
 * Tolerant on purpose: a util's `editor` is typed but a test double, a
 * half-constructed editor or a detached exporter may not implement either
 * method, and a missing theme must degrade to the default rather than throw
 * inside a render.
 */
export function getTheme(source: ThemeSource | null | undefined): TLTheme {
  return source?.getCurrentTheme?.() ?? DEFAULT_THEME
}

/** The ramp `source` is currently painting with; see {@link getTheme}. */
export function getThemeColors(source: ThemeSource | null | undefined): TLThemeColors {
  const theme = getTheme(source)
  const mode = source?.getColorMode?.() ?? "light"
  return theme.colors[mode] ?? theme.colors.light
}

/** Engine RGBA for a shape's stroke. */
export function getStrokeRgba(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): number {
  return hexToRgba(getColorValue(colors, color, "solid"))
}

/**
 * Engine RGBA for a shape's interior. `0` means "no fill".
 *
 * The fill *styles* and the palette *tokens* share names but are one step
 * apart, which is easy to get wrong: `semi` paints the paper colour with a
 * barely-there tint, `solid` paints the hue's pale tint (the `semi` token),
 * and only `fill` paints the hue at full strength (the `solid` token). That
 * table is stated once, in `DEFAULT_FILL_TOKENS`, and read here rather than
 * restated — the stroke always uses the full-strength colour, so a `solid`
 * fill reads as a pale body inside a saturated outline.
 */
export function getFillRgba(
  color: DefaultColorStyle,
  fill: DefaultFillStyle,
  colors: TLThemeColors = FALLBACK_THEME_COLORS,
): number {
  const token = DEFAULT_FILL_TOKENS[fill] ?? "none"
  if (token === "none") return 0
  if (token === "paper") return hexToRgba(colors.solid)
  return hexToRgba(getColorValue(colors, color, token))
}

/** Engine RGBA for a sticky note's background. */
export function getNoteFillRgba(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): number {
  return hexToRgba(getColorValue(colors, color, "noteFill"))
}

/** CSS color string for text drawn in the DOM overlay. */
export function getTextCssColor(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): string {
  return getColorValue(colors, color, "solid")
}

/** CSS color string for text on a sticky note. */
export function getNoteTextCssColor(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): string {
  return getColorValue(colors, color, "noteText")
}

/** The CSS font stack a font style resolves to, in `theme`. */
export function getFontFamily(font: DefaultFontStyle, theme: TLTheme = DEFAULT_THEME): string {
  return theme.fonts[font] ?? theme.fonts.draw
}

// SEMANTICS-ASSUMED: a label needs all four faces of its family, not just the
// upright regular one. Rich text can turn any run bold or italic without
// changing the shape's `font` prop, so loading one face would leave a bold run
// synthesised (and mis-measured) until something else happened to pull the real
// one in. The built-in faces are local families, so asking for four costs
// nothing; a theme that swaps in webfonts pays four requests per family used.
/**
 * The typefaces a label in `font` needs: the four `[style][weight]` faces of
 * that family.
 *
 * This is what a text-bearing `ShapeUtil.getFontFaces` answers. Only the
 * *built-in* face registry is consulted — a theme that names its own families
 * registers their faces with the font manager itself, because a CSS stack says
 * which families to try, not where to fetch them.
 */
export function getLabelFontFaces(font: DefaultFontStyle): TLFontFace[] {
  const set = DefaultFontFaces[`tldraw_${font}`]
  if (set === undefined) return []
  const faces: TLFontFace[] = []
  for (const byWeight of Object.values(set)) {
    for (const face of Object.values(byWeight)) faces.push(face)
  }
  return faces
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
export function getNoteFillCssColor(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): string {
  return getColorValue(colors, color, "noteFill")
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
export function getNoteGradientTopCssColor(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): string {
  return getNoteGradientTopFrom(getNoteFillCssColor(color, colors))
}

/** CSS `background` for a note body: the vertical gradient, top to bottom. */
export function getNoteBodyGradientCss(color: DefaultColorStyle, colors: TLThemeColors = FALLBACK_THEME_COLORS): string {
  return `linear-gradient(to bottom, ${getNoteGradientTopCssColor(color, colors)} 0%, ${getNoteFillCssColor(color, colors)} 100%)`
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
