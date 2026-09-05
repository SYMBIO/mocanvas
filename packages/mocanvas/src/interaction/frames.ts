/**
 * The two frame operations that are not "move it" or "resize it".
 *
 * Both are exported rather than living inside a menu item because both are
 * things an app scripts: laying out a board programmatically, or flattening a
 * template's frames before an export.
 */

import type { Editor, ShapeId } from "@mocanvas/editor"

/** Default breathing room {@link fitFrameToContent} leaves around the content. */
const DEFAULT_FRAME_PADDING = 32

/**
 * Resize a frame — or any frame-like container — so it fits its children,
 * with `padding` around them.
 *
 * The frame's children keep their page positions: the frame moves and resizes
 * around them rather than the other way round, so fitting a frame never
 * disturbs the drawing inside it. A frame with no children is left alone,
 * because shrinking it to nothing would make it unclickable.
 */
export function fitFrameToContent(editor: Editor, id: ShapeId, opts: { padding?: number } = {}): void {
  const frame = editor.getShape(id)
  if (!frame || !editor.isShapeFrameLike(frame)) return

  const childIds = editor.getSortedChildIdsForParent(id)
  if (childIds.length === 0) return

  const bounds = editor.getShapesPageBounds([...childIds])
  if (!bounds) return

  const padding = opts.padding ?? DEFAULT_FRAME_PADDING
  const frameTransform = editor.getShapePageTransform(id)
  if (!frameTransform) return

  // Where the frame's own origin has to move to, in its parent's space.
  const nextPageX = bounds.minX - padding
  const nextPageY = bounds.minY - padding
  const dx = nextPageX - frameTransform.e
  const dy = nextPageY - frameTransform.f

  editor.markHistoryStoppingPoint("fit frame to content")
  editor.run(() => {
    editor.updateShape({
      id,
      type: frame.type,
      x: frame.x + dx,
      y: frame.y + dy,
      props: { w: bounds.w + padding * 2, h: bounds.h + padding * 2 },
    } as never)
    // The children are positioned relative to the frame, so moving the frame
    // would drag them along; shifting them back by the same amount is what
    // keeps them where they were on the page.
    if (dx !== 0 || dy !== 0) {
      editor.updateShapes(
        childIds.map((childId) => {
          const child = editor.getShape(childId)!
          return { id: childId, type: child.type, x: child.x - dx, y: child.y - dy }
        }) as never,
      )
    }
  })
}

/**
 * Remove the frames among `ids`, keeping what was inside them.
 *
 * The children are reparented to the frame's own parent first and then the
 * frame is deleted, so "remove frame" un-groups rather than destroys — which is
 * the only reading that makes it safe to reach for. Ids that are not frames are
 * ignored, so passing the whole selection is fine.
 */
export function removeFrame(editor: Editor, ids: readonly ShapeId[]): void {
  const frames = ids
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NonNullable<typeof shape> => shape !== undefined && editor.isShapeFrameLike(shape))
  if (frames.length === 0) return

  editor.markHistoryStoppingPoint("remove frame")
  editor.run(() => {
    for (const frame of frames) {
      const childIds = editor.getSortedChildIdsForParent(frame.id)
      if (childIds.length > 0) {
        editor.reparentShapes([...childIds], frame.parentId)
      }
    }
    editor.deleteShapes(frames.map((frame) => frame.id))
  })
}
