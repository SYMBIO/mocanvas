/**
 * Deciding what actually gets drawn.
 *
 * Three different questions get confused with each other, so they are three
 * different functions here:
 *
 *   HIDDEN   — the host said not to show this shape (`getShapeVisibility`).
 *              It is not drawn, not hit-tested, and not exported.
 *   NOT VISIBLE — the shape is off-screen, or clipped away by an ancestor.
 *              It is still part of the document and still hit-testable through
 *              an explicit query; it simply is not on screen right now.
 *   CULLED   — not visible, AND its util allows it to be skipped. This is the
 *              set the renderer is allowed to not draw.
 *
 * A shape can be not-visible without being culled (a util that says `canCull`
 * is false — a video that must keep playing, a shape with a live iframe), which
 * is why collapsing the two would be wrong.
 */
import type { Box } from "../geometry"
import { isPageId, type ShapeId, type UnknownShape } from "../records/base"
import type { ShapeUtil } from "../shapes/ShapeUtil"
import type { Editor } from "./Editor"
import { resolveShape, type ShapeRef } from "./ancestry"

/**
 * What the host may say about one shape's visibility.
 *
 * `"inherit"` (and `null` / `undefined`) defer to the shape's parent, so hiding
 * a frame hides what is inside it; `"visible"` overrides an ancestor that was
 * hidden, which is what makes "hide everything except this layer" expressible.
 */
export type TLShapeVisibility = "inherit" | "hidden" | "visible"

/**
 * The host's hook for hiding shapes without deleting them — layers, filters,
 * a review mode that shows only one author's work.
 *
 * It is consulted per shape and must be cheap and pure: it runs inside the
 * render path, and a version that reads mutable state outside the store will
 * not re-run when that state changes.
 */
export type TLGetShapeVisibility = (shape: UnknownShape, editor: Editor) => TLShapeVisibility | null | undefined

/** One shape, with everything the renderer needs to place it. */
export interface TLRenderingShape {
  id: ShapeId
  shape: UnknownShape
  util: ShapeUtil
  /** Paint order for the shape itself; higher is nearer the viewer. */
  index: number
  /**
   * Paint order for the shape's background layer, when its util provides one.
   * Always below `index`, so a frame's fill sits under its own children.
   */
  backgroundIndex: number
  /** The shape's opacity multiplied by every ancestor's. */
  opacity: number
  /** Whether the renderer may skip this shape this frame. */
  isCulled: boolean
}

/**
 * Whether the host has hidden this shape.
 *
 * Resolves `"inherit"` up the parent chain, so the question is answered for the
 * shape *in its context* rather than in isolation. With no `getShapeVisibility`
 * configured nothing is ever hidden and this is a cheap `false`.
 */
export function isShapeHidden(editor: Editor, shape: ShapeRef | undefined): boolean {
  const getVisibility = editor.getShapeVisibility
  if (!getVisibility) return false
  const record = resolveShape(editor, shape)
  if (!record) return false

  const seen = new Set<ShapeId>()
  let current: UnknownShape | undefined = record
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const verdict = getVisibility(current, editor)
    if (verdict === "hidden") return true
    if (verdict === "visible") return false
    current = isPageId(current.parentId) ? undefined : editor.getShape<UnknownShape>(current.parentId)
  }
  return false
}

/**
 * Every shape on the current page in paint order, with its render metadata.
 *
 * This is the renderer's input list. It includes shapes that are off-screen —
 * flagged `isCulled` rather than dropped — because a component that unmounts an
 * off-screen shape loses its DOM state, and the caller is better placed than
 * this function to decide between skipping the paint and unmounting.
 */
