/**
 * Text labels as `<text>` elements. Layout mirrors the DOM label: paragraphs
 * split on newlines, soft-wrapped at an average glyph advance (the same
 * estimate the Node-side text measurer uses), one `<tspan>` per line.
 */
import type { DefaultHorizontalAlignStyle, DefaultVerticalAlignStyle } from "@mocanvas/editor"
import { AVG_CHAR_WIDTH, LINE_HEIGHT } from "../shapes/text-helpers"
import { isRichText, richTextToBlocks, richTextToText, safeHref, type RichTextRun, type RichTextSource } from "../text/rich-text"
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
  /** Horizontal alignment. Named `align` before v5; `align` is still accepted. */
  textAlign?: DefaultHorizontalAlignStyle | "start" | "middle" | "end"
  /** @deprecated v5 renamed this to `textAlign`. */
  align?: DefaultHorizontalAlignStyle | "start" | "middle" | "end"
  verticalAlign: DefaultVerticalAlignStyle
  /** Inset from the box edges on every side. */
  padding?: number
  /** Soft-wrap paragraphs at the box width (minus padding). */
  wrap?: boolean
  fontWeight?: string | number
}

/** The horizontal alignment of a text options bag, from either spelling. */
function alignOf(opts: SvgTextOptions): DefaultHorizontalAlignStyle | "start" | "middle" | "end" {
  return opts.textAlign ?? opts.align ?? "middle"
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

function anchorFor(align: NonNullable<SvgTextOptions["align"]>): "start" | "middle" | "end" {
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
 * Split a rich-text document into the rendered lines, each a list of styled
 * runs.
 *
 * Wrapping is by the same average-glyph-advance estimate {@link wrapTextLines}
 * uses, over the concatenated text of the line, so a document and the plain
 * string it flattens to break in the same places. That keeps a rich-text export
 * and a plain-text export of the same label the same height.
 */
export function wrapRichTextLines(source: RichTextSource, fontSize: number, maxWidth = Infinity): RichTextRun[][] {
  const charW = fontSize * AVG_CHAR_WIDTH
  const limit = Number.isFinite(maxWidth) && charW > 0 ? Math.max(1, Math.floor(maxWidth / charW)) : Infinity
  const lines: RichTextRun[][] = []

  for (const block of richTextToBlocks(source)) {
    let line: RichTextRun[] = []
    let length = 0
    const push = (): void => {
      // A line never keeps the space it broke at, exactly as `wrapTextLines`
      // (which joins words) never produces one.
      while (line.length > 0 && /^\s+$/u.test(line[line.length - 1]!.text)) line.pop()
      lines.push(mergeSvgRuns(line))
      line = []
      length = 0
    }
    for (const run of block.runs) {
      for (const token of run.text.split(/(\s+)/u).filter((t) => t.length > 0)) {
        const isSpace = /^\s+$/u.test(token)
        if (!isSpace && length > 0 && length + token.length > limit) push()
        if (isSpace && length === 0) continue
        if (!isSpace && token.length > limit) {
          // A single word longer than the line breaks mid-word, like `overflow-wrap: break-word`.
          let rest = token
          while (rest.length > limit) {
            if (length > 0) push()
            line.push({ ...run, text: rest.slice(0, limit) })
            length = limit
            rest = rest.slice(limit)
            push()
          }
          if (rest.length > 0) {
            line.push({ ...run, text: rest })
            length += rest.length
          }
          continue
        }
        line.push({ ...run, text: token })
        length += token.length
      }
    }
    push()
  }
  return lines
}

/** Collapse neighbouring runs that share a style, so one word is one `<tspan>`. */
function mergeSvgRuns(runs: readonly RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []
  for (const run of runs) {
    const last = out[out.length - 1]
    if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline && last.strike === run.strike && last.code === run.code && last.href === run.href) last.text += run.text
    else out.push({ ...run })
  }
  return out
}

/** The `<tspan>` attributes a run's marks translate to. */
function runAttrs(run: RichTextRun, opts: SvgTextOptions): Record<string, string | number | undefined> {
  const decorations: string[] = []
  if (run.underline) decorations.push("underline")
  if (run.strike) decorations.push("line-through")
  return {
    "font-weight": run.bold ? "bold" : opts.fontWeight === undefined ? undefined : String(opts.fontWeight),
    "font-style": run.italic ? "italic" : undefined,
    "text-decoration": decorations.length === 0 ? undefined : decorations.join(" "),
  }
}

/**
 * Render `source` inside `box`. Returns an empty string for an empty label.
 * Lines are positioned with `dominant-baseline="central"` so vertical centring
 * does not depend on font metrics.
 *
 * Accepts either spelling of a label: a plain string, or the rich-text document
 * the store may hold in `props.richText`. A document is exported run by run —
 * bold, italic, underlined and struck-through spans and links survive into the
 * SVG — while a plain string takes the single-`<tspan>`-per-line path it always
 * did.
 */
export function textToSvg(source: RichTextSource, box: SvgTextBox, opts: SvgTextOptions): string {
  const rich = isRichText(source)
  const plain = richTextToText(source)
  if (plain.length === 0) return ""
  const padding = opts.padding ?? 0
  const innerX = box.x + padding
  const innerY = box.y + padding
  const innerW = Math.max(0, box.w - padding * 2)
  const innerH = Math.max(0, box.h - padding * 2)
  const wrapWidth = opts.wrap ? innerW : Infinity
  const lineCount = rich ? wrapRichTextLines(source, opts.fontSize, wrapWidth).length : wrapTextLines(plain, opts.fontSize, wrapWidth).length
  const lineH = opts.fontSize * LINE_HEIGHT
  const blockH = lineCount * lineH

  const anchor = anchorFor(alignOf(opts))
  const x = anchor === "start" ? innerX : anchor === "end" ? innerX + innerW : innerX + innerW / 2
  const top = opts.verticalAlign === "start" ? innerY : opts.verticalAlign === "end" ? innerY + innerH - blockH : innerY + (innerH - blockH) / 2
  const lineY = (i: number): number => top + lineH * i + lineH / 2

  const spans = rich
    ? wrapRichTextLines(source, opts.fontSize, wrapWidth)
        .map((runs, i) => {
          // Preserve runs of spaces and keep empty lines from collapsing.
          const content =
            runs.length === 0
              ? "​"
              : runs
                  .map((run) => {
                    const a = attrs(runAttrs(run, opts))
                    const inner = `<tspan${a.length === 0 ? "" : ` ${a}`}>${escapeXml(run.text)}</tspan>`
                    const href = safeHref(run.href)
                    return href === null ? inner : `<a ${attrs({ href })}>${inner}</a>`
                  })
                  .join("")
          return `<tspan x="${svgNum(x)}" y="${svgNum(lineY(i))}">${content}</tspan>`
        })
        .join("")
    : wrapTextLines(plain, opts.fontSize, wrapWidth)
        .map((line, i) => `<tspan x="${svgNum(x)}" y="${svgNum(lineY(i))}">${line.length === 0 ? "​" : escapeXml(line)}</tspan>`)
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
