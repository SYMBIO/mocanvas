/**
 * Grapheme cluster iteration.
 *
 * "One character" as a person sees it is a grapheme cluster, not a UTF-16 code
 * unit and not a code point: `👩‍👩‍👧` is one, `é` written as `e` + a combining
 * accent is one, and a flag emoji is one. Anything that measures, truncates or
 * steps through text a character at a time has to walk clusters or it will cut a
 * family emoji in half.
 */

/** Lazily created, because constructing a `Segmenter` is not free. */
let segmenter: Intl.Segmenter | undefined
let segmenterChecked = false

function getSegmenter(): Intl.Segmenter | undefined {
  if (!segmenterChecked) {
    segmenterChecked = true
    try {
      // `Intl.Segmenter` is missing on older Safari and on some minimal Node builds.
      if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
      }
    } catch {
      segmenter = undefined
    }
  }
  return segmenter
}

/**
 * Iterate the grapheme clusters of `str`.
 *
 * Uses `Intl.Segmenter` where it exists and falls back to code-point iteration
 * otherwise — which keeps surrogate pairs intact (so a plain emoji survives) but
 * cannot join a ZWJ sequence or a combining mark to its base.
 *
 * ```ts
 * [...iterateGraphemes("a👍🏽b")] // ["a", "👍🏽", "b"]
 * ```
 */
export function* iterateGraphemes(str: string): Generator<string, void, undefined> {
  const seg = getSegmenter()
  if (seg) {
    for (const { segment } of seg.segment(str)) yield segment
    return
  }
  // SEMANTICS-ASSUMED: the fallback splits on code points. It is the closest
  // approximation available without shipping a Unicode break table, and it is
  // never worse than the `for (const c of str)` a caller would otherwise write.
  for (const codePoint of str) yield codePoint
}

/** The grapheme clusters of `str`, as an array. */
export function getGraphemes(str: string): string[] {
  return [...iterateGraphemes(str)]
}

/** How many grapheme clusters `str` has — its length as a reader would count it. */
export function getGraphemeLength(str: string): number {
  let n = 0
  for (const _ of iterateGraphemes(str)) n++
  return n
}
