import { StateNode, type PointerEventInfo, type ShapeId, type StateNodeConstructor } from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("erasing", info)
  }
  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

class Erasing extends StateNode {
  static override id = "erasing"
  private erasing = new Set<ShapeId>()
  private markId = ""

  override onEnter(): void {
    this.erasing.clear()
    this.markId = this.editor.markHistoryStoppingPoint("erase")
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }

  override onPointerUp(): void {
    this.complete()
  }

  override onComplete(): void {
    this.complete()
  }

  override onCancel(): void {
    this.editor.setErasingShapes([])
    this.parent!.transition("idle")
  }

  private update(): void {
    const editor = this.editor
    const { currentPagePoint, previousPagePoint } = editor.inputs
    const minX = Math.min(currentPagePoint.x, previousPagePoint.x)
    const minY = Math.min(currentPagePoint.y, previousPagePoint.y)
    const box = {
      x: minX,
      y: minY,
      w: Math.abs(currentPagePoint.x - previousPagePoint.x),
      h: Math.abs(currentPagePoint.y - previousPagePoint.y),
    }
    const margin = 8 / editor.getZoomLevel()
    const hits = editor.getShapesIntersectingBounds({ x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin })
    let changed = false
    for (const s of hits) {
      if (s.isLocked || this.erasing.has(s.id)) continue
      this.erasing.add(s.id)
      changed = true
    }
    if (changed) editor.setErasingShapes([...this.erasing])
  }

  private complete(): void {
    const editor = this.editor
    const ids = [...this.erasing]
    editor.setErasingShapes([])
    if (ids.length) editor.deleteShapes(ids)
    this.parent!.transition("idle")
  }
}

/** Delete shapes by dragging over them. */
export class EraserTool extends StateNode {
  static override id = "eraser"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Erasing]
}
