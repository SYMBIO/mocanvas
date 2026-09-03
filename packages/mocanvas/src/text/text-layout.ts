/** Pure text layout helpers shared by the label-bearing shapes. DOM-free so they are testable in Node. */

import type { DefaultFontStyle } from "@mocanvas/editor"
import { getFontFamily } from "../shapes/shape-theme"
import { LINE_HEIGHT } from "../shapes/text-helpers"
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
  font: DefaultFontStyle
  fontSize: number
  /** Wrap width in px including padding; omit for no soft wrapping. */
  maxWidth?: number
  padding?: number
}

/** Measure a shape label with the shared measurer using the default label typography. */
export function measureLabel(text: string, opts: LabelMeasureOptions): TextMeasurement {
  return getTextMeasure().measureText(text, {
    fontFamily: getFontFamily(opts.font),
    fontSize: opts.fontSize,
    lineHeight: LINE_HEIGHT,
    ...(opts.maxWidth === undefined ? {} : { maxWidth: opts.maxWidth }),
    padding: opts.padding ?? 0,
  })
}

/** Minimum width of an auto-sized text shape so an empty one still shows a caret area. */
export const TEXT_SHAPE_MIN_WIDTH = 8

export interface TextShapeSizeInput {
  text: string
  font: DefaultFontStyle
  fontSize: number
  autoSize: boolean
  /** Current wrap width, used when `autoSize` is off. */
  w: number
}

/** Width and height of a text shape: measured (auto-size) or wrapped at `w`. */
export function getTextShapeSize(input: TextShapeSizeInput): { w: number; h: number; lineCount: number } {
  const { text, font, fontSize, autoSize, w } = input
  if (autoSize) {
    const m = measureLabel(text, { font, fontSize })
    return { w: Math.max(TEXT_SHAPE_MIN_WIDTH, m.w), h: m.h, lineCount: m.lineCount }
  }
  const width = Math.max(1, w)
  const m = measureLabel(text, { font, fontSize, maxWidth: width })
  return { w: width, h: m.h, lineCount: m.lineCount }
}
