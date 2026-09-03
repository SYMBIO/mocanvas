import { StateNode, Vec, type PointerEventInfo, type StateNodeConstructor } from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "grab", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("pointing", info)
  }
}

class Pointing extends StateNode {
  static override id = "pointing"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "grabbing", rotation: 0 } })
  }
  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("dragging")
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class Dragging extends StateNode {
  static override id = "dragging"
  override onPointerMove(): void {
    const { currentScreenPoint, previousScreenPoint } = this.editor.inputs
    this.editor.pan(Vec.Sub(currentScreenPoint, previousScreenPoint))
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

/** Pan the camera by dragging. */
export class HandTool extends StateNode {
  static override id = "hand"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing, Dragging]
}
