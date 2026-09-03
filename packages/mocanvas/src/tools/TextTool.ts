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
    editor.markHistoryStoppingPoint("create text")
    const id = createShapeId()
    editor.createShape({
      id,
      type: "text",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { text: "", autoSize: true },
    })
    editor.select(id)
    editor.setEditingShape(id)
    if (!editor.getInstanceState().isToolLocked) editor.setCurrentTool("select")
  }

  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

/** Click to place a text shape and start typing. */
export class TextTool extends StateNode {
  static override id = "text"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle]
}
