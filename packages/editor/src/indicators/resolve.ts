/**
 * Turning a shape util into the paths its indicator is made of.
 *
 * Split out of the compositor so both indicator layers agree on one rule: the
 * canvas overlay draws a util's `getIndicatorPath`, the (deprecated) SVG layer
 * draws a util's `indicator`, and exactly one of them claims each shape.
 */
import { PATH_OP } from "@mocanvas/wasm"
import type { TLIndicatorPath, TLIndicatorPathResult } from "./types"

/**
 * Path words — the flat `op, args…` encoding the engine speaks — as a `Path2D`.
 *
 * Used for the outline the hand-drawn style actually strokes, which comes back
 * from the renderer in this form and has no `Geometry2d` behind it to ask.
 */
export function sketchIndicatorPath(words: readonly number[]): Path2D {
  const p = new Path2D()
  let i = 0
  while (i < words.length) {
    switch (words[i]) {
      case PATH_OP.MOVE:
        p.moveTo(words[i + 1]!, words[i + 2]!)
        i += 3
        break
      case PATH_OP.LINE:
        p.lineTo(words[i + 1]!, words[i + 2]!)
        i += 3
        break
      case PATH_OP.QUAD:
        p.quadraticCurveTo(words[i + 1]!, words[i + 2]!, words[i + 3]!, words[i + 4]!)
        i += 5
        break
      case PATH_OP.CUBIC:
        p.bezierCurveTo(words[i + 1]!, words[i + 2]!, words[i + 3]!, words[i + 4]!, words[i + 5]!, words[i + 6]!)
        i += 7
        break
      case PATH_OP.CLOSE:
        p.closePath()
        i += 1
        break
      default:
        // An opcode this build does not know: stop rather than walk off into
        // the arguments and draw nonsense.
        return p
    }
  }
  return p
}

/** The two members of a shape util this module cares about. */
export interface IndicatorPathSource<T = never> {
  /** The v5 hook: a canvas path in shape-local coordinates. */
  getIndicatorPath?(shape: T): TLIndicatorPathResult
  /** The v4 hook, kept working for utils that have not been ported. */
  indicator?(shape: T): unknown
}

/**
 * Which layer owns a util's indicator.
 *
 * `"react"` only when the util implements the deprecated `indicator()` and
 * *not* `getIndicatorPath` — so a util that implements both is drawn once, on
 * the canvas, and a util that implements neither gets the canvas layer's
 * geometry-bounds fallback.
 */
export type IndicatorSource = "path" | "react"

/** @see IndicatorSource */
export function getIndicatorSource<T>(util: IndicatorPathSource<T>): IndicatorSource {
  if (typeof util.getIndicatorPath === "function") return "path"
  if (typeof util.indicator === "function") return "react"
  return "path"
}

/** Whether `Path2D` exists in this realm (it does not in Node, or during SSR). */
export function canBuildIndicatorPaths(): boolean {
  return typeof Path2D !== "undefined"
}

/**
 * Normalize what a util returned into the composed form.
 *
 * A bare `Path2D` is the common case and is told from a {@link TLIndicatorPath}
 * by the presence of a `path` member rather than by `instanceof`, because a
 * `Path2D` handed across realms (an iframe, a test double) fails `instanceof`
 * against this realm's constructor.
 */
export function normalizeIndicatorPath(result: TLIndicatorPathResult): TLIndicatorPath | undefined {
  if (result === undefined || result === null) return undefined
  if (typeof result === "object" && "path" in result) {
    const composed = result as TLIndicatorPath
    return composed.path ? composed : undefined
  }
  return { path: result as Path2D }
}

/** A rectangle, as the indicator of last resort. Returns `undefined` with no `Path2D`. */
export function boundsIndicatorPath(bounds: { x: number; y: number; w: number; h: number } | undefined): TLIndicatorPath | undefined {
  if (!bounds || !canBuildIndicatorPaths()) return undefined
  const path = new Path2D()
  path.rect(bounds.x, bounds.y, bounds.w, bounds.h)
  return { path }
}

/**
 * The paths to stroke for one shape, or `undefined` for "this layer draws
 * nothing here".
 *
 * `undefined` covers three different situations on purpose — the util said
 * nothing, the util is still on the deprecated React hook, or the shape has no
 * geometry — because the caller treats all three the same way: skip it.
 */
export function getShapeIndicatorPath<T>(
  util: IndicatorPathSource<T>,
  shape: T,
  bounds: { x: number; y: number; w: number; h: number } | undefined,
): TLIndicatorPath | undefined {
  if (getIndicatorSource(util) === "react") return undefined
  if (typeof util.getIndicatorPath !== "function") return boundsIndicatorPath(bounds)
  const own = normalizeIndicatorPath(util.getIndicatorPath(shape))
  // A util that implements the hook has spoken, even when it answers "nothing":
  // returning an empty path is how a shape opts out of an outline entirely.
  return own
}
