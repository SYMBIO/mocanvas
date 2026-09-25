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

/**
 * How far to lift a label so it reads as centred, as a fraction of the font size.
 *
 * Centring the *line box* is geometrically right and optically wrong: a line box
 * reserves room for descenders whether or not the text has any, so the ink of a
 * typical word sits in its lower half and the word looks like it has sunk. What
 * the eye centres on is the letters themselves — somewhere between the middle of
 * the capitals and the middle of the x-height, depending on the word — so that is
 * what gets put on the centre line instead.
 *
 * Measured from the font rather than assumed: a face with a tall x-height needs a
 * different correction from one with a small one, and the value is only stable
 * per family, not across the stack. Cached per family, since it scales with the
 * em and so does not depend on the size.
 */
const OPTICAL_LIFT_CACHE = new Map<string, number>()

/** The lift in px for a label, given the same options `measureLabel` takes. */
export function getLabelOpticalLift(opts: Pick<LabelMeasureOptions, "font" | "fontFamily"> & { fontSize: number }): number {
  return getOpticalCentreLift(getFontFamily(labelFontStyle(opts))) * opts.fontSize
}

function getOpticalCentreLift(fontFamily: string): number {
  const cached = OPTICAL_LIFT_CACHE.get(fontFamily)
  if (cached !== undefined) return cached
  let lift = 0
  try {
    const ctx = document.createElement("canvas").getContext("2d")
    if (ctx) {
      const em = 100
      ctx.font = `${em}px ${fontFamily}`
      const caps = ctx.measureText("H")
      const ex = ctx.measureText("x")
      const capHeight = caps.actualBoundingBoxAscent
      const xHeight = ex.actualBoundingBoxAscent
      const ascent = caps.fontBoundingBoxAscent
      const descent = caps.fontBoundingBoxDescent
      if (capHeight > 0 && xHeight > 0 && ascent > 0) {
        const lineHeight = LINE_HEIGHT * em
        const baseline = (lineHeight - (ascent + descent)) / 2 + ascent
        // Halfway between the capitals' midpoint and the x-height's midpoint.
        const optical = baseline - (capHeight + xHeight) / 4
        lift = (optical - lineHeight / 2) / em
      }
    }
  } catch {
    // No canvas (SSR, a test environment): centring the line box is the fallback,
    // which is what every label did before this existed.
  }
  // A correction this large is a measurement gone wrong, not a font.
  if (!Number.isFinite(lift) || lift < 0 || lift > 0.25) lift = 0
  OPTICAL_LIFT_CACHE.set(fontFamily, lift)
  return lift
}

/**
 * Minimum width of an auto-sized text shape, so an empty one still shows a
 * caret area. tldraw's number for the same thing, and the default `props.w` a
 * text shape is created with — an auto-sized shape writes its measured width
 * back into `props.w`, so this is what an empty one ends up reading.
 */
export const TEXT_SHAPE_MIN_WIDTH = 20

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
