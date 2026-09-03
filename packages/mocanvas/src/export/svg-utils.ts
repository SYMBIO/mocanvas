/**
 * Small, DOM-free helpers shared by the SVG exporter: number formatting,
 * colour conversion from the engine's `0xRRGGBBAA` words, XML escaping and
 * dash patterns.
 */
import { PATH_OP, type Geometry2d, type Group2d, type StyleWords } from "@mocanvas/editor"
import { pathWordsToSvgD } from "../shapes/svg-path"

/** Affine transform components as returned by `Editor.getShapePageTransform`. */
export interface SvgTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** Format a number for an SVG attribute: at most two decimals, no `-0`. */
export function svgNum(v: number): string {
  if (!Number.isFinite(v)) return "0"
  const r = Math.round(v * 100) / 100
  return String(r === 0 ? 0 : r)
}

/** Escape text for use inside an element or a double-quoted attribute. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Alpha channel (0..255) of an engine colour word. */
export function rgbaAlpha(word: number): number {
  return (word >>> 0) & 0xff
}

/**
 * Convert an engine `0xRRGGBBAA` word to `#rrggbb` (opaque) or `#rrggbbaa`.
 * Returns `undefined` when the colour is fully transparent ("none").
 */
export function rgbaToHex(word: number): string | undefined {
  const w = word >>> 0
  const a = w & 0xff
  if (a === 0) return undefined
  const r = (w >>> 24) & 0xff
  const g = (w >>> 16) & 0xff
  const b = (w >>> 8) & 0xff
  const hex = (n: number): string => n.toString(16).padStart(2, "0")
  return a === 0xff ? `#${hex(r)}${hex(g)}${hex(b)}` : `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`
}

/** `matrix(a b c d e f)` for a `transform` attribute. */
export function matrixAttr(m: SvgTransform): string {
  return `matrix(${svgNum(m.a)} ${svgNum(m.b)} ${svgNum(m.c)} ${svgNum(m.d)} ${svgNum(m.e)} ${svgNum(m.f)})`
}

/**
 * `stroke-dasharray` for an engine dash id (0 solid, 1 dashed, 2 dotted,
 * 3 draw). Solid and draw strokes have no dash array.
 */
export function dashArray(dash: number, strokeWidth: number): string | undefined {
  const sw = Math.max(0.5, strokeWidth)
  switch (dash) {
    case 1:
      return `${svgNum(sw * 2)} ${svgNum(sw * 2)}`
    case 2:
      // Zero-length dashes with round caps read as dots.
      return `0.1 ${svgNum(sw * 2)}`
    default:
      return undefined
  }
}

/** Build an attribute string from a record, skipping `undefined` values. */
export function attrs(values: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue
    parts.push(`${k}="${typeof v === "number" ? svgNum(v) : escapeXml(v)}"`)
  }
  return parts.join(" ")
}

/** Stroke presentation attributes shared by every stroked path. */
export function strokeAttrs(style: StyleWords): Record<string, string | number | undefined> {
  const stroke = rgbaToHex(style.stroke)
  if (!stroke || style.strokeWidth <= 0) return { stroke: "none" }
  return {
    stroke,
    "stroke-width": style.strokeWidth,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
    "stroke-dasharray": dashArray(style.dash, style.strokeWidth),
  }
}

function isGroup(g: Geometry2d): g is Group2d {
  return Array.isArray((g as Group2d).children)
}

/** Leaf geometries of a (possibly nested) group, label rectangles excluded. */
export function geometryLeaves(geometry: Geometry2d): Geometry2d[] {
  if (!isGroup(geometry)) return geometry.isLabel ? [] : [geometry]
  return geometry.children.flatMap((c) => geometryLeaves(c))
}

/** Label rectangles of a geometry (the boxes text labels occupy), in shape-local space. */
export function geometryLabels(geometry: Geometry2d): Geometry2d[] {
  if (!isGroup(geometry)) return geometry.isLabel ? [geometry] : []
  return geometry.children.flatMap((c) => geometryLabels(c))
}

/** Whether a flat path has at least one drawable command. */
export function hasPathWords(words: readonly number[]): boolean {
  return words.length > 0 && words[0] === PATH_OP.MOVE
}

/**
 * One `<path>` per leaf geometry, filled only where the leaf is a closed,
 * filled outline and stroked with the shape's stroke. Empty leaves are skipped.
 */
export function geometryToSvgPaths(geometry: Geometry2d, style: StyleWords): string {
  const fill = rgbaToHex(style.fill)
  const stroke = strokeAttrs(style)
  const out: string[] = []
  for (const leaf of geometryLeaves(geometry)) {
    const words = leaf.toPathWords()
    if (!hasPathWords(words)) continue
    const filled = fill !== undefined && leaf.isClosed && leaf.isFilled
    out.push(`<path ${attrs({ d: pathWordsToSvgD(words), fill: filled ? fill : "none", ...stroke })}/>`)
  }
  return out.join("")
}