export function getRenderingShapes(editor: Editor): TLRenderingShape[] {
  const culled = getCulledShapes(editor)
  const out: TLRenderingShape[] = []
  let index = 0

  const walk = (parentId: UnknownShape["parentId"], inheritedOpacity: number): void => {
    for (const childId of editor.getSortedChildIdsForParent(parentId)) {
      const shape = editor.getShape<UnknownShape>(childId)
      if (!shape) continue
      if (isShapeHidden(editor, shape)) continue
      const opacity = shape.opacity * inheritedOpacity
      const backgroundIndex = index
      index += 2
      out.push({
        id: shape.id,
        shape,
        util: editor.getShapeUtil<UnknownShape>(shape),
        index,
        backgroundIndex,
        opacity,
        isCulled: culled.has(shape.id),
      })
      walk(shape.id, opacity)
    }
  }
  walk(editor.getCurrentPageId(), 1)
  return out
}

/**
 * The current page's shapes in paint order, without the render metadata — the
 * plain list for anything that only needs "which shapes, in what order".
 *
 * Hidden shapes are left out, which is the difference from
 * `getCurrentPageShapesSorted()`.
 */
export function getCurrentPageRenderingShapesSorted(editor: Editor): UnknownShape[] {
  return getRenderingShapes(editor).map((entry) => entry.shape)
}

/**
 * The current page's shapes in READING order: top to bottom, then left to
 * right, the way a person scans a board.
 *
 * Paint order is the wrong order for a screen reader, for tab navigation and
 * for "next shape" keyboard movement — it is an implementation detail of
 * z-stacking, and a shape moved to the front does not become the first thing
 * you should hear about. Reading order is stable under z-order changes.
 *
 * SEMANTICS-ASSUMED: rows are banded. Two shapes whose vertical centres are
 * within half the shorter one's height count as being on the same line and are
 * ordered left to right; otherwise the higher one comes first. Without a band a
 * row of cards laid out a pixel apart vertically reads as a column.
 */
export function getCurrentPageShapesInReadingOrder(editor: Editor): UnknownShape[] {
  const entries: { shape: UnknownShape; bounds: Box }[] = []
  for (const shape of editor.getCurrentPageShapes()) {
    if (isShapeHidden(editor, shape)) continue
    const bounds = editor.getShapePageBounds(shape)
    if (bounds) entries.push({ shape, bounds })
  }
  return entries
    .sort((a, b) => {
      const band = Math.min(a.bounds.height, b.bounds.height) / 2
      const dy = a.bounds.center.y - b.bounds.center.y
      if (Math.abs(dy) > band) return dy
      return a.bounds.minX - b.bounds.minX || a.bounds.minY - b.bounds.minY
    })
    .map((entry) => entry.shape)
}

/**
 * Shapes on the current page that are not on screen — off the edge of the
 * viewport, or clipped away entirely by an ancestor.
 *
 * Not the same as {@link getCulledShapes}: this set includes shapes the
 * renderer must draw anyway.
 */
export function getNotVisibleShapes(editor: Editor): Set<ShapeId> {
  const viewport = editor.getViewportPageBounds()
  const out = new Set<ShapeId>()
  for (const shape of editor.getCurrentPageShapes()) {
    const bounds = editor.getShapeMaskedPageBounds(shape)
    if (!bounds || !viewport.collides(bounds)) out.add(shape.id)
  }
  return out
}

/**
 * The shapes the renderer is allowed to skip this frame: off screen *and*
 * willing to be skipped.
 *
 * A util opts out with `canCull()` — the escape hatch for a shape whose
 * existence off screen still matters (a playing video, an embedded document
 * that would reload). A shape being edited is never culled either: losing the
 * editor's DOM mid-keystroke is not recoverable.
 */
export function getCulledShapes(editor: Editor): Set<ShapeId> {
  const editingId = editor.getEditingShapeId()
  const out = new Set<ShapeId>()
  for (const id of getNotVisibleShapes(editor)) {
    if (id === editingId) continue
    const shape = editor.getShape<UnknownShape>(id)
    if (!shape) continue
    // Duck-typed rather than a hard dependency on the hook: a util that does
    // not implement `canCull` is willing to be culled, which is the behaviour
    // every shape had before the hook existed.
    const util = editor.getShapeUtil<UnknownShape>(shape) as { canCull?(shape: UnknownShape): boolean }
    if (util.canCull && !util.canCull(shape)) continue
    out.add(id)
  }
  return out
}
