import { createShapeId, StateNode, type PointerEventInfo, type StateNodeConstructor } from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    const editor = this.editor
    const { originPagePoint } = editor.inputs
    editor.markHistoryStoppingPoint("create note")
    const id = createShapeId()
    editor.createShape({ id, type: "note", x: originPagePoint.x, y: originPagePoint.y })
    // Centre on the size the note actually has, not on half of the unscaled 200:
    // `scale` makes a note bigger without changing `NOTE_SIZE`, so a scaled one
    // landed with its top-left corner near the cursor instead of its middle.
    const bounds = editor.getShapePageBounds(id)
    if (bounds) {
      editor.updateShape({ id, type: "note", x: originPagePoint.x - bounds.w / 2, y: originPagePoint.y - bounds.h / 2 })
    }
    editor.select(id)
    editor.setEditingShape(id)
    if (!editor.getInstanceState().isToolLocked) editor.setCurrentTool("select")
  }
  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

/** Click to place a sticky note. */
export class NoteTool extends StateNode {
  static override id = "note"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle]
}
