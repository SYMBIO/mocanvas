/**
 * Driving frame-like containers from a tool: which container a drag is over,
 * and how to hand the dragged shapes to it.
 *
 * The container *behaviour* lives on the util ({@link BaseFrameLikeShapeUtil});
 * this module is only the plumbing a pointer gesture needs, kept out of the
 * tools so the select tool and any app tool reparent identically.
 */
import type { Editor } from "../editor/Editor"
import { isShapeId, type UnknownShape } from "../records/base"
import type { VecLike } from "../geometry"

/** Every id in `shapes`, plus every descendant of those shapes. */
function withDescendants(editor: Editor, shapes: readonly UnknownShape[]): Set<string> {
  const ids = new Set<string>()
  const visit = (id: string): void => {
    if (ids.has(id)) return
    ids.add(id)
    for (const child of editor.getSortedChildIdsForParent(id as UnknownShape["id"])) visit(child)
  }
  for (const shape of shapes) visit(shape.id)
  return ids
}

/**
 * The frame-like shape a drag would drop into, or `undefined` for the page.
 *
 * The **topmost** container under the point wins, so a section nested in a
 * frame takes the drop rather than the frame behind it. A container being
 * dragged (or living under something being dragged) is never its own target.
 */
export function getFrameLikeDropTarget(editor: Editor, point: VecLike, dragging: readonly UnknownShape[]): UnknownShape | undefined {
  const excluded = withDescendants(editor, dragging)
  let target: UnknownShape | undefined
  for (const shape of editor.getCurrentPageShapesSorted()) {
    if (excluded.has(shape.id) || shape.isLocked) continue
    const util = editor.getShapeUtil(shape)
    if (!util.isFrameLike(shape)) continue
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue
    if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.maxX || point.y > bounds.maxY) continue
    if (!util.canDropShapes(shape, [...dragging])) continue
    target = shape
  }
  return target
}

/**
 * Move `shapes` into `target` (or back onto the page when `target` is
 * `undefined`), through the containers' own hooks.
 *
 * Leaving is always offered to the old container *before* the new one adopts,
 * so a container that refuses to release a child (a locked section) keeps it —
 * the drop then simply does nothing for that shape.
 */
export function dropShapesOnFrameLike(editor: Editor, target: UnknownShape | undefined, shapes: readonly UnknownShape[]): void {
  const moving = shapes.filter((s) => s.parentId !== (target?.id ?? editor.getCurrentPageId()))
  if (moving.length === 0) return

  // Leaving: group by the container each shape is in now, so every old parent
  // hears about all of its departing children at once.
  const byParent = new Map<string, UnknownShape[]>()
  for (const shape of moving) byParent.set(shape.parentId, [...(byParent.get(shape.parentId) ?? []), shape])
  const released = new Set<string>()
  for (const [parentId, children] of byParent) {
    // A parent id that is not a shape id is the page itself, which has no util
    // to ask — and `getShape` would happily hand back the page record.
    const parent = isShapeId(parentId) ? editor.getShape(parentId) : undefined
    if (!parent) {
      // Straight off the page: nothing to ask.
      for (const child of children) released.add(child.id)
      continue
    }
    const util = editor.getShapeUtil(parent)
    if (!util.isFrameLike(parent)) {
      for (const child of children) released.add(child.id)
      continue
    }
    const allowed = children.filter((child) => util.canRemoveChildrenOfType(parent, child.type))
    if (allowed.length === 0) continue
    util.onDragShapesOut?.(parent, allowed)
    for (const child of allowed) released.add(child.id)
  }

  const arriving = moving.filter((s) => released.has(s.id)).map((s) => editor.getShape(s.id) ?? s)
  if (arriving.length === 0) return

  if (!target) {
    const pageId = editor.getCurrentPageId()
    const stray = arriving.filter((s) => s.parentId !== pageId)
    if (stray.length > 0) {
      editor.reparentShapes(
        stray.map((s) => s.id),
        pageId,
      )
    }
    return
  }
  editor.getShapeUtil(target).onDragShapesIn?.(target, arriving)
}
