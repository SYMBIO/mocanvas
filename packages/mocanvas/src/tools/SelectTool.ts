import {
  Box,
  StateNode,
  Vec,
  type ClickEventInfo,
  type KeyboardEventInfo,
  type PointerEventInfo,
  type ShapeId,
  type ShapePartial,
  type StateNodeConstructor,
  type UnknownShape,
} from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "default", rotation: 0 } })
  }

  override onPointerMove(info: PointerEventInfo): void {
    const hovered = info.target === "shape" ? info.shape : undefined
    this.editor.setHoveredShape(hovered && !this.editor.isShapeOrAncestorLocked(hovered) ? hovered.id : null)
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    switch (info.target) {
      case "canvas": {
        this.parent!.transition("pointing_canvas", info)
        break
      }
      case "shape": {
        if (this.editor.isShapeOrAncestorLocked(info.shape)) {
          this.parent!.transition("pointing_canvas", info)
          return
        }
        this.parent!.transition("pointing_shape", info)
        break
      }
      default:
        break
    }
  }

  override onDoubleClick(info: ClickEventInfo): void {
    if (info.target !== "shape") return
    const shape = info.shape
    const util = this.editor.getShapeUtil(shape)
    if (util.canEdit(shape) && !this.editor.isShapeOrAncestorLocked(shape)) {
      this.editor.select(shape.id)
      this.editor.setEditingShape(shape.id)
    } else {
      const change = util.onDoubleClick?.(shape)
      if (change) this.editor.updateShape({ id: shape.id, type: shape.type, ...change })
    }
  }

  override onKeyDown(info: KeyboardEventInfo): void {
    const editor = this.editor
    switch (info.key) {
      case "Delete":
      case "Backspace": {
        const ids = editor.getSelectedShapeIds()
        if (ids.length) {
          editor.markHistoryStoppingPoint("delete")
          editor.deleteShapes(ids)
        }
        break
      }
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const ids = editor.getSelectedShapeIds()
        if (!ids.length) return
        const step = info.shiftKey ? 10 : 1
        const d = new Vec(
          info.key === "ArrowLeft" ? -step : info.key === "ArrowRight" ? step : 0,
          info.key === "ArrowUp" ? -step : info.key === "ArrowDown" ? step : 0,
        )
        editor.markHistoryStoppingPoint("nudge")
        editor.updateShapes(
          ids.map((id) => {
            const s = editor.getShape(id)!
            return { id, type: s.type, x: s.x + d.x, y: s.y + d.y }
          }),
        )
        break
      }
      case "Escape": {
        if (editor.getEditingShapeId()) editor.setEditingShape(null)
        else editor.selectNone()
        break
      }
      default:
        break
    }
  }

  override onCancel(): void {
    if (this.editor.getEditingShapeId()) this.editor.setEditingShape(null)
    else this.editor.selectNone()
  }
}

class PointingCanvas extends StateNode {
  static override id = "pointing_canvas"

