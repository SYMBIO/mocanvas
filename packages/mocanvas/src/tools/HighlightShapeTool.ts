/**
 * The highlighter tool.
 *
 * The gesture is the draw tool's — pen down, record the movement, pen up — but
 * the shape it lays down is a `highlight`, and the differences matter enough to
 * be a tool of its own rather than a mode of `DrawTool`: a highlight never
 * closes into a filled region, so there is no closing test on pen-up, and it
 * has no `isClosed` prop for one to write to.
 */
import { StateNode, Vec, createShapeId, type PointerEventInfo, type ShapeId, type StateNodeConstructor } from "@mocanvas/editor"
import type { HighlightShape } from "../shapes/HighlightShapeUtil"

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("highlighting", info)
  }
  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

class Highlighting extends StateNode {
  static override id = "highlighting"
  private shapeId: ShapeId | null = null
  private origin = new Vec()
  private points: { x: number; y: number; z: number }[] = []
  private markId = ""
  private lastFlush = 0

  override onEnter(info: Record<string, unknown>): void {
    const editor = this.editor
    const isPen = (info as { isPen?: boolean }).isPen ?? false
    this.markId = editor.markHistoryStoppingPoint("highlight")
    this.origin = editor.inputs.originPagePoint.clone()
    this.points = [{ x: 0, y: 0, z: 0.5 }]
    const id = createShapeId()
    this.shapeId = id
    editor.createShape<HighlightShape>({
      id,
      type: "highlight",
      x: this.origin.x,
      y: this.origin.y,
      props: { segments: [{ type: "free", points: this.points.slice() }], isComplete: false, isPen },
    })
    editor.selectNone()
  }

  override onPointerMove(): void {
    const editor = this.editor
    const p = Vec.Sub(editor.inputs.currentPagePoint, this.origin)
    const last = this.points.at(-1)!
    if (Vec.Dist2(last, p) < 0.25) return
    this.points.push({ x: p.x, y: p.y, z: 0.5 })
    const now = performance.now()
    // Throttle store writes to ~120 Hz; the pointer may report far faster.
    if (now - this.lastFlush > 8) {
      this.lastFlush = now
      this.flush(false)
    }
  }

  override onPointerUp(): void {
    this.complete()
  }

  override onComplete(): void {
    this.complete()
  }

  override onCancel(): void {
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  private flush(complete: boolean): void {
    const shape = this.editor.getShape(this.shapeId!)
    if (!shape) return
    this.editor.updateShape<HighlightShape>({
      id: shape.id,
      type: "highlight",
      props: { segments: [{ type: "free", points: this.points.slice() }], isComplete: complete },
    })
  }

  private complete(): void {
    this.flush(true)
    this.parent!.transition("idle")
  }
}

/** Draw a translucent marker stroke over what is already on the canvas. */
export class HighlightShapeTool extends StateNode {
  static override id = "highlight"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Highlighting]
  /** The shape this tool places, for anything reading the tool list. */
  override shapeType = "highlight" as const
}
