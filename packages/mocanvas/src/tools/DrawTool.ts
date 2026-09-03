import { createShapeId, StateNode, Vec, type PointerEventInfo, type ShapeId, type StateNodeConstructor } from "@mocanvas/editor"

interface DrawProps {
  segments: { type: "free" | "straight"; points: { x: number; y: number; z?: number }[] }[]
  isComplete: boolean
  isClosed: boolean
  isPen: boolean
}

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("drawing", info)
  }
  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

class Drawing extends StateNode {
  static override id = "drawing"
  private shapeId: ShapeId | null = null
  private origin = new Vec()
  private points: { x: number; y: number; z: number }[] = []
  private markId = ""
  private lastFlush = 0

  override onEnter(info: Record<string, unknown>): void {
    const editor = this.editor
    const isPen = (info as { isPen?: boolean }).isPen ?? false
    this.markId = editor.markHistoryStoppingPoint("draw")
    this.origin = editor.inputs.originPagePoint.clone()
    this.points = [{ x: 0, y: 0, z: 0.5 }]
    const id = createShapeId()
    this.shapeId = id
    editor.createShape({
      id,
      type: "draw",
      x: this.origin.x,
      y: this.origin.y,
      props: {
        segments: [{ type: "free", points: this.points.slice() }],
        isComplete: false,
        isClosed: false,
        isPen,
        ...(editor.getInstanceState().stylesForNextShape as object),
      },
    })
    editor.selectNone()
  }

  override onPointerMove(): void {
    const editor = this.editor
    const { currentPagePoint } = editor.inputs
    const p = Vec.Sub(currentPagePoint, this.origin)
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
    const editor = this.editor
    const shape = editor.getShape(this.shapeId!)
    if (!shape) return
    const props = shape.props as DrawProps
    const first = this.points[0]!
    const last = this.points.at(-1)!
    const isClosed = complete && this.points.length > 3 && Vec.Dist(first, last) < 12 / editor.getZoomLevel()
    editor.updateShape({
      id: shape.id,
      type: "draw",
      props: {
        segments: [{ type: props.segments[0]?.type ?? "free", points: this.points.slice() }],
        isComplete: complete,
        isClosed,
      },
    })
  }

  private complete(): void {
    this.flush(true)
    const editor = this.editor
    this.parent!.transition("idle")
    if (!editor.getInstanceState().isToolLocked && !editor.inputs.isPen) {
      // Stay in the draw tool: freehand drawing is usually repeated.
    }
  }
}

/** Freehand drawing. */
export class DrawTool extends StateNode {
  static override id = "draw"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Drawing]
}
