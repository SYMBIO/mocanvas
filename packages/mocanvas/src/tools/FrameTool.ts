import { dropShapesOnFrameLike, type Editor, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import { BaseBoxShapeTool, type BoxSize } from "./BaseBoxShapeTool"

/** Size of the frame created by a click without a drag: tldraw's, twice the default props. */
const DEFAULT_FRAME_SIZE: BoxSize = { w: 320, h: 180 }
/** Smallest frame a drag can produce. */
const MIN_FRAME_SIZE = 32

/** `Frame 1`, `Frame 2`, ... counting the frames already on the page. */
function nextFrameName(editor: Editor): string {
  const count = editor.getCurrentPageShapes().filter((s) => s.type === "frame").length
  return `Frame ${count + 1}`
}

/** Move shapes that sit entirely inside a fresh frame into it. */
function adoptShapesInside(editor: Editor, frameId: ShapeId): void {
  const frame = editor.getShape(frameId)
  const bounds = editor.getShapePageBounds(frameId)
  if (!frame || !bounds) return
  const pageId = editor.getCurrentPageId()
  const inside = editor.getShapesInsideBounds(bounds).filter((s: UnknownShape) => {
    if (s.id === frameId || s.isLocked || s.parentId !== pageId) return false
    // A container never swallows another container: two frames drawn over each
    // other stay siblings, which is what keeps the shape tree flat and legible.
    return !editor.getShapeUtil(s).isFrameLike(s)
  })
  if (inside.length) dropShapesOnFrameLike(editor, frame, inside)
}

/**
 * Drag out a frame, or click to place a default-sized one.
 *
 * Drawing a frame *around* existing shapes adopts them — the Figma behaviour,
 * and the reason the tool is worth having over "create it, then drag things in".
 */
export class FrameTool extends BaseBoxShapeTool {
  static override id = "frame"
  static override initial = "idle"

  override shapeType = "frame" as const

  override minSize = MIN_FRAME_SIZE

  /** A click places a full artboard, not the 160×90 a bare `createShape` gives. */
  override getDefaultSize(): BoxSize {
    return { ...DEFAULT_FRAME_SIZE }
  }

  override getCreateProps(): Record<string, unknown> {
    return { name: nextFrameName(this.editor) }
  }

  override onCreate(shape: UnknownShape | null): void {
    const editor = this.editor
    if (shape) adoptShapesInside(editor, shape.id)
    if (editor.getInstanceState().isToolLocked) editor.setCurrentTool(this.id)
    else editor.setCurrentTool("select")
  }
}
