/**
 * The two built-in ramps.
 *
 * The light ramp is not re-authored here: it is projected from the palette
 * `LIGHT_THEME` that the default shapes have always painted with, so moving to
 * the theme system changes no pixel of a light board. The dark ramp is new —
 * its inks are picked to clear WCAG AA for text against the dark page, which
 * `theme.test.ts` asserts rather than trusts.
 */
import { DEFAULT_COLORS, LIGHT_THEME, type DefaultColorStyle } from "../records/styles"
import type { TLDefaultColor, TLDefaultColorVariant, TLThemeColors, TLThemeDefaultColors } from "./types"

// ---- colour arithmetic -----------------------------------------------------

/** `#rrggbb` → `[r, g, b]`. Anything unparseable comes back as mid grey. */
function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [128, 128, 128]
  const n = Number.parseInt(m[1] as string, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** `amount` of the way from `from` to `to`, per channel. */
export function mixHexColors(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  const t = Math.min(1, Math.max(0, amount))
  const ch = (i: number): number => Math.round((a[i] as number) + ((b[i] as number) - (a[i] as number)) * t)
  return `#${((ch(0) << 16) | (ch(1) << 8) | ch(2)).toString(16).padStart(6, "0")}`
}

// ---- surface colours -------------------------------------------------------

/** The light surface, taken from the palette the shapes already use. */
const LIGHT_SURFACE = {
  background: LIGHT_THEME.background,
  solid: LIGHT_THEME.solid,
  text: LIGHT_THEME.text,
  selectFill: "rgba(68, 101, 233, 0.10)",
  selectStroke: "#4465e9",
  hint: "#cc00cc",
  grid: "#b4bcc4",
} as const

/** The dark surface. `background` is the plate every dark ink is measured on. */
const DARK_SURFACE = {
  background: "#101011",
  solid: "#1a1a1c",
  text: "#f2f2f2",
  selectFill: "rgba(122, 151, 245, 0.14)",
  selectStroke: "#7a97f5",
  hint: "#ff66ff",
  grid: "#46464d",
} as const

// ---- the dark inks ---------------------------------------------------------

/**
 * Dark-mode ink per colour name — the one value that has to be *chosen* rather
 * than derived, because legibility is not a colour operation.
 *
 * `black` and `white` swap roles: in dark mode "black ink" is the page's
 * near-white text colour, and "white ink" stays white.
 */
const DARK_INKS: Record<DefaultColorStyle, string> = {
  black: "#f2f2f2",
  grey: "#a8b0b8",
  "light-violet": "#dda4f0",
  violet: "#c26fd6",
  blue: "#7a97f5",
  "light-blue": "#7fc0f7",
  yellow: "#f1ac4b",
  orange: "#f08a4a",
  green: "#3cae87",
  "light-green": "#6fc47e",
  "light-red": "#f79a9a",
  red: "#ef5c5c",
  white: "#ffffff",
}

/**
 * Sticky-note body per colour name in dark mode: a deep, low-chroma bed for
 * light text, rather than the light ramp's pastel.
 */
const DARK_NOTE_FILLS: Record<DefaultColorStyle, string> = {
  black: "#2c2c2c",
  grey: "#36393d",
  "light-violet": "#43304d",
  violet: "#3b2545",
  blue: "#26314f",
  "light-blue": "#233a4e",
  yellow: "#4a3a1e",
  orange: "#4a2f1a",
  green: "#1e3d33",
  "light-green": "#28402c",
  "light-red": "#4b2b2b",
  red: "#452626",
  white: "#3d3d3d",
}

/** Ink on a dark sticky note. */
const DARK_NOTE_TEXT = "#f2f2f2"

// ---- assembling a ramp -----------------------------------------------------

/**
 * How much of the surface each derived token mixes in. Frames are pale plates
 * of their colour with a mid-strength border; a dark ramp's `semi` is a hint of
 * hue over the page rather than a wash of white.
 */
const MIX = {
  semi: 0.86,
  pattern: 0.4,
  frameFill: 0.97,
  frameStroke: 0.4,
  frameHeadingFill: 0.92,
  frameText: 0.15,
} as const

/** The frame + highlight tokens, derived from a colour's ink and the surface. */
function frameTokens(
  ink: string,
  paper: string,
): Pick<TLDefaultColor, "frameFill" | "frameStroke" | "frameHeadingFill" | "frameHeadingStroke" | "frameText"> {
  const stroke = mixHexColors(ink, paper, MIX.frameStroke)
  return {
    frameFill: mixHexColors(ink, paper, MIX.frameFill),
    frameStroke: stroke,
    frameHeadingFill: mixHexColors(ink, paper, MIX.frameHeadingFill),
    frameHeadingStroke: stroke,
    frameText: mixHexColors(ink, paper, MIX.frameText),
  }
}

/** The light palette, projected from the shapes' existing colour table. */
function buildLightPalette(): TLThemeDefaultColors {
  const out = {} as Record<DefaultColorStyle, TLDefaultColor>
  for (const name of DEFAULT_COLORS) {
    const base = LIGHT_THEME[name]
    out[name] = Object.freeze({
      solid: base.solid,
      fill: base.fill,
      semi: base.semi,
      pattern: base.pattern,
      noteFill: base.note.fill,
      noteText: base.note.text,
      ...frameTokens(base.solid, LIGHT_SURFACE.solid),
      highlightSrgb: base.highlight.srgb,
      highlightP3: base.highlight.p3,
    })
  }
  return out
}

/**
 * The dark palette. Only the ink and the note body are authored; the rest is
 * that ink mixed toward the dark page, which is what keeps a `semi` fill from
 * glowing on a dark board.
 */
function buildDarkPalette(): TLThemeDefaultColors {
  const out = {} as Record<DefaultColorStyle, TLDefaultColor>
  for (const name of DEFAULT_COLORS) {
    const ink = DARK_INKS[name]
    out[name] = Object.freeze({
      solid: ink,
      fill: ink,
      semi: mixHexColors(ink, DARK_SURFACE.background, MIX.semi),
      pattern: mixHexColors(ink, DARK_SURFACE.background, MIX.pattern),
      noteFill: DARK_NOTE_FILLS[name],
      noteText: DARK_NOTE_TEXT,
      ...frameTokens(ink, DARK_SURFACE.solid),
      highlightSrgb: LIGHT_THEME[name].highlight.srgb,
      highlightP3: LIGHT_THEME[name].highlight.p3,
    })
  }
  return out
}

/** The built-in light ramp. */
export const DEFAULT_LIGHT_COLORS: TLThemeColors = Object.freeze({
  ...buildLightPalette(),
  ...LIGHT_SURFACE,
})

/** The built-in dark ramp. */
export const DEFAULT_DARK_COLORS: TLThemeColors = Object.freeze({
  ...buildDarkPalette(),
  ...DARK_SURFACE,
})

// ---- reading a ramp --------------------------------------------------------

/**
 * One value out of a ramp: the paint a given colour name gets for a given
 * variant.
 *
 * This is the accessor a UI should use to preview a colour, because it reads
 * the ramp the editor is *currently* painting with
 * (`theme.colors[editor.getColorMode()]`) rather than a snapshot of one.
 * Unknown names fall back to `black`, so a stale persisted colour previews as
 * ink rather than as `undefined`.
 */
export function getColorValue(
  colors: TLThemeColors,
  name: DefaultColorStyle | (string & {}),
  variant: TLDefaultColorVariant = "solid",
): string {
  const entry = (colors as unknown as Record<string, unknown>)[name]
  const color = (typeof entry === "object" && entry !== null ? entry : colors.black) as TLDefaultColor
  return color[variant]
}

/** Every palette entry of a ramp, in registration order. Surface colours are skipped. */
export function getPaletteEntries(colors: TLThemeColors): Array<[string, TLDefaultColor]> {
  return Object.entries(colors).filter(
    (entry): entry is [string, TLDefaultColor] => typeof entry[1] === "object" && entry[1] !== null,
  )
}
