/**
 * What a shape's ancestors hide, and what is left of it.
 *
 * `Editor.getShapeMask` answers the geometric half — the page-space polygon a
 * shape is confined to. This module is everything built on top of that answer:
 * the bounds that survive the clip, the CSS the DOM layer needs to actually cut
 * the pixels off, and the point tests that have to agree with both.
 *
 * Keeping them together matters because they must not disagree. A frame that
 * clips visually but not for hit testing gives you a shape you can click but
 * cannot see.
 */
import { Box, Vec, type BoxLike, type VecLike } from "../geometry"
import type { ShapeId, UnknownShape } from "../records/base"
import type { Editor } from "./Editor"
import { resolveShape, type ShapeRef } from "./ancestry"

/**
 * The part of a shape's page bounds that its clipping ancestors leave visible.
 *
 * `undefined` when the shape does not exist **or** when it is clipped away
 * entirely — both mean "nothing to draw here", which is what every caller of
 * this does with the answer. An unclipped shape gets its ordinary page bounds
 * back, so this is the safe default for culling, framing and export.
 */
export function getShapeMaskedPageBounds(editor: Editor, shape: ShapeRef): Box | undefined {
  const record = resolveShape(editor, shape)
  if (!record) return undefined
  const bounds = editor.getShapePageBounds(record)
  if (!bounds) return undefined

  const mask = editor.getShapeMask(record)
  if (mask === undefined) return bounds
  if (mask.length === 0) return undefined

  const maskBounds = Box.FromPoints(mask.map((p) => new Vec(p.x, p.y)))
  if (!bounds.collides(maskBounds)) return undefined
  return Box.FromMinMax(
    Math.max(bounds.minX, maskBounds.minX),
    Math.max(bounds.minY, maskBounds.minY),
    Math.min(bounds.maxX, maskBounds.maxX),
    Math.min(bounds.maxY, maskBounds.maxY),
  )
}

/**
 * The CSS `clip-path` that cuts a shape down to what its ancestors allow, or
 * `undefined` when nothing clips it.
 *
 * The polygon is expressed in the shape's OWN coordinate space and in pixels,
 * because that is the space the element carrying the `clip-path` is laid out
 * in — a page-space path would be wrong the moment the shape is moved or
 * rotated.
 *
 * SEMANTICS-ASSUMED: `polygon()` with `px` units. The docs pin the return type
 * (a string usable as `clip-path`) but not the notation; `polygon()` is the
 * only notation that can express an arbitrary intersection of ancestor
 * rectangles, and pixels avoid a percentage's dependence on the element's own
 * measured size, which is not known here.
 *
 * A shape clipped away entirely comes back as `polygon(0px 0px)` — a degenerate
 * path that hides the element — rather than `undefined`, which would show it.
 */
export function getShapeClipPath(editor: Editor, shape: ShapeRef): string | undefined {
  const record = resolveShape(editor, shape)
  if (!record) return undefined
  const mask = editor.getShapeMask(record)
  if (mask === undefined) return undefined
  if (mask.length === 0) return "polygon(0px 0px)"

  const local = mask.map((p) => editor.getPointInShapeSpace(record, p))
  return `polygon(${local.map((p) => `${round(p.x)}px ${round(p.y)}px`).join(", ")})`
}

/**
 * The common page bounds of several shapes, clipping included, or `null` when
 * none of them is visible.
 *
 * Masked rather than raw bounds on purpose: this is what "zoom to these
 * shapes" and "export these shapes" both want, and framing the invisible part
 * of a shape scrolled out of its frame is never the intent.
 */
export function getShapesPageBounds(editor: Editor, ids: readonly (ShapeId | UnknownShape)[]): Box | null {
  const boxes: Box[] = []
  for (const id of ids) {
    const bounds = getShapeMaskedPageBounds(editor, id)
    if (bounds) boxes.push(bounds)
  }
  return boxes.length === 0 ? null : Box.Common(boxes)
}

/**
 * The ids of every shape completely inside a page-space box.
 *
 * Ids rather than records because this is the marquee-selection primitive, and
 * selection is stored as ids; asking for the records back is one `map` away.
 */
export function getShapeIdsInsideBounds(editor: Editor, bounds: BoxLike): ShapeId[] {
  return editor.getShapesInsideBounds(bounds).map((shape) => shape.id)
}

/** Options for {@link isPointInShape}. */
export interface TLPointInShapeOptions {
  /** Count a point inside a shape's *outline* as a hit. Defaults to `false`. */
  hitInside?: boolean
  /** Extra tolerance in page units. Defaults to `0` — an exact test. */
  margin?: number
}

/**
 * Whether a page-space point falls on a shape, honouring what clips it.
 *
 * The clip check is the reason to call this instead of the shape's geometry
 * directly: a shape scrolled out of its frame is still *there* geometrically,
 * and hit-testing it would let a click land on something the user cannot see.
 *
 * Unlike {@link Editor.getShapeAtPoint} this asks about one named shape and
 * consults no z-order, so it is the right test for "is the pointer still on the
 * shape I am dragging".
 */
export function isPointInShape(
  editor: Editor,
  shape: ShapeRef,
  point: VecLike,
  opts: TLPointInShapeOptions = {},
): boolean {
  const record = resolveShape(editor, shape)
  if (!record) return false

  const mask = editor.getShapeMask(record)
  if (mask !== undefined && !pointInPolygon(point, mask)) return false

  const local = editor.getPointInShapeSpace(record, point)
  return editor.getShapeGeometry(record).hitTestPoint(local, opts.margin ?? 0, opts.hitInside ?? false)
}

/** Even-odd point-in-polygon. An empty polygon contains nothing. */
function pointInPolygon(point: VecLike, polygon: readonly VecLike[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses = a.y > point.y !== b.y > point.y
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Keep the emitted CSS short; sub-hundredth-pixel precision is not visible. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}
