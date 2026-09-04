/**
 * The v5 theme model: a theme holds a *light* and a *dark* palette plus the
 * metrics (fonts, font sizes, stroke widths) a shape needs to turn its style
 * props into something concrete. Nothing here persists — the style *props*
 * (`color: "blue"`, `size: "m"`, …) are the file format; a theme only decides
 * what those names look like on screen.
 */
import type {
  DefaultColorStyle as ColorValue,
  DefaultDashStyle as DashValue,
  DefaultFillStyle as FillValue,
  DefaultFontStyle as FontValue,
  DefaultSizeStyle as SizeValue,
} from "../records/styles"

/** A resolved colour mode: what the canvas actually paints in. */
export type TLColorMode = "light" | "dark"

/**
 * The colour-mode *setting*. `"system"` follows the host window's
 * `prefers-color-scheme`; the other two pin the mode.
 */
export type TLColorScheme = TLColorMode | "system"

/**
 * One palette entry — every way a single colour name can be painted.
 *
 * All values are CSS colour strings so a consumer never has to branch on the
 * shape of a token (this is what lets {@link getColorValue} return `string`).
 */
export interface TLDefaultColor {
  /** Ink: strokes, text, arrowheads — the hue at full strength. */
  solid: string
  /** The hue as an opaque interior. */
  fill: string
  /** A pale tint of the hue, for lightly filled interiors. */
  semi: string
  /** Stroke colour of the hatch pattern used by pattern fills. */
  pattern: string
  /** Body of a sticky note. */
  noteFill: string
  /** Text drawn on a sticky note. */
  noteText: string
  /** Body of a frame. */
  frameFill: string
  /** Border of a frame. */
  frameStroke: string
  /** Body of the strip a frame's name sits in. */
  frameHeadingFill: string
  /** Border of that strip. */
  frameHeadingStroke: string
  /** The frame's name. */
  frameText: string
  /** Highlighter ink, sRGB — the fallback everywhere. */
  highlightSrgb: string
  /** Highlighter ink in Display P3, for wide-gamut screens. */
  highlightP3: string
}

/** Which part of a palette entry to read. */
export type TLDefaultColorVariant = keyof TLDefaultColor

/** The palette: one {@link TLDefaultColor} per style colour name. */
export type TLThemeDefaultColors = Record<ColorValue, TLDefaultColor>

// SEMANTICS-ASSUMED: which surface colours a ramp carries, and their names.
// The consumer only ever reads palette entries and iterates the ramp telling
// objects from strings, so the string half is ours to define; these are the
// surface colours mocanvas already paints (page, paper, text) plus the ones the
// selection and snap overlays need.
/**
 * A full ramp: the palette plus the handful of colours that belong to the
 * surface rather than to any one shape.
 *
 * The two halves are told apart by shape, not by a list — palette entries are
 * objects, surface colours are strings — which is what lets a consumer iterate
 * the ramp without knowing the built-in names.
 */
export interface TLThemeColors extends TLThemeDefaultColors {
  /** The page behind everything. */
  background: string
  /** The "paper" a shape is drawn on: an interior with no colour of its own. */
  solid: string
  /** Default text colour on that paper. */
  text: string
  /** Interior of a selection brush / selection box. */
  selectFill: string
  /** Selection and indicator outlines. */
  selectStroke: string
  /** Snap lines and drop-target hints. */
  hint: string
  /** The grid lattice. */
  grid: string
  /**
   * Palette entries an app adds beyond the built-in names, plus surface
   * colours of its own. Declared so a custom ramp — the point of the theme
   * system — needs no cast; the built-in names above still keep their exact
   * types, and {@link getPaletteEntries} tells the two kinds apart by shape.
   */
  [name: string]: TLDefaultColor | string
}

/** CSS font stacks, one per font style prop value. */
export type TLThemeFonts = Record<FontValue, string>

/**
 * One loadable typeface, in the vocabulary of the CSS `@font-face` rule.
 *
 * A font *manager* turns these into real `FontFace` objects and loads them on
 * demand; the theme only says which faces exist.
 */
export interface TLFontFace {
  /** The `font-family` this face is registered under, e.g. `tldraw_draw`. */
  family: string
  /**
   * The CSS `src` descriptor, verbatim — `url("/f.woff2") format("woff2")`,
   * or `local("Georgia")` for a face that is already on the machine. It is
   * handed to `new FontFace(family, src, descriptors)` unchanged.
   */
  src: string
  /** `font-weight` descriptor, e.g. `"normal"`, `"700"`. */
  weight?: string
  /** `font-style` descriptor, e.g. `"normal"`, `"italic"`. */
  style?: string
  /** `font-stretch` descriptor. */
  stretch?: string
  /** `unicode-range` descriptor. */
  unicodeRange?: string
  /** `font-display` descriptor. */
  display?: "auto" | "block" | "swap" | "fallback" | "optional"
}

/**
 * The faces of one family, indexed `[style][weight]` — the shape a picker
 * reads a single preview face out of:
 * `DefaultFontFaces["tldraw_serif"]?.normal?.normal`.
 */
