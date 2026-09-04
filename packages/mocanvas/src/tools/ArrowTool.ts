import {
  createShapeId,
  StateNode,
  Vec,
  type PointerEventInfo,
  type ShapeHandle,
  type ShapeId,
  type StateNodeConstructor,
} from "@mocanvas/editor"
import type { ArrowShape } from "../shapes"

/** Length of the arrow created by a click without a drag, in page units. */
const DEFAULT_ARROW_LENGTH = 100
/** Arrows shorter than this are discarded on pointer up. */
const MIN_ARROW_LENGTH = 4

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
  /** Set once the pointer travelled far enough to count as a drag. */
  private dragged = false

  override onEnter(): void {
    const editor = this.editor
    this.dragged = false
    this.markId = editor.markHistoryStoppingPoint("create arrow")
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    editor.createShape<ArrowShape>({
      id,
      type: "arrow",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    })
    editor.select(id)
    this.shapeId = id
  }

  override onPointerMove(): void {
    if (!this.editor.inputs.isDragging) return
    this.dragged = true
    this.updateEnd()
  }

  override onPointerUp(): void {
    // `inputs.isDragging` is already cleared by the time a pointer up arrives.
    if (this.dragged) this.updateEnd()
    else this.setDefaultEnd()
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

  /**
   * Move the end terminal to the pointer, offering a binding the same way the
   * select tool's handle drag does: the shape util decides whether the point
   * lands on a bindable shape and returns the props to apply.
   */
  private updateEnd(): void {
    const editor = this.editor
    const shape = editor.getShape<ArrowShape>(this.shapeId!)
    if (!shape) return
    const local = editor.getPointInShapeSpace(shape, editor.inputs.currentPagePoint)
    const handle: ShapeHandle = { id: "end", type: "vertex", index: "a3", x: local.x, y: local.y }
    const change = editor.getShapeUtil<ArrowShape>(shape).onHandleDrag?.(shape, { handle, isPrecise: editor.inputs.altKey, initial: shape })
    if (change) editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", ...change })
    else editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", props: { end: { x: local.x, y: local.y } } })
  }

  /** A click without a drag makes a default arrow pointing to the right. */
  private setDefaultEnd(): void {
    const editor = this.editor
    const shape = editor.getShape<ArrowShape>(this.shapeId!)
    if (!shape) return
    editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", props: { end: { x: DEFAULT_ARROW_LENGTH, y: 0 } } })
  }

  private finish(): void {
    const editor = this.editor
    const shape = this.shapeId ? editor.getShape<ArrowShape>(this.shapeId) : undefined
    if (shape) {
      const { start, end } = shape.props
      // No zero-length arrows: undo the whole creation, bindings included.
      if (Vec.Dist(start, end) < MIN_ARROW_LENGTH) editor.bailToMark(this.markId)
    }
    this.shapeId = null
    const locked = editor.getInstanceState().isToolLocked
    this.parent!.transition("idle")
    if (!locked) editor.setCurrentTool("select")
  }
}

/** Drag to draw an arrow; dropping the end on a shape binds it to that shape. */
export class ArrowTool extends StateNode {
  static override id = "arrow"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
}
