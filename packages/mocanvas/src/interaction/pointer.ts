/**
 * The two questions a tool asks on a pointer down: what did I hit, and where
 * should what I just made end up.
 *
 * Both are exported because a custom tool needs to answer them the same way the
 * built-in ones do — a select tool that hit-tests differently from the eraser
 * is a tool that disagrees with the canvas about what the user clicked.
 */

import { Vec, type Editor, type ShapeId, type UnknownShape, type VecLike } from "@mocanvas/editor"

/**
 * The shape under the pointer, as a click should resolve it.
 *
 * Not the same question as `editor.getShapeAtPoint`, which answers about
 * geometry. This one answers about *intent*, and differs in three ways that
 * each come from how a click reads to a person:
 *
 * - a filled shape is hit anywhere inside it, an unfilled one only on its edge,
 *   because clicking through the middle of an outline is how you select what is
 *   behind it;
 * - a locked shape is not hit at all;
 * - a frame is hit on its edge and its heading, not across its interior, so a
 *   click inside a frame reaches what is in the frame.
 *
 * `hitLabels` widens it to count a shape's text label as part of the shape,
 * which is what a double-click-to-edit needs.
 */
export function getHitShapeOnCanvasPointerDown(editor: Editor, hitLabels = false): UnknownShape | undefined {
  const point = editor.inputs.currentPagePoint
  const margin = editor.getHitTestMargin() / editor.getZoomLevel()

  // Filled shapes and labels first, at zero margin: something the pointer is
  // actually inside beats something it is merely near.
  const inside = editor.getShapeAtPoint(point, {
    hitInside: true,
    hitFrameInside: false,
    hitLocked: false,
    margin: 0,
    filter: (shape) => (hitLabels ? true : !isLabelOnly(editor, shape)),
  })
  if (inside) return inside

  // Then anything whose outline is within the usual tolerance.
  return editor.getShapeAtPoint(point, { hitInside: false, hitFrameInside: false, hitLocked: false, margin })
}

/** Whether a shape's only hittable geometry is its label. */
function isLabelOnly(editor: Editor, shape: UnknownShape): boolean {
  const geometry = editor.getShapeGeometry(shape)
  return geometry.isLabel === true
}

/**
 * Move the selection so its centre sits at `position`.
 *
 * The last step of "create this shape where I dropped it": a tool creates the
 * shape at whatever origin is convenient, then centres the result. Doing it as
 * a translation of the finished selection rather than as an offset at creation
 * time means it works the same for one shape and for twenty.
 */
export function centerSelectionAroundPoint(editor: Editor, position: VecLike): void {
  const bounds = editor.getSelectionPageBounds()
  if (!bounds) return
  const delta = Vec.Sub(position, bounds.center)
  if (delta.x === 0 && delta.y === 0) return
  const ids: ShapeId[] = editor.getSelectedShapeIds()
  editor.nudgeShapes(ids, delta)
}
