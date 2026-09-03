/** Cheap text metrics used until real measurement lands (phase 2 text layout). */

export const LINE_HEIGHT = 1.3
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
  return { w: widest, h: lines * fontSize * LINE_HEIGHT, lines }
}
