/**
 * Arrow terminal resolution.
 *
 * An arrow terminal is either static (`props.start` / `props.end`, in
 * arrow-local space) or bound to another shape through an `arrow` binding.
 * A bound terminal is derived from the bound shape every time it is read, so
 * the arrow follows the shape without anyone copying coordinates around.
 */
import {
  Box,
  Group2d,
  STROKE_SIZES,
  Vec,
  type DefaultSizeStyle,
  type Editor,
  type Geometry2d,
  type ShapeId,
  type UnknownShape,
  type VecLike,
} from "@mocanvas/editor"
import type { ArrowShape } from "../shapes/ArrowShapeUtil"
import { getArrowBody, getPointOnBody } from "../shapes/arrow-helpers"
import type { ArrowBinding, ArrowTerminal } from "./ArrowBindingUtil"

/** Affine transform components as returned by `Editor.getShapePageTransform`. */
export interface TransformLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export function applyTransform(m: TransformLike, p: VecLike): Vec {
  return new Vec(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f)
}

export interface ArrowBindings {
  start?: ArrowBinding
  end?: ArrowBinding
}

/** The arrow's terminal bindings, keyed by terminal. */
export function getArrowBindings(editor: Editor, arrow: ArrowShape): ArrowBindings {
  const out: ArrowBindings = {}
  for (const binding of editor.getBindingsFromShape<ArrowBinding>(arrow, "arrow")) {
    out[binding.props.terminal] = binding
  }
  return out
}

/** Map a normalized anchor `(0..1, 0..1)` into a shape's geometry bounds (shape-local space). */
export function getAnchorInShapeSpace(editor: Editor, shape: UnknownShape, normalizedAnchor: VecLike): Vec {
  const b = editor.getShapeGeometry(shape).bounds
  return new Vec(b.x + b.w * normalizedAnchor.x, b.y + b.h * normalizedAnchor.y)
}

/**
 * The topmost shape an arrow terminal dropped at `pagePoint` should bind to,
 * or `undefined`. Candidates must accept arrow bindings, may not be arrows,
 * the arrow itself, or one of the arrow's ancestors, and are hit inside their
 * outline (or within the hit-test margin of it) regardless of fill, so an arrow
 * can attach to a hollow rectangle by pointing into it.
 */
export function getArrowBindingTargetAtPoint(editor: Editor, arrow: UnknownShape, pagePoint: VecLike): UnknownShape | undefined {
  const margin = editor.options.hitTestMargin / editor.getZoomLevel()
  const ancestors = new Set<ShapeId>()
  for (let p = editor.getShapeParent(arrow); p; p = editor.getShapeParent(p)) ancestors.add(p.id)
  const shapes = editor.getCurrentPageShapesSorted()
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!
    if (shape.id === arrow.id || shape.type === "arrow" || shape.isLocked || ancestors.has(shape.id)) continue
    if (!editor.getShapeUtil(shape).canBind({ fromShapeType: "arrow", toShapeType: shape.type, bindingType: "arrow" })) continue
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds || !Box.ContainsPoint(bounds, pagePoint, margin)) continue
    const local = editor.getPointInShapeSpace(shape, pagePoint)
    if (editor.getShapeGeometry(shape).hitTestPoint(local, margin, true)) return shape
  }
  return undefined
}

/** Normalize a page point into a shape's geometry bounds, clamped to `[0, 1]`. */
export function getNormalizedAnchor(editor: Editor, shape: UnknownShape, pagePoint: VecLike): Vec {
  const local = editor.getPointInShapeSpace(shape, pagePoint)
  const b = editor.getShapeGeometry(shape).bounds
  const clamp = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)
  return new Vec(clamp(b.w === 0 ? 0.5 : (local.x - b.x) / b.w), clamp(b.h === 0 ? 0.5 : (local.y - b.y) / b.h))
}

/**
 * Flattened outline of a geometry as line segments, in the geometry's own
 * space. Groups are walked recursively; label geometry is skipped so arrows
 * end on the shape body rather than on its text box.
 */
export function getOutlineSegments(geometry: Geometry2d): [Vec, Vec][] {
  if (geometry.isLabel) return []
  if (geometry instanceof Group2d) return geometry.children.flatMap(getOutlineSegments)
  const v = geometry.vertices
  const out: [Vec, Vec][] = []
  if (v.length < 2) return out
  const n = geometry.isClosed ? v.length : v.length - 1
  for (let i = 0; i < n; i++) out.push([v[i]!, v[(i + 1) % v.length]!])
  return out
}

/**
 * Intersection point of segments `a1-a2` and `b1-b2`, or `null` when they do
 * not cross. Parallel and degenerate segments never intersect.
 */
