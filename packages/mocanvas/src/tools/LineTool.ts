import {
  createShapeId,
  StateNode,
  Vec,
  type ClickEventInfo,
  type KeyboardEventInfo,
  type PointerEventInfo,
  type ShapeId,
  type StateNodeConstructor,
} from "@mocanvas/editor"
import { getIndexAbove, type IndexKey } from "@mocanvas/store"
import { getLinePoints, type LinePoint, type LineShape } from "../shapes"

/** Segments shorter than this are treated as a repeated click, not a new point. */
const MIN_SEGMENT_LENGTH = 4

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

/**
 * Draws a line. A drag makes a straight two-point line; a click starts a
 * multi-segment line where every further click commits another point and the
 * last point follows the pointer. Enter or a double click finishes it.
 */
class Pointing extends StateNode {
  static override id = "pointing"
  private shapeId: ShapeId | null = null
  private markId = ""
  /** Id of the point that follows the pointer. */
  private draftId = "a2"
  /** Set once the pointer travelled far enough to count as a drag. */
  private dragged = false

  override onEnter(): void {
    const editor = this.editor
    this.dragged = false
    this.markId = editor.markHistoryStoppingPoint("create line")
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    this.draftId = "a2"
    editor.createShape<LineShape>({
      id,
      type: "line",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: {
        points: {
          a1: { id: "a1", index: "a1", x: 0, y: 0 },
          a2: { id: "a2", index: "a2", x: 0, y: 0 },
        },
      },
    })
    editor.select(id)
    this.shapeId = id
  }

  /** A further click commits the draft point and starts a new one. */
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    const shape = this.getShape()
    if (!shape) return
    this.dragged = false
    this.moveDraftToPointer()
    this.addPoint()
  }

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.dragged = true
    this.moveDraftToPointer()
  }

  override onPointerUp(): void {
    // A drag finishes the line right away; a click keeps the tool going so the
    // next click adds another segment. `inputs.isDragging` is already cleared
    // by the time a pointer up arrives, hence the flag.
    if (this.dragged) this.finish()
  }

  override onDoubleClick(info: ClickEventInfo): void {
    // See `SelectTool.onDoubleClick`: act on the release, not every phase.
    if (info.phase !== "up") return
    this.finish()
  }

  override onKeyDown(info: KeyboardEventInfo): void {
    if (info.key === "Enter") this.finish()
  }

  override onComplete(): void {
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.shapeId = null
    this.parent!.transition("idle")
  }

  private getShape(): LineShape | undefined {
    return this.shapeId ? this.editor.getShape<LineShape>(this.shapeId) : undefined
  }

  private moveDraftToPointer(): void {
    const editor = this.editor
    const shape = this.getShape()
    if (!shape) return
    const local = editor.getPointInShapeSpace(shape, editor.inputs.currentPagePoint)
    const draft = shape.props.points[this.draftId]
    if (!draft) return
    const points: Record<string, LinePoint> = { ...shape.props.points, [this.draftId]: { ...draft, x: local.x, y: local.y } }
    editor.updateShape<LineShape>({ id: shape.id, type: "line", props: { points } })
  }

  private addPoint(): void {
    const shape = this.getShape()
    if (!shape) return
    const ordered = getLinePoints(shape)
    const last = ordered.at(-1)
    const prev = ordered.at(-2)
    if (!last) return
    // Clicking the same spot twice would add a degenerate segment; finish instead.
    if (prev && Vec.Dist(prev, last) < MIN_SEGMENT_LENGTH) {
      this.finish()
      return
    }
    const index = getIndexAbove(last.index as IndexKey)
    const points: Record<string, LinePoint> = { ...shape.props.points, [index]: { id: index, index, x: last.x, y: last.y } }
    this.draftId = index
    this.editor.updateShape<LineShape>({ id: shape.id, type: "line", props: { points } })
  }

  private finish(): void {
    const editor = this.editor
    const shape = this.getShape()
    if (shape) {
      const ordered = getLinePoints(shape)
      const last = ordered.at(-1)
      const prev = ordered.at(-2)
      if (ordered.length > 2 && last && prev && Vec.Dist(prev, last) < MIN_SEGMENT_LENGTH) {
        // Drop the trailing draft point left over from the finishing click.
        const points = { ...shape.props.points }
        delete points[last.id]
        editor.updateShape<LineShape>({ id: shape.id, type: "line", props: { points } })
      } else if (ordered.length <= 2 && last && prev && Vec.Dist(prev, last) < MIN_SEGMENT_LENGTH) {
        // A line of no length at all: undo the whole creation.
        editor.bailToMark(this.markId)
      }
    }
    this.shapeId = null
    const locked = editor.getInstanceState().isToolLocked
    this.parent!.transition("idle")
    if (!locked) editor.setCurrentTool("select")
  }
}

/** Drag for a straight line, or click repeatedly for a multi-segment one. */
export class LineTool extends StateNode {
  static override id = "line"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
}
