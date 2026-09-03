import type { VecLike } from "@mocanvas/editor"

/**
 * One pass of a light 1-2-1 moving average over a freehand stroke. Endpoints
 * are kept fixed so the stroke still starts and ends where the pen did.
 * Extra properties on each point (e.g. pressure `z`) are preserved.
 */
export function smoothPoints<P extends VecLike>(points: readonly P[]): P[] {
  const n = points.length
  if (n < 4) return points.slice()
  const out: P[] = [points[0]!]
  for (let i = 1; i < n - 1; i++) {
    const prev = points[i - 1]!
    const p = points[i]!
    const next = points[i + 1]!
    out.push({ ...p, x: (prev.x + 2 * p.x + next.x) / 4, y: (prev.y + 2 * p.y + next.y) / 4 })
  }
  out.push(points[n - 1]!)
  return out
}
