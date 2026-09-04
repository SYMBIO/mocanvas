/** Pure text layout helpers shared by the label-bearing shapes. DOM-free so they are testable in Node. */

import type { DefaultFontStyle, Editor } from "@mocanvas/editor"
import { getFontFamily } from "../shapes/shape-theme"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import { renderHtmlFromRichTextForMeasurement } from "./measure-html"
import { isRichText, richTextToText, type RichTextSource } from "./rich-text"
import { getTextMeasure, type TextMeasurement } from "./TextMeasure"

/**
 * Extra height a box needs so its label fits: `labelHeight - boxHeight`,
 * never negative. `growY` is stored on the shape and added to `h`.
 */
export function computeGrowY(labelHeight: number, boxHeight: number): number {
  if (!Number.isFinite(labelHeight) || !Number.isFinite(boxHeight)) return 0
  return Math.max(0, labelHeight - boxHeight)
}

/** Trim whitespace at the end of a label (kept inside the run, e.g. indentation on later lines). */
export function trimTrailingWhitespace(text: string): string {
  return text.replace(/\s+$/u, "")
}

export interface LabelMeasureOptions {
  /**
   * The label's font style token. Named `font` before v5; `font` is still
   * accepted and means the same thing.
   */
  fontFamily?: DefaultFontStyle
  /** @deprecated v5 renamed this to `fontFamily`. */
  font?: DefaultFontStyle
  fontSize: number
  /** Wrap width in px including padding; omit for no soft wrapping. */
  maxWidth?: number
  padding?: number
  /**
   * The editor the label belongs to, used to pick up its configured rich-text
   * extensions. Optional: without one the default extension set is used.
   */
  editor?: Editor | null
}

/** The label's font style token, from either spelling, defaulting to `draw`. */
export function labelFontStyle(opts: Pick<LabelMeasureOptions, "font" | "fontFamily">): DefaultFontStyle {
  return opts.fontFamily ?? opts.font ?? "draw"
}

/**
 * Measure a shape label with the shared measurer using the default label
 * typography.
 *
 * Takes either spelling of a label: a plain string, or the rich-text document
 * the store may hold in `props.richText`. Rich text goes through the HTML path
 * so its marks (a bold run is wider than the plain one) are part of the
 * measurement; plain text goes through the cheaper text path. Both use the same
 * measurer, probe element and cache.
 */
export function measureLabel(source: RichTextSource, opts: LabelMeasureOptions): TextMeasurement {
  const fontFamily = getFontFamily(labelFontStyle(opts))
  if (isRichText(source)) {
    const html = renderHtmlFromRichTextForMeasurement(opts.editor ?? null, source)
    return getTextMeasure().measureHtml(html, {
      fontFamily,
      fontSize: opts.fontSize,
      lineHeight: LINE_HEIGHT,
      ...(opts.maxWidth === undefined ? {} : { maxWidth: opts.maxWidth }),
      padding: opts.padding ?? 0,
    })
  }
  return getTextMeasure().measureText(richTextToText(source), {
    fontFamily,
    fontSize: opts.fontSize,
    lineHeight: LINE_HEIGHT,
    ...(opts.maxWidth === undefined ? {} : { maxWidth: opts.maxWidth }),
    padding: opts.padding ?? 0,
  })
}

/** Minimum width of an auto-sized text shape so an empty one still shows a caret area. */
export const TEXT_SHAPE_MIN_WIDTH = 8

export interface TextShapeSizeInput {
  /** The label, in either spelling: a plain string or a rich-text document. */
  text: RichTextSource
  /** @deprecated v5 renamed this to `fontFamily`. */
  font?: DefaultFontStyle
  fontFamily?: DefaultFontStyle
  fontSize: number
  autoSize: boolean
  /** Current wrap width, used when `autoSize` is off. */
  w: number
  /** The editor whose rich-text extensions apply, when there is one. */
  editor?: Editor | null
}

/** Width and height of a text shape: measured (auto-size) or wrapped at `w`. */
export function getTextShapeSize(input: TextShapeSizeInput): { w: number; h: number; lineCount: number } {
  const { text, fontSize, autoSize, w, editor } = input
  const fontFamily = labelFontStyle(input)
  if (autoSize) {
    const m = measureLabel(text, { fontFamily, fontSize, editor: editor ?? null })
    return { w: Math.max(TEXT_SHAPE_MIN_WIDTH, m.w), h: m.h, lineCount: m.lineCount }
  }
  const width = Math.max(1, w)
  const m = measureLabel(text, { fontFamily, fontSize, maxWidth: width, editor: editor ?? null })
  return { w: width, h: m.h, lineCount: m.lineCount }
}
