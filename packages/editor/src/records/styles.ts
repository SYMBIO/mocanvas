/** Style value unions shared by the default shapes. Kept identical for file compatibility. */

export const DEFAULT_COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
] as const
export type DefaultColorStyle = (typeof DEFAULT_COLORS)[number]

export const DEFAULT_FILLS = ["none", "semi", "solid", "pattern", "fill"] as const
export type DefaultFillStyle = (typeof DEFAULT_FILLS)[number]

export const DEFAULT_DASHES = ["draw", "solid", "dashed", "dotted"] as const
export type DefaultDashStyle = (typeof DEFAULT_DASHES)[number]

export const DEFAULT_SIZES = ["s", "m", "l", "xl"] as const
export type DefaultSizeStyle = (typeof DEFAULT_SIZES)[number]

export const DEFAULT_FONTS = ["draw", "sans", "serif", "mono"] as const
export type DefaultFontStyle = (typeof DEFAULT_FONTS)[number]

export const DEFAULT_H_ALIGNS = ["start", "middle", "end", "start-legacy", "end-legacy", "middle-legacy"] as const
export type DefaultHorizontalAlignStyle = (typeof DEFAULT_H_ALIGNS)[number]

export const DEFAULT_V_ALIGNS = ["start", "middle", "end"] as const
export type DefaultVerticalAlignStyle = (typeof DEFAULT_V_ALIGNS)[number]

export const GEO_SHAPE_KINDS = [
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "rhombus",
  "rhombus-2",
  "oval",
  "trapezoid",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "x-box",
  "check-box",
  "cloud",
  "heart",
] as const
export type GeoShapeKind = (typeof GEO_SHAPE_KINDS)[number]

/**
 * Horizontal alignment of *text inside a text-bearing shape*, as opposed to the
 * alignment of the shape's own label box, which is
 * {@link DEFAULT_H_ALIGNS}. Both exist because a note can be centred on the
 * canvas while its paragraphs are left-aligned.
 */
export const DEFAULT_TEXT_ALIGNS = ["start", "middle", "end"] as const
export type DefaultTextAlignStyle = (typeof DEFAULT_TEXT_ALIGNS)[number]

/** Shapes an arrow terminal can be drawn as. */
export const ARROWHEAD_KINDS = [
  "none",
  "arrow",
  "triangle",
  "square",
  "dot",
  "diamond",
  "inverted",
  "bar",
  "pipe",
] as const
export type ArrowShapeArrowheadKind = (typeof ARROWHEAD_KINDS)[number]

/** How an arrow's body is routed. */
export const ARROW_SHAPE_KINDS = ["arc", "elbow"] as const
export type ArrowShapeKind = (typeof ARROW_SHAPE_KINDS)[number]

/** How a line shape interpolates between its points. */
export const LINE_SPLINE_KINDS = ["cubic", "line"] as const
export type LineShapeSplineKind = (typeof LINE_SPLINE_KINDS)[number]

/**
 * Where an elbow arrow is allowed to attach when its terminal is bound to a
 * shape: `"none"` keeps the stored point, `"edge"` snaps to the nearest edge,
 * `"center"` to the shape's centre, `"edge-point"` to the nearest point on an
 * edge, `"none-edge"` to an edge only while dragging.
 */
export const ELBOW_ARROW_SNAP_MODES = ["none", "edge", "center", "edge-point", "none-edge"] as const
export type ElbowArrowSnapMode = (typeof ELBOW_ARROW_SNAP_MODES)[number]

/** Stroke widths in page units per size, matching the classic look. */
export const STROKE_SIZES: Record<DefaultSizeStyle, number> = { s: 2, m: 3.5, l: 5, xl: 10 }
export const FONT_SIZES: Record<DefaultSizeStyle, number> = { s: 18, m: 24, l: 36, xl: 44 }

export interface ThemeColor {
  solid: string
  semi: string
  pattern: string
  fill: string
  note: { fill: string; text: string }
  highlight: { srgb: string; p3: string }
}

/**
 * A palette in the spirit of the classic light theme. Values are our own picks:
 * hue-matched, tuned for contrast on white and on the semi fills.
 */
