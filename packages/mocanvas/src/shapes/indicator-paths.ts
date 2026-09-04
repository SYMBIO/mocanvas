/**
 * Small builders for the canvas paths a shape util's `getIndicatorPath`
 * returns, so the built-in shapes all fail soft the same way.
 */
import type { VecLike } from "@mocanvas/editor"

/**
 * Whether canvas paths can be built at all.
 *
 * `Path2D` is a DOM class: it is absent in Node (unit tests, SSR, the headless
 * export path). A util calls this rather than letting a `ReferenceError` out of
 * a render pass.
 */
export function canBuildPath(): boolean {
  return typeof Path2D !== "undefined"
}

/**
 * A rectangle, optionally rounded.
 *
 * `roundRect` is a 2022-era addition; a square corner is a cosmetic regression
 * where a thrown exception would take the whole indicator layer with it, so a
 * missing `roundRect` falls back rather than failing.
 */
export function rectPath(w: number, h: number, radius = 0): Path2D {
  const path = new Path2D()
  if (radius > 0 && typeof path.roundRect === "function") {
    path.roundRect(0, 0, w, h, radius)
  } else {
    path.rect(0, 0, w, h)
  }
  return path
}

/** A rectangle at an offset, for a geometry whose bounds do not start at the origin. */
export function boxPath(box: { x: number; y: number; w: number; h: number }): Path2D {
  const path = new Path2D()
  path.rect(box.x, box.y, box.w, box.h)
  return path
}

/**
 * A path from SVG path data.
 *
 * The `Path2D(d)` constructor is the shortest route from the engine's path
 * encoding (which already serializes to a `d` string for export) to a canvas
 * path, and it is what the consumer's own utils use.
 */
export function svgPath(d: string): Path2D {
  return new Path2D(d)
}

/** An open or closed polyline through `points`. */
export function polylinePath(points: readonly VecLike[], close = false): Path2D {
  const path = new Path2D()
  const first = points[0]
  if (!first) return path
  path.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    path.lineTo(p.x, p.y)
  }
  if (close) path.closePath()
  return path
}
