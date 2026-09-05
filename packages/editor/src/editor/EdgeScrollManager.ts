/**
 * Panning the camera when a drag reaches the edge of the viewport.
 *
 * Without it a board is only as big as the window during any gesture: you
 * cannot drag a shape somewhere you cannot already see, and a marquee cannot
 * reach past the edge. The manager watches the pointer during a gesture and
 * pans towards whichever edges it is near.
 *
 * Four options shape the feel, and all four matter:
 *   `edgeScrollDistance`  — how close to the edge counts as "at" it.
 *   `edgeScrollDelay`     — how long the pointer must sit there before panning
 *                           starts, so brushing the edge does not fling you.
 *   `edgeScrollEaseDuration` — how long the speed takes to reach full, so the
 *                           start is not a jolt.
 *   `edgeScrollSpeed`     — screen pixels per frame at full speed.
 *
 * The editor drives it from its tick; nothing here schedules its own work.
 */
import { Vec } from "../geometry"
import { EditorManager } from "./EditorManager"
import type { Editor } from "./Editor"

export class EdgeScrollManager extends EditorManager {
  /** Milliseconds the pointer has spent within the edge band, per axis. */
  private timeInEdge = 0
  private enabled = false

  constructor(editor: Editor) {
    super(editor)
    this.register(() => this.stop())
  }

  /**
   * Turn edge scrolling on for the duration of a gesture. Tools call this when
   * a drag that can move things starts, and {@link stop} when it ends.
   */
  start(): void {
    this.enabled = true
    this.timeInEdge = 0
  }

  /** Turn edge scrolling off and forget how long the pointer has been at an edge. */
  stop(): void {
    this.enabled = false
    this.timeInEdge = 0
  }

  /** Whether a gesture has asked for edge scrolling. */
  getIsEnabled(): boolean {
    return this.enabled
  }

  /**
   * Advance edge scrolling by `elapsed` milliseconds and pan if it is due.
   *
   * Returns the screen-space offset it applied, which is `{x: 0, y: 0}` when
   * the pointer is not at an edge, the delay has not elapsed, or the camera is
   * locked — so a tool can use the return value to move the shape it is
   * dragging by the same amount and keep it under the cursor.
   */
  updateEdgeScrolling(elapsed: number): Vec {
    const none = new Vec(0, 0)
    if (!this.enabled || this.getIsDisposed()) return none
    if (this.editor.getCameraOptions().isLocked) return none

    const direction = this.getEdgeDirection()
    if (direction.x === 0 && direction.y === 0) {
      this.timeInEdge = 0
      return none
    }

    this.timeInEdge += elapsed
    const { edgeScrollDelay, edgeScrollEaseDuration, edgeScrollSpeed } = this.editor.options
    const past = this.timeInEdge - edgeScrollDelay
    if (past <= 0) return none

    const ease = edgeScrollEaseDuration > 0 ? Math.min(1, past / edgeScrollEaseDuration) : 1
    const step = edgeScrollSpeed * ease * (elapsed / 16)
    // The camera moves the opposite way to the direction the pointer is pushing:
    // pushing right must bring content in from the right, i.e. pan left.
    const offset = new Vec(-direction.x * step, -direction.y * step)
    this.editor.pan(offset)
    return offset
  }

  /**
   * Which way the pointer is pushing, as a unit-ish vector whose components are
   * `-1`, `0` or `1` scaled by how deep into the edge band the pointer is.
   *
   * Proportional rather than binary so a pointer pressed hard against the very
   * edge scrolls faster than one just inside the band — the behaviour that lets
   * a person control the speed without a modifier key.
   */
  private getEdgeDirection(): Vec {
    const { edgeScrollDistance } = this.editor.options
    if (edgeScrollDistance <= 0) return new Vec(0, 0)
    const viewport = this.editor.getViewportScreenBounds()
    const point = this.editor.inputs.currentScreenPoint

    const depth = (near: number, far: number): number => {
      if (near < edgeScrollDistance) return -(1 - Math.max(0, near) / edgeScrollDistance)
      if (far < edgeScrollDistance) return 1 - Math.max(0, far) / edgeScrollDistance
      return 0
    }
    return new Vec(
      depth(point.x, viewport.w - point.x),
      depth(point.y, viewport.h - point.y),
    )
  }
}
