import { StateNode, type StateNodeConstructor } from "./StateNode"
import type { KeyboardEventInfo } from "../editor/events"

/** The root of the tool tree. Its children are the tools. */
export class RootState extends StateNode {
  static override id = "root"
  static override initial = ""
  static override children = (): StateNodeConstructor[] => []

  override onKeyDown(info: KeyboardEventInfo): void {
    if (info.key === "Escape" && !this.editor.getEditingShapeId()) {
      this.editor.cancel()
    }
  }
}

/** Build a root state class with the given tools and initial tool id. */
export function createRootState(tools: readonly StateNodeConstructor[], initial: string): StateNodeConstructor {
  class Root extends RootState {
    static override id = "root"
    static override initial = initial
    static override children = (): StateNodeConstructor[] => [...tools]
  }
  return Root
}
