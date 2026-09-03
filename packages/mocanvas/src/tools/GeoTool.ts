import {
  createShapeId,
  GeoShapeGeoStyle,
  StateNode,
  type GeoShapeKind,
  type PointerEventInfo,
  type ShapeId,
  type StateNodeConstructor,
} from "@mocanvas/editor"

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
      // click without drag: create a default-sized shape centered on the point
      this.create()
      const shape = this.editor.getShape(this.shapeId!)!
      const { w, h } = shape.props as { w: number; h: number }
      const { originPagePoint } = this.editor.inputs
      this.editor.updateShape({ id: shape.id, type: shape.type, x: originPagePoint.x - w / 2, y: originPagePoint.y - h / 2 })
    }
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  override onComplete(): void {
    this.finish()
  }

  private create(): void {
    const editor = this.editor
    const geo = (this.parent as GeoTool).geo
    this.markId = editor.markHistoryStoppingPoint("create geo")
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    editor.createShape({
      id,
      type: "geo",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { geo, w: 100, h: 100 },
    })
    editor.select(id)
    this.shapeId = id
  }

  private resize(): void {
    const editor = this.editor
    const shape = editor.getShape(this.shapeId!)
    if (!shape) return
    const { originPagePoint, currentPagePoint, shiftKey, altKey } = editor.inputs
    let w = currentPagePoint.x - originPagePoint.x
    let h = currentPagePoint.y - originPagePoint.y
    if (shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    let x = originPagePoint.x
    let y = originPagePoint.y
    if (altKey) {
      x -= Math.abs(w)
      y -= Math.abs(h)
      w = Math.abs(w) * 2
      h = Math.abs(h) * 2
    } else {
      if (w < 0) x += w
      if (h < 0) y += h
    }
    editor.updateShape({ id: shape.id, type: "geo", x, y, props: { w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) } })
  }

  private finish(): void {
    const editor = this.editor
    const locked = editor.getInstanceState().isToolLocked
    this.parent!.transition("idle")
    if (!locked) editor.setCurrentTool("select")
  }
}

/** Draw a geo shape (rectangle, ellipse, ...) by dragging. Pick the kind with `editor.setCurrentTool('geo', { geo })`. */
export class GeoTool extends StateNode {
  static override id = "geo"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
  geo: GeoShapeKind = "rectangle"

  override onEnter(info: Record<string, unknown>): void {
    const geo = info["geo"]
    if (typeof geo === "string") this.geo = geo as GeoShapeKind
    else this.geo = this.editor.getStyleForNextShape(GeoShapeGeoStyle)
  }
}
