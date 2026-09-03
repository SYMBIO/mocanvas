/**
 * Text labels as `<text>` elements. Layout mirrors the DOM label: paragraphs
 * split on newlines, soft-wrapped at an average glyph advance (the same
 * estimate the Node-side text measurer uses), one `<tspan>` per line.
 */
import type { DefaultHorizontalAlignStyle, DefaultVerticalAlignStyle } from "@mocanvas/editor"
import { AVG_CHAR_WIDTH, LINE_HEIGHT } from "../shapes/text-helpers"
import { attrs, escapeXml, svgNum } from "./svg-utils"

export interface SvgTextBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SvgTextOptions {
  fontFamily: string
  fontSize: number
  /** CSS colour for the glyphs. */
  color: string
  align: DefaultHorizontalAlignStyle | "start" | "middle" | "end"
  verticalAlign: DefaultVerticalAlignStyle
  /** Inset from the box edges on every side. */
  padding?: number
  /** Soft-wrap paragraphs at the box width (minus padding). */
  wrap?: boolean
  fontWeight?: string | number
}

/** Split `text` into rendered lines: hard breaks on `\n`, soft wraps at `maxWidth` when given. */
export function wrapTextLines(text: string, fontSize: number, maxWidth = Infinity): string[] {
  const charW = fontSize * AVG_CHAR_WIDTH
  const limit = Number.isFinite(maxWidth) && charW > 0 ? Math.max(1, Math.floor(maxWidth / charW)) : Infinity
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= limit) {
      lines.push(paragraph)
      continue
    }
    let current = ""
    for (const word of paragraph.split(" ")) {
      const candidate = current.length === 0 ? word : `${current} ${word}`
      if (candidate.length <= limit) {
        current = candidate
        continue
      }
      if (current.length > 0) lines.push(current)
      // A single word longer than the line breaks mid-word, like `overflow-wrap: break-word`.
      let rest = word
      while (rest.length > limit) {
        lines.push(rest.slice(0, limit))
        rest = rest.slice(limit)
      }
      current = rest
    }
    lines.push(current)
  }
  return lines
}

function anchorFor(align: SvgTextOptions["align"]): "start" | "middle" | "end" {
  switch (align) {
    case "start":
    case "start-legacy":
      return "start"
    case "end":
    case "end-legacy":
      return "end"
    default:
      return "middle"
  }
}

/**
 * Render `text` inside `box`. Returns an empty string for empty text. Lines
 * are positioned with `dominant-baseline="central"` so vertical centring does
 * not depend on font metrics.
 */
export function textToSvg(text: string, box: SvgTextBox, opts: SvgTextOptions): string {
  if (text.length === 0) return ""
  const padding = opts.padding ?? 0
  const innerX = box.x + padding
  const innerY = box.y + padding
  const innerW = Math.max(0, box.w - padding * 2)
  const innerH = Math.max(0, box.h - padding * 2)
  const lines = wrapTextLines(text, opts.fontSize, opts.wrap ? innerW : Infinity)
  const lineH = opts.fontSize * LINE_HEIGHT
  const blockH = lines.length * lineH

  const anchor = anchorFor(opts.align)
  const x = anchor === "start" ? innerX : anchor === "end" ? innerX + innerW : innerX + innerW / 2
  const top = opts.verticalAlign === "start" ? innerY : opts.verticalAlign === "end" ? innerY + innerH - blockH : innerY + (innerH - blockH) / 2

  const spans = lines
    .map((line, i) => {
      const y = top + lineH * i + lineH / 2
      // Preserve runs of spaces and keep empty lines from collapsing.
      const content = line.length === 0 ? "​" : escapeXml(line)
      return `<tspan x="${svgNum(x)}" y="${svgNum(y)}">${content}</tspan>`
    })
    .join("")

  const a = attrs({
    "font-family": opts.fontFamily,
    "font-size": opts.fontSize,
    "font-weight": opts.fontWeight === undefined ? undefined : String(opts.fontWeight),
    fill: opts.color,
    "text-anchor": anchor,
    "dominant-baseline": "central",
    "xml:space": "preserve",
  })
  return `<text ${a}>${spans}</text>`
}
