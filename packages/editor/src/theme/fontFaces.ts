/**
 * Fonts as a theme describes them, and the registry that lets an app's own
 * typefaces appear in the font picker.
 *
 * A theme owns two halves of the same decision: what a font *is* — the CSS
 * stack and the faces to load — and what the person picking it is shown. Both
 * live on {@link TLThemeFont}, so adding a typeface to a board is one object
 * rather than a stack in one place and a preview glyph in another.
 */
import type { ReactNode } from "react"
import { DefaultFontStyle, type EnumStyleProp } from "../records/styleProp"
import { DEFAULT_FONT_FAMILIES } from "./fonts"
import type { TLFontFace, TLThemeFonts, TLThemes } from "./types"

/**
 * Where the bytes of one font face come from.
 *
 * An object rather than a raw CSS `src` string so the format can be stated
 * separately: a browser that is told `format("woff2")` up front can skip a face
 * it cannot use without fetching it, and a URL alone gives it nothing to go on.
 */
export interface TLFontFaceSource {
  /** Absolute or document-relative URL of the font file. */
  url: string
  /** The CSS `format()` hint — `"woff2"`, `"truetype"`, and so on. */
  format?: string | undefined
}

/**
 * One selectable typeface: the stack shapes render with, the faces to load, and
 * what the picker shows.
 *
 * `icon` is a rendered preview rather than a name because a font picker that
 * lists names tells you nothing — the whole question is what the letters look
 * like.
 */
export interface TLThemeFont {
  /** The CSS `font-family` value shapes using this font resolve to. */
  fontFamily: string
  /** What the picker draws for this font. Usually a sample of letterforms. */
  icon?: ReactNode
  /** The faces to load before text in this font is painted. */
  faces?: readonly TLFontFace[]
}

/**
 * The CSS stacks per built-in font style, under the documented name.
 *
 * The same object as {@link DEFAULT_FONT_FAMILIES}: there is one set of built-in
 * stacks however you reach it.
 */
export const DefaultFontFamilies: TLThemeFonts = DEFAULT_FONT_FAMILIES

/**
 * The colours in a ramp that belong to the *surface* rather than to any shape.
 *
 * Every theme has to answer all of them, because they are what the canvas
 * itself is drawn with — a theme that left `selectionStroke` undefined would
 * render an invisible selection box. They are named separately from the palette
 * because they are not colours a person can pick for a shape: nothing has
 * `color: "brushFill"`.
 */
export type TLThemeUiColorKeys =
  /** Default text colour. */
  | "text"
  /** The canvas behind everything; also the background of an SVG export. */
  | "background"
  /** Areas that cut through to the background: frame heading knockouts, text outlines. */
  | "negativeSpace"
  /** Default solid surface colour. */
  | "solid"
  /** The local pointer. */
  | "cursor"
  /** Border of a note shape. */
  | "noteBorder"
  /** Outline of the selection box. */
  | "selectionStroke"
  /** Interior of the selection box. */
  | "selectionFill"
  /** Indicators drawn on top of a selected shape, which must contrast with it. */
  | "selectedContrast"
  /** Outline of the selection-brush rectangle. */
  | "brushStroke"
  /** Interior of the selection-brush rectangle. */
  | "brushFill"
  /** Snap guides. */
  | "snap"
  /** The laser pointer trail. */
  | "laser"

/**
 * Built-in palette colours an app has removed, declared by augmenting this
 * interface.
 *
 * Empty by design. It exists to be augmented:
 *
 * ```ts
 * declare module "@mocanvas/editor" {
 *   interface TLRemovedDefaultThemeColors {
 *     "light-violet": true
 *   }
 * }
 * ```
 *
 * Any key added here is dropped from {@link ./types.TLThemeDefaultColors}, so
 * TypeScript stops asking a custom theme to define a colour the app does not
 * want — and stops an app from referring to one it removed. The UI colours in
 * {@link TLThemeUiColorKeys} cannot be removed: the canvas is drawn with them.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TLRemovedDefaultThemeColors {}

/**
 * Make every font named by a registered theme selectable.
 *
 * The mirror of `registerColorsFromThemes`, and it exists for the same reason:
 * the *style prop* is what a shape persists, so a font an app added to a theme
 * is unusable until the prop's value list knows about it — the store would
 * reject `font: "pixel"` as an invalid enum value.
 *
 * Union across themes, in first-seen order, so switching theme does not
 * invalidate a shape whose font only the other theme defines. A shape keeps its
 * font when the theme has no stack for it; it just falls back while that theme
 * is current, which is recoverable, whereas dropping the value is not.
 */
export function registerFontsFromThemes(themes: TLThemes): void {
  const names = getFontNamesFromThemes(themes)
  if (names.length === 0) return
  const values = (DefaultFontStyle as unknown as EnumStyleProp<string>).values as string[]
  if (values.length === names.length && names.every((name, i) => values[i] === name)) return
  // Mutated in place rather than replaced: the array identity is what shape
  // props and the style panel already hold.
  values.length = 0
  values.push(...names)
}

/** Every font name any registered theme defines, in first-seen order. */
export function getFontNamesFromThemes(themes: TLThemes): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const theme of Object.values(themes)) {
    for (const name of Object.keys(theme.fonts ?? {})) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}
