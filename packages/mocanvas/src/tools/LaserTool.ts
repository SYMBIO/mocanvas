/**
 * The laser pointer.
 *
 * It draws, but it does not create anything: the trail is a *scribble*, which
 * lives on the `instance` record rather than in the document, is never
 * undoable, is never saved, and fades out on its own. That is what makes it
 * usable while presenting — you can wave it over someone else's board without
 * changing it — and it is also what makes a collaborator's laser visible
 * without a second transport, since presence carries the same record.
 */
import { StateNode, type PointerEventInfo, type StateNodeConstructor } from "@mocanvas/editor"

/**
 * How the trail looks and how it fades.
 *
 * SEMANTICS-ASSUMED: the docs describe the tool, not its numbers. `delay` is
 * the beat before the tail starts retracting — long enough that a slow circle
 * round something stays whole, short enough that the trail never becomes a
 * drawing — and `taper` narrows the tail so the head reads as the pointer.
 */
export const LASER_SCRIBBLE = {
  color: "laser",
  opacity: 0.7,
  size: 4,
  delay: 1200,
  shrink: 0.05,
  taper: true,
} as const

class Idle extends StateNode {
  static override id = "idle"
  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }
  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("lasering", info)
  }
  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

class Lasering extends StateNode {
  static override id = "lasering"

  override onEnter(): void {
    const { x, y } = this.editor.inputs.currentPagePoint
    const item = this.editor.scribbles.startSession({ ...LASER_SCRIBBLE })
    ;(this.parent as LaserTool).sessionId = item.id
    this.editor.scribbles.addPointToSession(x, y)
  }

  override onPointerMove(): void {
    const { x, y } = this.editor.inputs.currentPagePoint
    this.editor.scribbles.addPointToSession(x, y)
  }

  override onPointerUp(): void {
    this.complete()
  }

  override onComplete(): void {
    this.complete()
  }

  override onCancel(): void {
    this.complete()
  }

  /**
   * Let the trail fade rather than clearing it: the point of the gesture is
   * what it drew, and yanking it away the instant the pointer lifts loses the
   * end of every sweep.
   */
  private complete(): void {
    this.editor.scribbles.stopSession()
    ;(this.parent as LaserTool).sessionId = null
    this.parent!.transition("idle")
  }
}

/** Point at things: a fading trail that never becomes a shape. */
export class LaserTool extends StateNode {
  static override id = "laser"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Lasering]

  /** Set while a stroke is in progress; read through {@link getSessionId}. */
  sessionId: string | null = null

  /**
   * The id of the scribble this tool is currently drawing, or `null` when it is
   * idle — including while the last trail is still fading, which is a scribble
   * the tool no longer owns.
   *
   * Exposed so a renderer, an overlay or a test can address the live trail
   * without reaching into the manager's bookkeeping.
   */
  getSessionId(): string | null {
    return this.sessionId
  }
}
