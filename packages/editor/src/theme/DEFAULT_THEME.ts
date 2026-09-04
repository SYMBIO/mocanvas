/** The theme every board starts from. */
import { FONT_SIZES, STROKE_SIZES } from "../records/styles"
import { DEFAULT_DARK_COLORS, DEFAULT_LIGHT_COLORS } from "./colors"
import { DEFAULT_FONT_FAMILIES } from "./fonts"
import type { TLTheme } from "./types"

/** Line height as a multiple of the font size, shared by every size. */
export const DEFAULT_LINE_HEIGHT = 1.35

/**
 * The built-in theme, registered under the id `default`.
 *
 * Its metrics are the ones the default shapes have always rendered with, so a
 * board that never touches the theme system looks exactly as it did. Apps
 * usually spread it — `{ ...DEFAULT_THEME, colors: { … } }` — rather than
 * building a theme from nothing, which keeps every field they did not think
 * about at a sane value.
 */
export const DEFAULT_THEME: TLTheme = Object.freeze({
  id: "default",
  colors: Object.freeze({ light: DEFAULT_LIGHT_COLORS, dark: DEFAULT_DARK_COLORS }),
  fonts: DEFAULT_FONT_FAMILIES,
  fontSize: FONT_SIZES,
  lineHeight: DEFAULT_LINE_HEIGHT,
  strokeWidth: STROKE_SIZES,
})
