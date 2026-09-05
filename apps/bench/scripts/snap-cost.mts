/**
 * What `SnapManager` pays per candidate shape today.
 *
 * Snapping asks the editor for `getShapePageBounds(shape)` for every shape near
 * the viewport, and that rebuilds the shape's whole `Geometry2d` — the engine
 * already knows the same box. This measures the rebuild so the trade is a
 * number rather than an intuition.
 */
import { Box, GEO_SHAPE_KINDS, Vec } from "@mocanvas/editor"
import { getGeoGeometry } from "../../../packages/mocanvas/src/shapes/geo-helpers"

const N = Number(process.env["N"] ?? 20000)
const cases = Array.from({ length: N }, (_, i) => ({
  kind: GEO_SHAPE_KINDS[i % GEO_SHAPE_KINDS.length]!,
  w: 20 + (i % 137),
  h: 20 + (i % 91),
}))

function run(): number {
  const t0 = performance.now()
  let acc = 0
  for (const c of cases) {
    const b = getGeoGeometry(c.kind, c.w, c.h, false).bounds
    acc += Box.FromPoints(b.corners.map((p) => new Vec(p.x, p.y))).w
  }
  if (acc < 0) throw new Error("unreachable")
  return performance.now() - t0
}

const runs = Array.from({ length: 7 }, run).sort((a, b) => a - b)
const median = runs[3]!
console.log(
  `getShapePageBounds-equivalent for ${N} geo shapes: median ${median.toFixed(1)} ms ` +
    `(${((median * 1000) / N).toFixed(2)} us each)`,
)