export const LIGHT_THEME: Record<DefaultColorStyle, ThemeColor> & { background: string; solid: string; text: string } = {
  background: "#f9fafb",
  solid: "#fcfffe",
  text: "#000000",
  black: {
    solid: "#1d1d1d", semi: "#e8e8e8", pattern: "#494949", fill: "#1d1d1d",
    note: { fill: "#fce19c", text: "#000000" }, highlight: { srgb: "#fddd00", p3: "color(display-p3 0.972 0.8705 0.05)" },
  },
  grey: {
    solid: "#9fa8b2", semi: "#eceef0", pattern: "#bac3cb", fill: "#9fa8b2",
    note: { fill: "#eaeaea", text: "#000000" }, highlight: { srgb: "#cbe7f1", p3: "color(display-p3 0.85 0.9 0.94)" },
  },
  "light-violet": {
    solid: "#e085f4", semi: "#f5eafa", pattern: "#e9acf8", fill: "#e085f4",
    note: { fill: "#f5eafa", text: "#000000" }, highlight: { srgb: "#f6c9ff", p3: "color(display-p3 0.97 0.79 1)" },
  },
  violet: {
    solid: "#ae3ec9", semi: "#ecdcf2", pattern: "#c26fd6", fill: "#ae3ec9",
    note: { fill: "#e5b7f1", text: "#000000" }, highlight: { srgb: "#dfa7f1", p3: "color(display-p3 0.87 0.65 0.95)" },
  },
  blue: {
    solid: "#4465e9", semi: "#dce1f8", pattern: "#6681ee", fill: "#4465e9",
    note: { fill: "#c9d3fb", text: "#000000" }, highlight: { srgb: "#8fbdff", p3: "color(display-p3 0.56 0.74 1)" },
  },
  "light-blue": {
    solid: "#4ba1f1", semi: "#ddedfa", pattern: "#78b7f4", fill: "#4ba1f1",
    note: { fill: "#c9e4fb", text: "#000000" }, highlight: { srgb: "#9de0ff", p3: "color(display-p3 0.62 0.88 1)" },
  },
  yellow: {
    solid: "#f1ac4b", semi: "#f9f0e6", pattern: "#f3c68a", fill: "#f1ac4b",
    note: { fill: "#fbe9c9", text: "#000000" }, highlight: { srgb: "#fddd00", p3: "color(display-p3 0.972 0.8705 0.05)" },
  },
  orange: {
    solid: "#e16919", semi: "#faeae1", pattern: "#eb9c6a", fill: "#e16919",
    note: { fill: "#f9d3b8", text: "#000000" }, highlight: { srgb: "#ffa971", p3: "color(display-p3 1 0.66 0.44)" },
  },
  green: {
    solid: "#099268", semi: "#d3e9e3", pattern: "#4ab99c", fill: "#099268",
    note: { fill: "#b5dfd2", text: "#000000" }, highlight: { srgb: "#98f2c8", p3: "color(display-p3 0.6 0.95 0.78)" },
  },
  "light-green": {
    solid: "#4cb05e", semi: "#dbf0e0", pattern: "#84c78f", fill: "#4cb05e",
    note: { fill: "#c8ead0", text: "#000000" }, highlight: { srgb: "#98f2c8", p3: "color(display-p3 0.6 0.95 0.78)" },
  },
  "light-red": {
    solid: "#f87777", semi: "#f4dadb", pattern: "#f8a2a2", fill: "#f87777",
    note: { fill: "#fcd1d1", text: "#000000" }, highlight: { srgb: "#ffb2b2", p3: "color(display-p3 1 0.7 0.7)" },
  },
  red: {
    solid: "#e03131", semi: "#f4dadb", pattern: "#ea6b6b", fill: "#e03131",
    note: { fill: "#f4b7b7", text: "#000000" }, highlight: { srgb: "#ff9c9c", p3: "color(display-p3 1 0.61 0.61)" },
  },
  white: {
    solid: "#ffffff", semi: "#f5f5f5", pattern: "#f5f5f5", fill: "#ffffff",
    note: { fill: "#ffffff", text: "#000000" }, highlight: { srgb: "#ffffff", p3: "color(display-p3 1 1 1)" },
  },
}

/** Parse `#rrggbb` or `#rrggbbaa` to the engine's `0xRRGGBBAA`. */
export function hexToRgba(hex: string, alpha = 1): number {
  let h = hex.trim()
  if (h.startsWith("#")) h = h.slice(1)
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : Math.round(alpha * 255)
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}
