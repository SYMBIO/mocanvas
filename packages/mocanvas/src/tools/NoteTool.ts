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
    editor.createShape({
      id,
      type: "note",
      x: originPagePoint.x - 100,
      y: originPagePoint.y - 100,
      props: { ...(editor.getInstanceState().stylesForNextShape as object) },
    })
    editor.select(id)
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
