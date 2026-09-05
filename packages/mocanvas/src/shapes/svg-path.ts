import { Mat, PATH_OP, type MatLike } from "@mocanvas/editor"

/** How many x/y pairs follow each op word; the one table the path walk needs. */
const PATH_OP_PAIRS: Readonly<Record<number, number>> = {
  [PATH_OP.MOVE]: 1,
  [PATH_OP.LINE]: 1,
  [PATH_OP.QUAD]: 2,
  [PATH_OP.CUBIC]: 3,
  [PATH_OP.CLOSE]: 0,
}

function num(v: number | undefined): string {
  const n = v ?? 0
  return String(Math.round(n * 100) / 100)
}

/** Convert the engine's flat path encoding to an SVG `d` attribute (for indicators). */
export function pathWordsToSvgD(words: readonly number[]): string {
  const parts: string[] = []
  let i = 0
  while (i < words.length) {
    const op = words[i]
    switch (op) {
      case PATH_OP.MOVE:
        parts.push(`M${num(words[i + 1])} ${num(words[i + 2])}`)
        i += 3
        break
      case PATH_OP.LINE:
        parts.push(`L${num(words[i + 1])} ${num(words[i + 2])}`)
        i += 3
        break
      case PATH_OP.QUAD:
        parts.push(`Q${num(words[i + 1])} ${num(words[i + 2])} ${num(words[i + 3])} ${num(words[i + 4])}`)
        i += 5
        break
      case PATH_OP.CUBIC:
        parts.push(
          `C${num(words[i + 1])} ${num(words[i + 2])} ${num(words[i + 3])} ${num(words[i + 4])} ${num(words[i + 5])} ${num(words[i + 6])}`,
        )
        i += 7
        break
      case PATH_OP.CLOSE:
        parts.push("Z")
        i += 1
        break
      default:
        // Malformed stream: stop rather than emit garbage.
        return parts.join(" ")
    }
  }
  return parts.join(" ")
}

/**
 * A copy of a flat path with `mat` applied to every point.
 *
 * mocanvas has no `PathBuilder`: a shape's outline is a `Geometry2d`,
 * and the *encoded* form every consumer of an outline shares is the engine's
 * flat word stream (`geometry.toPathWords()`), which is what
 * {@link pathWordsToSvgD} serializes and what the indicator layer strokes. So
 * this is where a path transform belongs — one function, applied to the one
 * encoding, rather than a second path abstraction that would have to be kept
 * in step with the first.
 *
 * ```ts
 * const flipped = transformPathWords(geometry.toPathWords(), Mat.Identity().translate(w, 0).scale(-1, 1))
 * const d = pathWordsToSvgD(flipped)
 * ```
 *
 * The input is never mutated. Control points transform with their anchors, so
 * a curve stays a curve (an affine map takes a cubic bézier to a cubic
 * bézier); a malformed stream is truncated at the bad word, exactly as
 * {@link pathWordsToSvgD} truncates it.
 */
export function transformPathWords(words: readonly number[], mat: MatLike): number[] {
  const m = mat instanceof Mat ? mat : Mat.From(mat)
  const out: number[] = []
  let i = 0
  while (i < words.length) {
    const op = words[i]!
    const pairs = PATH_OP_PAIRS[op]
    if (pairs === undefined || i + 1 + pairs * 2 > words.length) return out
    out.push(op)
    for (let pair = 0; pair < pairs; pair++) {
      const p = m.applyToPoint({ x: words[i + 1 + pair * 2]!, y: words[i + 2 + pair * 2]! })
      out.push(p.x, p.y)
    }
    i += 1 + pairs * 2
  }
  return out
}