  override onEnter(): void {
    if (!this.editor.inputs.shiftKey) {
      if (this.editor.getEditingShapeId()) this.editor.setEditingShape(null)
      this.editor.selectNone()
    }
  }

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("brushing")
  }

  override onPointerUp(): void {
    this.parent!.transition("idle")
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class Brushing extends StateNode {
  static override id = "brushing"
  private initialSelection: ShapeId[] = []

  override onEnter(): void {
    this.initialSelection = this.editor.inputs.shiftKey ? this.editor.getSelectedShapeIds() : []
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }

  override onPointerUp(): void {
    this.finish()
  }

  override onCancel(): void {
    this.editor.setSelectedShapes(this.initialSelection)
    this.finish()
  }

  override onExit(): void {
    this.editor.updateInstanceState({ brush: null })
  }

  private update(): void {
    const { originPagePoint, currentPagePoint, ctrlKey } = this.editor.inputs
    const box = Box.FromPoints([originPagePoint, currentPagePoint])
    this.editor.updateInstanceState({ brush: box.toJson() })
    const hits = ctrlKey ? this.editor.getShapesInsideBounds(box) : this.editor.getShapesIntersectingBounds(box)
    const pageId = this.editor.getCurrentPageId()
    const ids = new Set<ShapeId>(this.initialSelection)
    for (const s of hits) {
      if (s.isLocked) continue
      // select top-level ancestors only
      let top: UnknownShape = s
      while (top.parentId !== pageId) {
        const p = this.editor.getShape(top.parentId as ShapeId)
        if (!p) break
        top = p
      }
      ids.add(top.id)
    }
    this.editor.setSelectedShapes([...ids])
  }

  private finish(): void {
    this.parent!.transition("idle")
  }
}

class PointingShape extends StateNode {
  static override id = "pointing_shape"
  private hitShape: UnknownShape | undefined
  private wasSelected = false

  override onEnter(info: Record<string, unknown>): void {
    const shape = (info as { shape?: UnknownShape }).shape
    this.hitShape = shape
    if (!shape) return
    const editor = this.editor
    const selected = editor.getSelectedShapeIds()
    this.wasSelected = selected.includes(shape.id)
    if (editor.inputs.shiftKey) {
      if (!this.wasSelected) editor.setSelectedShapes([...selected, shape.id])
    } else if (!this.wasSelected) {
      editor.setSelectedShapes([shape.id])
    }
  }

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) {
      this.parent!.transition("translating")
    }
  }

  override onPointerUp(): void {
    const editor = this.editor
    if (editor.inputs.shiftKey && this.wasSelected && this.hitShape) {
      editor.setSelectedShapes(editor.getSelectedShapeIds().filter((id) => id !== this.hitShape!.id))
    }
    this.parent!.transition("idle")
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class Translating extends StateNode {
  static override id = "translating"
  private initialShapes = new Map<ShapeId, UnknownShape>()
  private markId = ""

  override onEnter(): void {
    const editor = this.editor
    this.markId = editor.markHistoryStoppingPoint("translate")
    this.initialShapes.clear()
    for (const s of editor.getSelectedShapes()) {
      this.initialShapes.set(s.id, s)
      editor.getShapeUtil(s).onTranslateStart?.(s)
    }
    editor.updateInstanceState({ cursor: { type: "move", rotation: 0 } })
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
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  override onKeyDown(info: KeyboardEventInfo): void {
    if (info.key === "Shift" || info.key === "Alt") this.update()
  }

  override onKeyUp(info: KeyboardEventInfo): void {
    if (info.key === "Shift" || info.key === "Alt") this.update()
  }

  private update(): void {
    const editor = this.editor
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let delta = Vec.Sub(currentPagePoint, originPagePoint)
    if (shiftKey) {
      // lock to the dominant axis
      if (Math.abs(delta.x) > Math.abs(delta.y)) delta = new Vec(delta.x, 0)
      else delta = new Vec(0, delta.y)
    }
    const updates: ShapePartial[] = []
    for (const [id, initial] of this.initialShapes) {
      // delta is in page space; convert to parent space for nested shapes
      const parent = editor.getShapeParent(initial)
      let d = delta
      if (parent) {
        const m = editor.getShapePageTransform(parent)
        const det = m.a * m.d - m.b * m.c || 1
        d = new Vec((m.d * delta.x - m.c * delta.y) / det, (-m.b * delta.x + m.a * delta.y) / det)
      }
      const next = { ...initial, x: initial.x + d.x, y: initial.y + d.y }
      const change = editor.getShapeUtil(initial).onTranslate?.(initial, next)
      updates.push({ id, type: initial.type, x: next.x, y: next.y, ...(change ?? {}) })
    }
    editor.updateShapes(updates)
  }

  private complete(): void {
    const editor = this.editor
    for (const [id, initial] of this.initialShapes) {
      const current = editor.getShape(id)
      if (current) {
        const change = editor.getShapeUtil(initial).onTranslateEnd?.(initial, current)
        if (change) editor.updateShape({ id, type: initial.type, ...change })
      }
    }
    this.parent!.transition("idle")
  }
}

/** Selection, brush select, and drag-to-move. Resize and rotate handles arrive in phase 2. */
export class SelectTool extends StateNode {
  static override id = "select"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, PointingCanvas, Brushing, PointingShape, Translating]
}