export function intersectSegments(a1: VecLike, a2: VecLike, b1: VecLike, b2: VecLike): Vec | null {
  const rx = a2.x - a1.x
  const ry = a2.y - a1.y
  const sx = b2.x - b1.x
  const sy = b2.y - b1.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null
  const qx = b1.x - a1.x
  const qy = b1.y - a1.y
  const t = (qx * sy - qy * sx) / denom
  const u = (qx * ry - qy * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return new Vec(a1.x + rx * t, a1.y + ry * t)
}

/**
 * Walk a polyline from its first point and return the first place it crosses
 * any of `segments`, or `null`.
 */
function firstCrossing(path: Vec[], segments: [Vec, Vec][]): Vec | null {
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[i]!
    const p1 = path[i + 1]!
    let best: Vec | null = null
    let bestD = Infinity
    for (const [s0, s1] of segments) {
      const hit = intersectSegments(p0, p1, s0, s1)
      if (!hit) continue
      const d = Vec.Dist2(p0, hit)
      if (d < bestD) {
        bestD = d
        best = hit
      }
    }
    if (best) return best
  }
  return null
}

/** Sample the arrow body from `from` to `to` (bowed by `bend`) as a polyline starting at `from`. */
function sampleBody(from: Vec, to: Vec, bend: number, reverse: boolean): Vec[] {
  // The body is always described start → end so the bend sign keeps its meaning.
  const body = reverse ? getArrowBody(to, from, bend) : getArrowBody(from, to, bend)
  if (body.kind === "straight") return [from, to]
  const count = Math.max(8, Math.min(128, Math.ceil((Math.abs(body.sweep) * body.radius) / 4)))
  const pts: Vec[] = []
  for (let i = 0; i <= count; i++) {
    const t = reverse ? 1 - i / count : i / count
    pts.push(getPointOnBody(body, t))
  }
  return pts
}

export interface ArrowTerminals {
  start: Vec
  end: Vec
}

/**
 * How far a bound arrow stops short of the shape it points at, as a multiple
 * of its stroke width. An arrowhead resting on a shape's border reads as part
 * of that border; a small gap reads as pointing at it.
 */
export const ARROW_TERMINAL_GAP_STROKES = 2.7

/** The gap in page units for an arrow of a given size style. */
export function getArrowTerminalGap(size: DefaultSizeStyle, scale = 1): number {
  return STROKE_SIZES[size] * scale * ARROW_TERMINAL_GAP_STROKES
}

/** Move `point` back along the line toward `from` by `distance`, never past `from`. */
function pullBack(point: Vec, from: Vec, distance: number): Vec {
  const d = Vec.Dist(point, from)
  if (d <= 1e-6) return point
  return Vec.Lrp(point, from, Math.min(distance, d) / d)
}

/**
 * Resolve both terminals of an arrow in arrow-local space.
 *
 * Unbound terminals come straight from `props`. A bound terminal starts at
 * its anchor inside the bound shape's bounds; unless the binding is exact it
 * is then pulled back to where the arrow body first crosses the bound shape's
 * outline on its way from the opposite terminal. If the body never crosses
 * the outline (e.g. the other terminal is inside the shape) the anchor is used.
 */
export function getArrowTerminalsInArrowSpace(editor: Editor, arrow: ArrowShape): ArrowTerminals {
  const bindings = getArrowBindings(editor, arrow)
  const startShape = bindings.start ? editor.getShape(bindings.start.toId) : undefined
  const endShape = bindings.end ? editor.getShape(bindings.end.toId) : undefined

  const anchorFor = (terminal: ArrowTerminal, binding: ArrowBinding | undefined, shape: UnknownShape | undefined): Vec => {
    if (!binding || !shape) return Vec.From(arrow.props[terminal])
    const local = getAnchorInShapeSpace(editor, shape, binding.props.normalizedAnchor)
    const page = applyTransform(editor.getShapePageTransform(shape), local)
    return editor.getPointInShapeSpace(arrow, page)
  }

  const startAnchor = anchorFor("start", bindings.start, startShape)
  const endAnchor = anchorFor("end", bindings.end, endShape)

  const outlineInArrowSpace = (shape: UnknownShape): [Vec, Vec][] => {
    const m = editor.getShapePageTransform(shape)
    const toArrow = (p: Vec): Vec => editor.getPointInShapeSpace(arrow, applyTransform(m, p))
    return getOutlineSegments(editor.getShapeGeometry(shape)).map(([a, b]) => [toArrow(a), toArrow(b)])
  }

  const snap = (terminal: ArrowTerminal, binding: ArrowBinding | undefined, shape: UnknownShape | undefined, anchor: Vec, other: Vec): Vec => {
    if (!binding || !shape || binding.props.isExact) return anchor
    if (Vec.Dist2(anchor, other) < 1e-12) return anchor
    const path = sampleBody(other, anchor, arrow.props.bend, terminal === "start")
    const crossing = firstCrossing(path, outlineInArrowSpace(shape))
    if (!crossing) return anchor
    // Stop short of the outline rather than on it. `isExact` opts out above,
    // which is what an exact binding means.
    return pullBack(crossing, other, getArrowTerminalGap(arrow.props.size, arrow.props.scale))
  }

  return {
    start: snap("start", bindings.start, startShape, startAnchor, endAnchor),
    end: snap("end", bindings.end, endShape, endAnchor, startAnchor),
  }
}
