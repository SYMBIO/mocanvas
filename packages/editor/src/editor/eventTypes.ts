/**
 * The documented names for the editor's event vocabulary.
 *
 * `events.ts` defines the event *payloads* the dispatch loop actually carries.
 * This module names the handler types built on top of them, plus the map of
 * editor-level notifications a host subscribes to with `editor.on(...)`. They
 * are kept apart because a tool author writes handler types constantly and
 * should not have to import the emitter machinery to do it.
 */
import type {
  CancelEventInfo,
  ClickEventName,
  CompleteEventInfo,
  EditorEvents,
  EventInfo,
  InterruptEventInfo,
  KeyboardEventInfo,
  KeyboardEventName,
  PinchEventInfo,
  PointerEventInfo,
  PointerEventName,
  TickEventInfo,
  VecModel,
  WheelEventInfo,
} from "./events"
import type { ShapeId } from "../records/base"

/** The three phases of a pinch gesture. */
export type TLPinchEventName = "pinch_start" | "pinch" | "pinch_end"

/**
 * Every name a dispatched canvas event can carry.
 *
 * The union a tool switches on. It is deliberately flat rather than nested by
 * category: a state node's `handleEvent` sees one stream, and grouping the
 * names would only make the switch longer.
 */
export type TLEventName =
  | PointerEventName
  | ClickEventName
  | KeyboardEventName
  | TLPinchEventName
  | "wheel"
  | "cancel"
  | "complete"
  | "interrupt"
  | "tick"

/** What a pointer event happened *on*. The discriminator of the target union. */
export type TLPointerEventTarget = "canvas" | "shape" | "selection" | "handle"

/** A pointer-event handler, as a tool or shape util declares one. */
export type TLPointerEvent = (info: PointerEventInfo) => void
/** A keyboard-event handler. */
export type TLKeyboardEvent = (info: KeyboardEventInfo) => void
/** A wheel-event handler. */
export type TLWheelEvent = (info: WheelEventInfo) => void
/** A pinch-event handler. */
export type TLPinchEvent = (info: PinchEventInfo) => void
/** Called when the current gesture is abandoned — Escape, or a competing gesture. */
export type TLCancelEvent = (info: CancelEventInfo) => void
/** Called when the current gesture is committed — Enter, or a double click that ends it. */
export type TLCompleteEvent = (info: CompleteEventInfo) => void
/**
 * Called when something outside the tool takes over: a window blur, a
 * programmatic tool change, a store reset. Distinct from cancel, which the
 * person asked for.
 */
export type TLInterruptEvent = (info: InterruptEventInfo) => void
/** Called once per animation frame while the editor is running. */
export type TLTickEvent = (info: TickEventInfo) => void

/**
 * Called as a state node becomes active. `info` is whatever the transition
 * carried; `from` is the id of the state being left, so a shared state can
 * behave differently depending on where it was entered from.
 */
export type TLEnterEventHandler<Info = unknown> = (info: Info, from: string) => void

/** Called as a state node becomes inactive. `to` is the id of the state being entered. */
export type TLExitEventHandler<Info = unknown> = (info: Info, to: string) => void

/**
 * The editor-level notifications, by name, as argument tuples.
 *
 * These are *not* the canvas input events above — they are the things a host
 * app subscribes to: the document changed, a frame was drawn, the editor
 * mounted. `editor.on(name, handler)` is typed against this map.
 */
export interface TLEventMap {
  /** The editor's container is on screen. */
  mount: []
  /** The editor's container has gone away. Always paired with a `mount`. */
  unmount: []
  /** The document changed. `source` says whether this client or a peer did it. */
  change: [info: { source: "user" | "remote" }]
  /** Something the editor derives from the store changed. Coalesced per batch. */
  update: []
  /** A canvas input event was dispatched. */
  event: [info: EventInfo]
  /** One animation frame elapsed; the argument is milliseconds since the last. */
  tick: [elapsed: number]
  /** A frame was rendered. */
  frame: [info: { drawn: number; culled: number; ms: number }]
  /** A text shape asked for all of its text to be selected. */
  "select-all-text": [info: { shapeId: ShapeId }]
  /** A camera animation was cut short. */
  "stop-camera-animation": []
  /** This client stopped following another user. */
  "stop-following": []
  /** A page hit its shape limit; the payload names the page and the count. */
  "max-shapes": [info: { name: string; pageId: string; count: number }]
}

/** A handler for one entry of {@link TLEventMap}. */
export type TLEventMapHandler<T extends keyof TLEventMap> = (...args: TLEventMap[T]) => void

// The emitter and the documented map must describe the same events. If one
// gains a name the other does not have, this stops compiling.
type _EventMapMatchesEmitter = keyof EditorEvents extends keyof TLEventMap
  ? keyof TLEventMap extends keyof EditorEvents
    ? true
    : never
  : never
const _eventMapMatchesEmitter: _EventMapMatchesEmitter = true
void _eventMapMatchesEmitter

/**
 * How to move the editor's idea of where the pointer is without a real pointer
 * event having arrived.
 *
 * The case this exists for is a change that moves the world under a stationary
 * cursor — a camera animation, an undo that moves a shape, a page switch. The
 * pointer has not moved on screen, but it is over something different now, and
 * hover, hit testing and the active tool all need to be told.
 *
 * SEMANTICS-ASSUMED: the fields. The docs name the options bag but not its
 * members, so it carries the two things a caller can actually know — a screen
 * position to use instead of the last one, and whether the update should run
 * even when nothing appears to have changed.
 */
export interface TLUpdatePointerOptions {
  /**
   * Container-relative point to treat as the pointer position. Defaults to the
   * last position an event reported.
   */
  screenPoint?: VecModel
  /**
   * Re-run the update even when the pointer resolves to the same page point.
   * Needed after a change that moved shapes rather than the camera.
   */
  force?: boolean
}

/**
 * What a host's analytics hook receives.
 *
 * `onUiEvent` exists so an app can record what people do with the canvas. The
 * editor sends this nowhere on its own — it calls the host's function and
 * forgets it.
 */
export type UiEvent = {
  /** The action, e.g. `"select-tool"`, `"zoom-in"`, `"delete-shapes"`. */
  name: string
  /** Where it came from, plus whatever the emitting call site attached. */
  data: { source: string } & Record<string, unknown>
}

/** What is being written to the clipboard, before it is written. */
export interface TLClipboardWriteInfo {
  /** The serialized canvas content, or `undefined` when only text is going out. */
  content?: unknown
  /** Plain-text form of the same selection. */
  text?: string
  /** HTML form of the same selection. */
  html?: string
  /** Whether the selection is being removed as well as copied. */
  isCut: boolean
}

/**
 * The raw clipboard, before the editor has tried to make sense of it.
 *
 * Handed to `TldrawOptions.onClipboardPasteRaw`, which is the first thing to
 * see a paste. Returning `false` from that hook stops the editor's own parsing,
 * which is how an app pastes its private format without the canvas guessing at
 * it first.
 */
export type TLClipboardPasteRawInfo = {
  /** The clipboard data, when the browser gave the paste event one. */
  clipboardData: DataTransfer | null
  /** Where the paste should land, in page space. */
  point?: VecModel
  /** Which gesture produced the paste. */
  source: "keyboard" | "menu"
}