export type TLFontFaceSet = Record<string, Record<string, TLFontFace>>

/**
 * A theme id. `"default"` always exists; an app may register further ids, or
 * replace `"default"` outright to restyle every board it mounts.
 */
export type TLThemeId = "default" | (string & {})

/**
 * A complete theme: both ramps and the metrics that go with them.
 *
 * Everything except {@link TLTheme.id} is what {@link getDisplayValues} reads,
 * so overriding a single field (one colour, one stroke width) is enough to
 * restyle every shape that resolves through it.
 */
export interface TLTheme {
  /** The key this theme is registered under. */
  id: TLThemeId
  /** The two ramps. Which one is live is the colour *mode*, not the theme. */
  colors: { light: TLThemeColors; dark: TLThemeColors }
  /** CSS font stacks per font style. */
  fonts: TLThemeFonts
  /** Rendered font size, in page units, per size style. */
  fontSize: Record<SizeValue, number>
  // SEMANTICS-ASSUMED: a single multiplier rather than a per-size table. The
  // consumer only asserts that a theme carries `lineHeight` and passes it
  // through untouched, so the simpler shape wins.
  /** Line height as a multiple of the font size. */
  lineHeight: number
  /** Stroke width, in page units, per size style. */
  strokeWidth: Record<SizeValue, number>
}

/**
 * A change to a theme. `Partial<TLTheme>` is accepted as-is; the ramps are
 * loosened to partials as well so an app can restyle one colour without
 * restating the other twelve.
 */
export interface TLThemePatch extends Partial<Omit<TLTheme, "colors">> {
  colors?: { light?: Partial<TLThemeColors>; dark?: Partial<TLThemeColors> }
}

/** Every registered theme, by id. */
export type TLThemes = Record<TLThemeId, TLTheme>

/** What an app hands in: a partial map, merged over the built-in `default`. */
export type TLThemesInput = Partial<Record<TLThemeId, TLTheme>>

/**
 * The concrete values a default shape paints with, once its style props have
 * been resolved against a theme and a colour mode.
 *
 * This is the *default* set. A shape util may declare its own richer set (a
 * note's body size, a label's padding) — see {@link getDisplayValues}.
 */
export interface TLDefaultDisplayValues {
  /** Stroke / ink colour. */
  color: string
  /** Text drawn on the shape. */
  labelColor: string
  /** Interior colour, or `"transparent"` when the fill style is `none`. */
  fill: string
  /** Stroke width in page units. */
  strokeWidth: number
  /** The dash style, passed through so a renderer can pick its own technique. */
  dash: string
  /** Dash pattern in page units; empty for a continuous stroke. */
  dashArray: readonly number[]
  /** Font size in page units. */
  fontSize: number
  /** Line height in page units. */
  lineHeight: number
  /** CSS font stack. */
  fontFamily: string
}

/** The style props {@link getDefaultDisplayValues} reads, all optional. */
export interface TLStyledShapeProps {
  color?: ColorValue
  labelColor?: ColorValue
  fill?: FillValue
  dash?: DashValue | "none"
  size?: SizeValue
  font?: FontValue
}

/** A shape as far as display values are concerned: a props bag, nothing else. */
export interface TLStyledShape {
  props: TLStyledShapeProps
}

/**
 * A shape util's *default* display values: everything the util renders,
 * derived from the shape and the live theme.
 *
 * It takes the editor explicitly (rather than being a method) so it can be
 * declared in a util's `options` and overridden by `configure()` without
 * subclassing.
 */
export type TLGetDefaultDisplayValues<S = TLStyledShape, D extends object = TLDefaultDisplayValues> = (
  editor: unknown,
  shape: S,
  theme: TLTheme,
  colorMode: TLColorMode,
) => D

/**
 * The override point: return only the fields you want to change, or nothing at
 * all to accept the defaults.
 */
export type TLGetCustomDisplayValues<S = TLStyledShape, D extends object = TLDefaultDisplayValues> = (
  editor: unknown,
  shape: S,
  theme: TLTheme,
  colorMode: TLColorMode,
) => Partial<D> | undefined

/**
 * What {@link getDisplayValues} needs from a shape util: the editor it belongs
 * to, its options (which may carry `getDefaultDisplayValues`) and its optional
 * `getCustomDisplayValues` override.
 *
 * Structural on purpose — a util looked up by string from `editor.shapeUtils`
 * cannot carry its display-value type in the generic, so callers pass the two
 * type arguments themselves.
 */
export interface TLDisplayValuesSource<S = TLStyledShape, D extends object = TLDefaultDisplayValues> {
  editor: unknown
  options?: { getDefaultDisplayValues?: TLGetDefaultDisplayValues<S, D> } | undefined
  getCustomDisplayValues?: TLGetCustomDisplayValues<S, D> | undefined
}

/** What {@link getDisplayValues} reads a theme off. The editor implements it. */
export interface TLThemeHost {
  getCurrentTheme(): TLTheme
  getColorMode(): TLColorMode
}
