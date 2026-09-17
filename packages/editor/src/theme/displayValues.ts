/**
 * Display values: the step between a shape's *style props* and what is
 * actually drawn.
 *
 * A shape persists `{ color: "blue", fill: "semi", size: "m" }` — names, not
 * paint. Resolving those names against the live theme and colour mode is the
 * job of one function per shape util, and reading the result is the job of
 * {@link getDisplayValues}. Renderers, exporters and measurement code all go
 * through it, so there is exactly one place where "blue" becomes `#4465e9`.
 */
import { STROKE_SIZES, type DefaultFillStyle } from "../records/styles"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { getColorValue } from "./colors"
import type {
  TLColorMode,
  TLDefaultColorVariant,
  TLDefaultDisplayValues,
  TLDisplayValuesSource,
  TLStyledShape,
  TLTheme,
  TLThemeHost,
} from "./types"

/**
 * Which palette token each fill *style* paints with.
 *
 * The style names and the token names overlap without lining up, which is the
 * easiest thing here to get wrong: `semi` paints the paper with barely a tint,
 * `solid` paints the hue's pale tint (the `semi` token), and only `fill` paints
 * the hue at full strength. Reading the token whose name matches the style
 * makes every filled shape a step too saturated. Stated once, here, so a
 * renderer and an exporter cannot disagree about it.
 *
 * `"paper"` means the ramp's own `solid` surface colour, not a palette entry.
 *
 * A swatch UI that previews the fill styles reads *tokens* by name instead
 * (`getColorValue(colors, "black", "semi")`) — that is a UI decision about what
 * to show, and it is deliberately not routed through this table.
 */
export const DEFAULT_FILL_TOKENS: Record<DefaultFillStyle, TLDefaultColorVariant | "paper" | "none"> = {
  none: "none",
  semi: "paper",
  solid: "semi",
  // The paper *behind* the hatch. `pattern` used to paint this table's
  // `pattern` token as a flat fill, which is the colour meant to be the
  // hatch's own stroke — so the one style that should read as texture was the
  // heaviest block of colour on the canvas. The lines themselves come from
  // `DEFAULT_HATCH_TOKENS`.
  pattern: "paper",
  fill: "fill",
}

/**
 * Which palette token each fill style draws its *hatch* in, for the styles that
 * have one. A style absent from this table draws no hatch.
 */
export const DEFAULT_HATCH_TOKENS: Partial<Record<DefaultFillStyle, TLDefaultColorVariant>> = {
  pattern: "pattern",
}

/**
 * Distance between hatch lines, in page units.
 *
 * Page units, so a hatched shape keeps the same texture when the camera moves
 * and a big shape is not a coarser version of a small one — the same reasoning
 * that puts stroke widths in page units.
 */
export const DEFAULT_HATCH_SPACING = 6

// SEMANTICS-ASSUMED: the dash geometry. Nothing in the consumer's code reads a
// dash array, so these are picked to look right at every stroke width — dashes
// three widths long with a two-width gap, dots as near-zero segments drawn with
// a round cap.
/** Dash pattern per dash style, as multiples of the stroke width. */
const DASH_PATTERNS: Record<string, readonly number[]> = {
  solid: [],
  draw: [],
  none: [],
  dashed: [3, 2],
  dotted: [0.1, 2],
}

/**
 * The default resolution of the shared style props.
 *
 * Every prop is optional: a shape that carries none of them still gets a
 * complete, usable set of values, which is what lets a util call this and then
 * override only the parts it actually has an opinion about.
 */
export function getDefaultDisplayValues(
  _editor: unknown,
  shape: TLStyledShape,
  theme: TLTheme,
  colorMode: TLColorMode,
): TLDefaultDisplayValues {
  const colors = theme.colors[colorMode]
  const props = shape.props ?? {}
  const color = props.color ?? "black"
  const size = props.size ?? "m"
  const dash = props.dash ?? "draw"
  const strokeWidth = theme.strokeWidth[size] ?? STROKE_SIZES[size] ?? STROKE_SIZES.m
  const fontSize = theme.fontSize[size] ?? DEFAULT_THEME.fontSize[size]
  const token = DEFAULT_FILL_TOKENS[props.fill ?? "none"] ?? "none"

  return {
    color: getColorValue(colors, color, "solid"),
    labelColor: getColorValue(colors, props.labelColor ?? color, "solid"),
    fill: token === "none" ? "transparent" : token === "paper" ? colors.solid : getColorValue(colors, color, token),
    strokeWidth,
    dash,
    dashArray: (DASH_PATTERNS[dash] ?? []).map((n) => n * strokeWidth),
    fontSize,
    lineHeight: fontSize * theme.lineHeight,
    fontFamily: theme.fonts[props.font ?? "draw"] ?? theme.fonts.draw,
  }
}

/**
 * The display values of one shape, as its util resolves them.
 *
 * Merges the util's defaults with whatever its `getCustomDisplayValues`
 * override returns, against the theme and colour mode the editor is *currently*
 * painting with — so calling this inside a reactive context re-runs it when the
 * theme changes.
 *
 * The two type arguments are given by the caller rather than inferred, because
 * a util looked up by string out of `editor.shapeUtils` has lost its own
 * display-value type by then:
 *
 * ```ts
 * const display = getDisplayValues<NoteShape, NoteDisplayValues>(util, note)
 * ```
 */
export function getDisplayValues<S = TLStyledShape, D extends object = TLDefaultDisplayValues>(
  util: TLDisplayValuesSource<S, D>,
  shape: S,
): D {
  const host = util.editor as Partial<TLThemeHost> | undefined
  const theme = host?.getCurrentTheme?.() ?? DEFAULT_THEME
  const colorMode = host?.getColorMode?.() ?? "light"
  const base =
    util.options?.getDefaultDisplayValues?.(util.editor, shape, theme, colorMode) ??
    (getDefaultDisplayValues(util.editor, shape as TLStyledShape, theme, colorMode) as unknown as D)
  const custom = util.getCustomDisplayValues?.(util.editor, shape, theme, colorMode)
  return custom ? { ...base, ...custom } : base
}
