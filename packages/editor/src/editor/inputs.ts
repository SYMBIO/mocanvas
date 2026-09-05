import { Vec } from "../geometry"

/**
 * Live pointer and modifier state.
 *
 * The `*ScreenPoint` members are in VIEWPORT space (container-relative
 * pixels), which is the space canvas events arrive in; `*PagePoint` are in
 * page space. For a window-relative point use `editor.pageToScreen(...)`.
 *
 * Every field also has a `get…()` accessor. The two are the same storage: the
 * field is what the editor's dispatch loop writes, the accessor is what
 * application code should read. Reading through the accessor is what lets the
 * state move behind a signal later without every call site changing — which is
 * the whole reason the accessors exist — so new code should prefer
 * `inputs.getCurrentPagePoint()` over `inputs.currentPagePoint`.
 */
export interface EditorInputs {
  originPagePoint: Vec
  originScreenPoint: Vec
  previousPagePoint: Vec
  previousScreenPoint: Vec
  currentPagePoint: Vec
  currentScreenPoint: Vec
  keys: Set<string>
  buttons: Set<number>
  isPen: boolean
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  accelKey: boolean
  isDragging: boolean
  isPointing: boolean
  isPinching: boolean
  isEditing: boolean
  isPanning: boolean
  pointerVelocity: Vec

  /** Page-space point the current gesture started at. */
  getOriginPagePoint(): Vec
  /** Viewport-space point the current gesture started at. */
  getOriginScreenPoint(): Vec
  /** Page-space pointer position at the previous event. */
  getPreviousPagePoint(): Vec
  /** Viewport-space pointer position at the previous event. */
  getPreviousScreenPoint(): Vec
  /** Page-space pointer position right now. */
  getCurrentPagePoint(): Vec
  /** Viewport-space pointer position right now. */
  getCurrentScreenPoint(): Vec
  /** Codes of the keys currently held down. */
  getKeys(): Set<string>
  /** Pointer buttons currently held down. */
  getButtons(): Set<number>
  /** Whether the active pointer is a pen. */
  getIsPen(): boolean
  getShiftKey(): boolean
  getCtrlKey(): boolean
  getAltKey(): boolean
  getMetaKey(): boolean
  /** The platform's "accelerator": `metaKey` on Apple platforms, `ctrlKey` elsewhere. */
  getAccelKey(): boolean
  /** Whether the pointer has moved far enough since going down to count as a drag. */
  getIsDragging(): boolean
  /** Whether a pointer button is down. */
  getIsPointing(): boolean
  getIsPinching(): boolean
  getIsEditing(): boolean
  getIsPanning(): boolean
  /** Pointer movement per millisecond, in page units. */
  getPointerVelocity(): Vec
}

/**
 * The editor's input state.
 *
 * A class rather than an object literal so the accessors above exist without
 * every construction site repeating them; the fields stay public and writable
 * because the dispatch loop assigns them directly on every event, and a
 * setter per field would buy nothing.
 */
export class InputsManager implements EditorInputs {
  originPagePoint = new Vec()
  originScreenPoint = new Vec()
  previousPagePoint = new Vec()
  previousScreenPoint = new Vec()
  currentPagePoint = new Vec()
  currentScreenPoint = new Vec()
  keys = new Set<string>()
  buttons = new Set<number>()
  isPen = false
  shiftKey = false
  ctrlKey = false
  altKey = false
  metaKey = false
  accelKey = false
  isDragging = false
  isPointing = false
  isPinching = false
  isEditing = false
  isPanning = false
  pointerVelocity = new Vec()

  getOriginPagePoint(): Vec {
    return this.originPagePoint
  }
  getOriginScreenPoint(): Vec {
    return this.originScreenPoint
  }
  getPreviousPagePoint(): Vec {
    return this.previousPagePoint
  }
  getPreviousScreenPoint(): Vec {
    return this.previousScreenPoint
  }
  getCurrentPagePoint(): Vec {
    return this.currentPagePoint
  }
  getCurrentScreenPoint(): Vec {
    return this.currentScreenPoint
  }
  getKeys(): Set<string> {
    return this.keys
  }
  getButtons(): Set<number> {
    return this.buttons
  }
  getIsPen(): boolean {
    return this.isPen
  }
  getShiftKey(): boolean {
    return this.shiftKey
  }
  getCtrlKey(): boolean {
    return this.ctrlKey
  }
  getAltKey(): boolean {
    return this.altKey
  }
  getMetaKey(): boolean {
    return this.metaKey
  }
  getAccelKey(): boolean {
    return this.accelKey
  }
  getIsDragging(): boolean {
    return this.isDragging
  }
  getIsPointing(): boolean {
    return this.isPointing
  }
  getIsPinching(): boolean {
    return this.isPinching
  }
  getIsEditing(): boolean {
    return this.isEditing
  }
  getIsPanning(): boolean {
    return this.isPanning
  }
  getPointerVelocity(): Vec {
    return this.pointerVelocity
  }
}
