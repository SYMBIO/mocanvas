import { Vec } from "../geometry"
import { EditorManager } from "./EditorManager"
import type { Editor } from "./Editor"
import type { ClickEventInfo, PointerEventInfo } from "./events"

/**
 * Where a click gesture currently is.
 *
 * `idle` — nothing in flight. `pendingDouble` — one full press/release has
 * happened and a second press soon enough, and close enough, would make it a
 * double click. `doubleClick` — the double click has been reported and the
 * gesture is finishing. `overflow` — more presses arrived inside the same
 * window; they are deliberately *not* reported as triple or quadruple clicks
 * (see {@link ClickEventName}), they simply stop counting until the window
 * lapses.
 */
export type TLClickState = "idle" | "pendingDouble" | "doubleClick" | "overflow"

/** The names {@link ClickManager} can emit. */
export type TLCLickEventName = "double_click"

/** The click event the manager produces, ready to dispatch. */
export type TLClickEventInfo = ClickEventInfo

/** A handler for a synthesised click event. */
export type TLClickEvent = (info: TLClickEventInfo) => void

/** How long after a press a second press still counts as a double click. */
const DEFAULT_DOUBLE_CLICK_DURATION_MS = 450

/**
 * How far the pointer may travel between the two presses of a double click.
 *
 * SEMANTICS-ASSUMED: 40 CSS px, measured in screen space so it means the same
 * thing at every zoom. The docs pin the *duration* (`doubleClickDurationMs`)
 * but not the distance; a distance test is still needed, because without one a
 * press on one side of the board and a press on the other within half a second
 * read as a double click on whatever happened to be under the second press.
 */
const DOUBLE_CLICK_DISTANCE = 40

/**
 * Turns a stream of pointer presses into double-click events.
 *
 * The editor's dispatch loop reports raw pointer downs and ups; deciding that
 * two of them are one gesture needs state — when the last press was, where it
 * was, and whether the gesture has already been reported. That state lives here
 * rather than on `Editor` so a tool, a test, or an overlay can drive the same
 * logic without one.
 *
 * The manager emits `down`, `up` and `settle` phases for a double click, in
 * that order: `down` when the second press lands, `up` when it is released, and
 * `settle` when the window lapses with no further press. A tool that acts on
 * `down` gets the responsive behaviour; one that must be sure no third press is
 * coming waits for `settle`.
 */
export class ClickManager extends EditorManager {
  /** The pointer event that opened the current gesture, if any. */
  lastPointerInfo: PointerEventInfo | undefined

  private state: TLClickState = "idle"
  private lastDownAt = 0
  private lastDownPoint = new Vec()
  private settleHandle: number | undefined

  constructor(
    editor: Editor,
    /** Where the synthesised click goes. Defaults to the editor's own dispatch. */
    private readonly emit: TLClickEvent = (info) => {
      editor.dispatch(info)
    },
  ) {
    super(editor)
    this.register(() => this.cancelDoubleClick())
  }

  /** How long a second press has to arrive in, from the editor's options. */
  private get durationMs(): number {
    const configured = (this.editor.options as { doubleClickDurationMs?: number }).doubleClickDurationMs
    return typeof configured === "number" ? configured : DEFAULT_DOUBLE_CLICK_DURATION_MS
  }

  /** The gesture's current phase. */
  get clickState(): TLClickState {
    return this.state
  }

  /**
   * Feed one pointer event in.
   *
   * Returns the click event it produced, or `undefined` when the event only
   * moved the state machine along. The event is also handed to the emitter, so
   * a caller that just wants the side effect can ignore the return value.
   */
  handlePointerEvent(info: PointerEventInfo): TLClickEventInfo | undefined {
    if (info.name === "pointer_down") return this.handleDown(info)
    if (info.name === "pointer_up") return this.handleUp(info)
    return undefined
  }

  private handleDown(info: PointerEventInfo): TLClickEventInfo | undefined {
    const now = timeNow()
    const point = new Vec(info.point.x, info.point.y)
    const inWindow = now - this.lastDownAt <= this.durationMs
    const nearby = Vec.Dist(point, this.lastDownPoint) <= DOUBLE_CLICK_DISTANCE

    this.lastPointerInfo = info
    this.lastDownAt = now
    this.lastDownPoint = point

    if (this.state === "pendingDouble" && inWindow && nearby) {
      this.state = "doubleClick"
      return this.fire(info, "down")
    }
    if (this.state === "doubleClick" || this.state === "overflow") {
      // A third press inside the window: stop counting rather than inventing a
      // triple click, and let the window lapse before a new gesture can start.
      this.state = "overflow"
      this.scheduleSettle()
      return undefined
    }
    this.state = "pendingDouble"
    this.scheduleSettle()
    return undefined
  }

  private handleUp(info: PointerEventInfo): TLClickEventInfo | undefined {
    if (this.state !== "doubleClick") return undefined
    return this.fire(info, "up")
  }

  private fire(info: PointerEventInfo, phase: ClickEventInfo["phase"]): TLClickEventInfo {
    const click: TLClickEventInfo = { ...info, type: "click", name: "double_click", phase }
    this.emit(click)
    return click
  }

  /**
   * Restart the window: the next press begins a new gesture rather than
   * completing the one in flight.
   *
   * A tool calls this after acting on a double click that changes what is under
   * the pointer — entering a label editor, say — so the release that follows is
   * not read as part of the same gesture.
   */
  cancelDoubleClick(): void {
    if (this.settleHandle !== undefined) {
      this.editor.timers.clearTimeout(this.settleHandle)
      this.settleHandle = undefined
    }
    this.state = "idle"
    this.lastDownAt = 0
    this.lastPointerInfo = undefined
  }

  /** Report `settle` once the window lapses with no further press. */
  private scheduleSettle(): void {
    if (this.settleHandle !== undefined) this.editor.timers.clearTimeout(this.settleHandle)
    this.settleHandle = this.editor.timers.setTimeout(() => {
      this.settleHandle = undefined
      const wasDouble = this.state === "doubleClick"
      const info = this.lastPointerInfo
      this.state = "idle"
      if (wasDouble && info) this.fire(info, "settle")
    }, this.durationMs)
  }
}

function timeNow(): number {
  return typeof globalThis.performance === "undefined" ? Date.now() : globalThis.performance.now()
}
