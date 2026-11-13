/** Cheap text metrics used until real measurement lands (phase 2 text layout). */

/**
 * The ratio a label's line box is derived from.
 *
 * Not the line box itself: a label's line box is `round(fontSize * LINE_HEIGHT)`
 * — see {@link getLineHeightPx} — so at the built-in sizes (18, 24, 36, 44) the
 * line is 24, 32, 49 and 59 page units rather than 24.3, 32.4, 48.6 and 59.4.
 *
 * This was `1.3`, unrounded, until 4.17.0, while the theme's own
 * `DEFAULT_LINE_HEIGHT` already said 1.35 — so a note's label and a text
 * shape's label were laid out on two different rules inside one library. The
 * reference rounds, and the oracle harness measures it doing so
 * (`pnpm --filter bench oracle --probes=text-shape-line-height`).
 */
export const LINE_HEIGHT = 1.35

/**
 * The line box for a label at `fontSize`, in page units.
 *
 * Rounded, which is what makes a three-line label land on a whole number of
 * units rather than drifting by 0.4 per line.
 */
export function getLineHeightPx(fontSize: number): number {
  return Math.round(fontSize * LINE_HEIGHT)
}

/**
 * The same line box as a unitless multiple of `fontSize`, for the places that
 * hand CSS or the measurer a `line-height` rather than a height.
 *
 * It therefore depends on the font size — `round(24 * 1.35) / 24` is 1.3333,
 * `round(18 * 1.35) / 18` is 1.3333 too but `round(36 * 1.35) / 36` is
 * 1.3611 — which is the point: the rounding has to happen before the division
 * or it is not the same line.
 */
export function getLineHeight(fontSize: number): number {
  return fontSize > 0 ? getLineHeightPx(fontSize) / fontSize : LINE_HEIGHT
}

/** Average glyph advance as a fraction of the font size. */
export const AVG_CHAR_WIDTH = 0.6

export interface TextSizeEstimate {
  w: number
  h: number
  lines: number
}

/**
 * Estimate the box a run of text occupies at `fontSize`, wrapping each
 * paragraph at `maxWidth` using an average character width.
 */
export function estimateTextSize(text: string, fontSize: number, maxWidth = Infinity): TextSizeEstimate {
  const charW = fontSize * AVG_CHAR_WIDTH
  const charsPerLine = Number.isFinite(maxWidth) && charW > 0 ? Math.max(1, Math.floor(maxWidth / charW)) : Infinity
  let lines = 0
  let widest = 0
  for (const paragraph of text.split("\n")) {
    const n = paragraph.length
    lines += Math.max(1, Math.ceil(n / charsPerLine))
    widest = Math.max(widest, Math.min(n, charsPerLine) * charW)
  }
  return { w: widest, h: lines * getLineHeightPx(fontSize), lines }
}
