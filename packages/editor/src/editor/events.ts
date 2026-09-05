import type { ShapeId, UnknownShape } from "../records/base"

export interface VecModel {
  x: number
  y: number
  z?: number
}

export type UiEventType = "pointer" | "click" | "keyboard" | "wheel" | "pinch" | "cancel" | "complete" | "interrupt" | "tick" | "misc"

export type PointerEventName = "pointer_down" | "pointer_move" | "pointer_up" | "right_click" | "middle_click"
/**
 * The only multi-click the editor reports. Triple and quadruple click were
 * removed: they were never distinguishable from a fast double click on a
 * trackpad, and every consumer that wanted "select the paragraph" ended up
 * reimplementing it against the text layer anyway.
 */
export type ClickEventName = "double_click"
export type KeyboardEventName = "key_down" | "key_up" | "key_repeat"

export type PointerTarget =
  | { target: "canvas" }
  | { target: "shape"; shape: UnknownShape }
  | { target: "selection"; handle?: SelectionHandle }
  | { target: "handle"; shape: UnknownShape; handle: ShapeHandle }

export type SelectionHandle =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "rotate"
  | "mobile_rotate"
  | "top_left_rotate"
  | "top_right_rotate"
  | "bottom_left_rotate"
  | "bottom_right_rotate"

export interface ShapeHandle {
  id: string
  type: "vertex" | "virtual" | "create" | "clone"
  index: string
  x: number
  y: number
}

export interface BaseEventInfo {
  type: UiEventType
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  accelKey: boolean
}

export type PointerEventInfo = BaseEventInfo &
  PointerTarget & {
    type: "pointer"
    name: PointerEventName
    point: VecModel
    pointerId: number
    button: number
    isPen: boolean
  }

export type ClickEventInfo = BaseEventInfo &
  PointerTarget & {
    type: "click"
    name: ClickEventName
    point: VecModel
    pointerId: number
    button: number
    isPen: boolean
    phase: "down" | "up" | "settle"
  }

export interface KeyboardEventInfo extends BaseEventInfo {
  type: "keyboard"
  name: KeyboardEventName
  key: string
  code: string
}

export interface WheelEventInfo extends BaseEventInfo {
  type: "wheel"
  name: "wheel"
  delta: VecModel
  point: VecModel
}

export interface PinchEventInfo extends BaseEventInfo {
  type: "pinch"
  name: "pinch_start" | "pinch" | "pinch_end"
  point: VecModel
  delta: VecModel
}

export interface CancelEventInfo extends BaseEventInfo {
  type: "cancel"
  name: "cancel"
}
export interface CompleteEventInfo extends BaseEventInfo {
  type: "complete"
  name: "complete"
}
export interface InterruptEventInfo extends BaseEventInfo {
  type: "interrupt"
  name: "interrupt"
}
export interface TickEventInfo extends BaseEventInfo {
  type: "tick"
  name: "tick"
  elapsed: number
}

export type EventInfo =
  | PointerEventInfo
  | ClickEventInfo
  | KeyboardEventInfo
  | WheelEventInfo
  | PinchEventInfo
  | CancelEventInfo
  | CompleteEventInfo
  | InterruptEventInfo
  | TickEventInfo

export type EventHandlers = {
  onPointerDown?(info: PointerEventInfo): void
  onPointerMove?(info: PointerEventInfo): void
  onPointerUp?(info: PointerEventInfo): void
  onRightClick?(info: PointerEventInfo): void
  onMiddleClick?(info: PointerEventInfo): void
  onDoubleClick?(info: ClickEventInfo): void
  onKeyDown?(info: KeyboardEventInfo): void
  onKeyUp?(info: KeyboardEventInfo): void
  onKeyRepeat?(info: KeyboardEventInfo): void
  onWheel?(info: WheelEventInfo): void
  onCancel?(info: CancelEventInfo): void
  onComplete?(info: CompleteEventInfo): void
  onInterrupt?(info: InterruptEventInfo): void
  onTick?(info: TickEventInfo): void
}

export const EVENT_NAME_MAP: Record<string, keyof EventHandlers> = {
  pointer_down: "onPointerDown",
  pointer_move: "onPointerMove",
  pointer_up: "onPointerUp",
  right_click: "onRightClick",
  middle_click: "onMiddleClick",
  double_click: "onDoubleClick",
  key_down: "onKeyDown",
  key_up: "onKeyUp",
  key_repeat: "onKeyRepeat",
  wheel: "onWheel",
  cancel: "onCancel",
  complete: "onComplete",
  interrupt: "onInterrupt",
  tick: "onTick",
}

export interface EditorEvents {
  /**
   * The editor is on screen. A host emits this once its container is attached;
   * `Editor.getIsMounted()` is derived from it.
   */
  mount: () => void
  /**
   * The editor is no longer on screen. Emitted by a host that unmounts an
   * editor it intends to keep, and by `Editor.dispose()` for one that was
   * mounted — so a listener never sees a mount without a matching unmount.
   */
  unmount: () => void
  "max-shapes": (info: { name: string; pageId: string; count: number }) => void
  change: (info: { source: "user" | "remote" }) => void
  update: () => void
  event: (info: EventInfo) => void
  tick: (elapsed: number) => void
  frame: (info: { drawn: number; culled: number; ms: number }) => void
  "select-all-text": (info: { shapeId: ShapeId }) => void
  "stop-camera-animation": () => void
  "stop-following": () => void
}

type Listener<T extends unknown[]> = (...args: T) => void

/** Minimal typed event emitter. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<Events extends { [K in keyof Events]: (...args: any[]) => void }> {
  private listeners = new Map<keyof Events, Set<Listener<never[]>>>()

  on<K extends keyof Events>(name: K, fn: Events[K]): () => void {
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    set.add(fn as Listener<never[]>)
    return () => this.off(name, fn)
  }

  once<K extends keyof Events>(name: K, fn: Events[K]): () => void {
    const off = this.on(name, ((...args: never[]) => {
      off()
      ;(fn as Listener<never[]>)(...args)
    }) as Events[K])
    return off
  }

  off<K extends keyof Events>(name: K, fn: Events[K]): void {
    this.listeners.get(name)?.delete(fn as Listener<never[]>)
  }

  emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void {
    const set = this.listeners.get(name)
    if (!set) return
    for (const fn of Array.from(set)) (fn as unknown as Listener<Parameters<Events[K]>>)(...args)
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
