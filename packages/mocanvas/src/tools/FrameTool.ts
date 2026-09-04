import {
  createShapeId,
  StateNode,
  type Editor,
  type PointerEventInfo,
  type ShapeId,
  type StateNodeConstructor,
  type UnknownShape,
} from "@mocanvas/editor"
import type { FrameShape } from "../shapes"

/** Size of the frame created by a click without a drag. */
const DEFAULT_FRAME_SIZE = { w: 640, h: 480 }
/** Smallest frame a drag can produce. */
const MIN_FRAME_SIZE = 32

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("pointing", info)
  }

  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

class Pointing extends StateNode {
  static override id = "pointing"
  private shapeId: ShapeId | null = null
  private markId = ""

  override onEnter(): void {
    this.shapeId = null
  }

  override onPointerMove(): void {
    if (!this.editor.inputs.isDragging) return
    if (!this.shapeId) this.create()
    this.resize()
  }

  override onPointerUp(): void {
    if (!this.shapeId) {
      // Click without a drag: a default-sized frame centred on the point.
      this.create()
      const { originPagePoint } = this.editor.inputs
      this.editor.updateShape<FrameShape>({
        id: this.shapeId!,
        type: "frame",
        x: originPagePoint.x - DEFAULT_FRAME_SIZE.w / 2,
        y: originPagePoint.y - DEFAULT_FRAME_SIZE.h / 2,
        props: { ...DEFAULT_FRAME_SIZE },
      })
    }
    this.finish()
  }

  override onComplete(): void {
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.shapeId = null
    this.parent!.transition("idle")
  }

  private create(): void {
    const editor = this.editor
    this.markId = editor.markHistoryStoppingPoint("create frame")
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    editor.createShape<FrameShape>({
      id,
      type: "frame",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { w: MIN_FRAME_SIZE, h: MIN_FRAME_SIZE, name: nextFrameName(editor) },
    })
    editor.select(id)
    this.shapeId = id
  }

  private resize(): void {
    const editor = this.editor
    const shape = editor.getShape<FrameShape>(this.shapeId!)
    if (!shape) return
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let w = currentPagePoint.x - originPagePoint.x
    let h = currentPagePoint.y - originPagePoint.y
    if (shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    let x = originPagePoint.x
    let y = originPagePoint.y
    if (w < 0) x += w
    if (h < 0) y += h
    editor.updateShape<FrameShape>({
      id: shape.id,
      type: "frame",
      x,
      y,
      props: { w: Math.max(MIN_FRAME_SIZE, Math.abs(w)), h: Math.max(MIN_FRAME_SIZE, Math.abs(h)) },
    })
  }

  private finish(): void {
    const editor = this.editor
    if (this.shapeId) adoptShapesInside(editor, this.shapeId)
    this.shapeId = null
    const locked = editor.getInstanceState().isToolLocked
    this.parent!.transition("idle")
    if (!locked) editor.setCurrentTool("select")
  }
}

/** `Frame 1`, `Frame 2`, ... counting the frames already on the page. */
function nextFrameName(editor: Editor): string {
  const count = editor.getCurrentPageShapes().filter((s) => s.type === "frame").length
  return `Frame ${count + 1}`
}

/** Move shapes that sit entirely inside a fresh frame into it. */
function adoptShapesInside(editor: Editor, frameId: ShapeId): void {
  const bounds = editor.getShapePageBounds(frameId)
  if (!bounds) return
  const pageId = editor.getCurrentPageId()
  const inside = editor
    .getShapesInsideBounds(bounds)
    .filter((s: UnknownShape) => s.id !== frameId && s.type !== "frame" && !s.isLocked && s.parentId === pageId)
  if (inside.length) editor.reparentShapes(inside.map((s) => s.id), frameId)
}

/** Drag out a frame, or click to place a default-sized one. */
export class FrameTool extends StateNode {
  static override id = "frame"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
}
