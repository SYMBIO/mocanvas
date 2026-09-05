/**
 * Dragging a tool off the toolbar to place a shape.
 *
 * The gesture is worth supporting because it is how a first-time user
 * discovers that the toolbar makes things: pressing a tool and dragging onto
 * the canvas puts the shape exactly where the finger let go, with no second
 * click. Everything about it is the same for every tool except *what* gets
 * created, which is why that is the one thing the caller supplies.
 */

import { createShapeId, type Editor, type EventInfo, type PointerEventInfo, type ShapeId } from "@mocanvas/editor"
import { centerSelectionAroundPoint } from "./pointer"

/** What {@link onDragFromToolbarToCreateShape} needs from the toolbar button. */
export interface OnDragFromToolbarToCreateShapesOpts {
  /**
   * Create the shape being dragged, under this id.
   *
   * Position is not passed in: the shape is created wherever the util's
   * defaults put it and then centred on the drop point, so a caller only has to
   * know what it is making, not where.
   */
  createShape(id: ShapeId): void
  /** The toolbar tool to keep highlighted while the drag is in flight. */
  maskedToolId?: string
  /** Called once the shape is placed, for a tool that wants to start editing it. */
  onDragEnd?(id: ShapeId): void
}

/**
 * Create a shape at the end of a drag that started on the toolbar.
 *
 * The tool id stays masked for the length of the gesture so the toolbar keeps
 * showing the button the drag came from rather than jumping to `select` the
 * moment the shape exists. The mask is lifted on the next pointer-up —
 * including a cancelled gesture, which still ends in one — so a released drag
 * can never leave the toolbar stuck on a tool the editor is not in.
 */
export function onDragFromToolbarToCreateShape(editor: Editor, _info: PointerEventInfo, opts: OnDragFromToolbarToCreateShapesOpts): void {
  const id = createShapeId()

  editor.markHistoryStoppingPoint("create shape from toolbar")
  editor.run(() => {
    opts.createShape(id)
    if (!editor.getShape(id)) return
    editor.setSelectedShapes([id])
    // Where the pointer is *now*, not where the press started: the drop point
    // is the whole point of the gesture.
    centerSelectionAroundPoint(editor, editor.inputs.currentPagePoint)
  })

  if (!editor.getShape(id)) return

  if (opts.maskedToolId !== undefined) {
    const tool = editor.getCurrentTool()
    tool?.setCurrentToolIdMask(opts.maskedToolId)
    const off = editor.on("event", (event: EventInfo) => {
      if (event.type !== "pointer" || event.name !== "pointer_up") return
      tool?.setCurrentToolIdMask(undefined)
      off()
    })
  }

  opts.onDragEnd?.(id)
}
