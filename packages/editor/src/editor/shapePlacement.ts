/**
 * Where a shape ends up: which container it belongs to after a drag, and where
 * a freshly created one is put down.
 *
 * These are the decisions that happen *between* a gesture and a store write.
 * They live outside the tools so that the select tool, a custom tool and a
 * programmatic call all place shapes the same way — a shape dropped by a
 * plugin should land in the frame it visually landed in, exactly as one dropped
 * by hand does.
 */
import { Vec, type VecLike } from "../geometry"
import { isShapeId, type ParentId, type ShapeId, type UnknownShape } from "../records/base"
import type { Editor } from "./Editor"
import type { HitTestOptions } from "./Editor"

/**
 * Options for `Editor.getShapeAtPoint`.
 *
 * The defaults describe "what a person would say is under the pointer": the
 * outline counts, the interior of an unfilled shape does not, locked and hidden
 * shapes are not there at all.
 */
export interface TLGetShapeAtPointOptions extends HitTestOptions {
  /**
   * Count a hit inside an unfilled shape's outline.
   *
   * Off by default, and that is the interesting case: an unfilled rectangle is
   * a frame around empty space, and clicking the space inside it should select
   * whatever is behind, not the rectangle.
   */
  hitInside?: boolean
  /** Count a hit on the shape's text label even when the shape itself misses. */
  hitLabels?: boolean
  /** Count a hit inside a frame's body rather than only on its edge and heading. */
  hitFrameInside?: boolean
  /** Consider locked shapes. Off by default: a locked shape is not a click target. */
  hitLocked?: boolean
  /** Extra tolerance in page units. Defaults to the hit-test margin for the current pointer. */
  margin?: number
  /**
   * Only consider shapes that are currently being rendered.
   *
   * A large page culls most of its shapes, and for a pointer gesture "not on
   * screen" and "not hit" are the same answer — this makes the hit test cost
   * proportional to what is visible rather than to the document.
   */
  renderingOnly?: boolean
  /** Arbitrary further filtering, applied last. */
  filter?: (shape: UnknownShape) => boolean
}

/**
 * Snap a page-space point to the grid, when grid mode is on.
 *
 * Returns the point unchanged when it is off, so a call site can use it
 * unconditionally rather than branching — which is the point: every shape
 * creation path was independently forgetting to snap, and only some of them.
 */
export function maybeSnapToGrid(point: VecLike, editor: Editor): Vec {
  if (!editor.getInstanceState().isGridMode) return Vec.From(point)
  const size = editor.getDocumentSettings().gridSize
  if (!(size > 0)) return Vec.From(point)
  return new Vec(Math.round(point.x / size) * size, Math.round(point.y / size) * size)
}

/**
 * The new parent for each shape after a drag, keyed by shape id.
 *
 * Only shapes whose parent actually changes appear in the result, so a caller
 * can treat an empty map as "nothing to do". Descendants of a dragged shape are
 * never reparented — they travel with their ancestor, and moving them
 * separately would flatten the hierarchy the person dragged.
 */
export function getDroppedShapesToNewParents(
  editor: Editor,
  shapes: readonly UnknownShape[],
  point: VecLike,
): Map<ShapeId, ParentId> {
  const result = new Map<ShapeId, ParentId>()
  if (shapes.length === 0) return result

  // Only the top-level shapes of the dragged set are candidates: a child moves
  // because its parent did.
  const draggedIds = new Set<ShapeId>(shapes.map((shape) => shape.id))
  const roots = shapes.filter((shape) => !(isShapeId(shape.parentId) && draggedIds.has(shape.parentId)))

  const pageId = editor.getCurrentPageId()
  for (const shape of roots) {
    const target = findDropParent(editor, shape, point, draggedIds)
    const nextParent: ParentId = target?.id ?? pageId
    if (shape.parentId === nextParent) continue
    result.set(shape.id, nextParent)
  }
  return result
}

/**
 * The frontmost frame-like shape that will take `shape`, or `undefined` for
 * the page.
 *
 * The point is used rather than the shape's own bounds because that is what a
 * person is aiming with: a shape half in and half out of a frame belongs
 * wherever the pointer let go of it.
 */
function findDropParent(
  editor: Editor,
  shape: UnknownShape,
  point: VecLike,
  excluded: ReadonlySet<ShapeId>,
): UnknownShape | undefined {
  let target: UnknownShape | undefined
  for (const candidate of editor.getCurrentPageShapesSorted()) {
    if (excluded.has(candidate.id) || candidate.isLocked) continue
    const util = editor.getShapeUtil<UnknownShape>(candidate)
    if (!util.isFrameLike(candidate)) continue
    if (!util.canReceiveNewChildrenOfType(candidate, shape.type)) continue
    const bounds = editor.getShapePageBounds(candidate)
    if (!bounds) continue
    if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.maxX || point.y > bounds.maxY) continue
    // Sorted back to front, so the last match is the frontmost container.
    target = candidate
  }
  return target
}

/**
 * Reparent to the page any shape that is no longer inside the container it
 * claims to be in.
 *
 * The situation this fixes: a frame is resized, or one of its children is
 * moved by something other than a drag — an undo, an alignment, a peer's edit —
 * and a child ends up visually outside its parent while still being clipped by
 * it. The child becomes invisible and unselectable, which reads as data loss.
 *
 * Pass the ids of the containers to check. Returns the shapes that were moved.
 */
export function kickoutOccludedShapes(editor: Editor, containerIds: readonly ShapeId[]): UnknownShape[] {
  const moved: UnknownShape[] = []
  const pageId = editor.getCurrentPageId()

  for (const containerId of containerIds) {
    const container = editor.getShape<UnknownShape>(containerId)
    if (!container) continue
    const util = editor.getShapeUtil<UnknownShape>(container)
    if (!util.isFrameLike(container)) continue
    const bounds = editor.getShapePageBounds(container)
    if (!bounds) continue

    for (const childId of editor.getSortedChildIdsForParent(containerId)) {
      const child = editor.getShape<UnknownShape>(childId)
      if (!child) continue
      const childBounds = editor.getShapePageBounds(child)
      // No bounds means nothing to compare; leave it where it is rather than
      // guessing, since a shape with no bounds cannot be "outside" anything.
      if (!childBounds) continue
      if (bounds.collides(childBounds)) continue
      if (!util.canRemoveChildrenOfType(container, child.type)) continue
      moved.push(child)
    }
  }

  if (moved.length > 0) editor.reparentShapes(moved, pageId)
  return moved
}
