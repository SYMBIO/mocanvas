import { atom, computed, type Atom, type Computed } from "@mocanvas/state"
import type { Editor } from "../editor/Editor"
import {
  EVENT_NAME_MAP,
  type CancelEventInfo,
  type ClickEventInfo,
  type CompleteEventInfo,
  type EventHandlers,
  type EventInfo,
  type InterruptEventInfo,
  type KeyboardEventInfo,
  type PointerEventInfo,
  type TickEventInfo,
  type WheelEventInfo,
} from "../editor/events"

export type StateNodeType = "branch" | "leaf" | "root"

export interface StateNodeConstructor {
  new (editor: Editor, parent?: StateNode): StateNode
  id: string
  initial?: string
  children?(): StateNodeConstructor[]
  isLockable?: boolean
  useCoalescedEvents?: boolean
}

/**
 * A node in the tool state machine. Tools are trees of StateNodes: the root
 * holds one child per tool, each tool holds its own states.
 */
export abstract class StateNode {
  static id: string
  static initial?: string
  static children?: () => StateNodeConstructor[]
  static isLockable = true
  static useCoalescedEvents = false

  readonly id: string
  readonly type: StateNodeType
  readonly initial: string | undefined
  readonly children?: Record<string, StateNode>
  readonly parent: StateNode | undefined
  readonly editor: Editor
  private readonly _isActive: Atom<boolean>
  private readonly _current: Atom<StateNode | undefined>
  private readonly _path: Computed<string>
  /** Whether the shape kind this tool creates should be kept selected after creation etc. */
  shapeType?: string
  /** Tools can declare the interaction they perform when locked. */
  static get isLockableTool(): boolean {
    return this.isLockable
  }

  constructor(editor: Editor, parent?: StateNode) {
    const ctor = this.constructor as StateNodeConstructor
    this.editor = editor
    this.parent = parent
    this.id = ctor.id
    this._isActive = atom(`${this.id}.isActive`, false)
    this._current = atom<StateNode | undefined>(`${this.id}.current`, undefined)

    const childCtors = ctor.children?.()
    if (childCtors && childCtors.length > 0) {
      this.type = parent ? "branch" : "root"
      this.initial = ctor.initial
      const children: Record<string, StateNode> = {}
      for (const C of childCtors) {
        children[C.id] = new C(editor, this)
      }
      this.children = children
      if (this.type === "branch" && !this.initial) {
        throw new Error(`StateNode "${this.id}" has children but no initial state`)
      }
    } else {
      this.type = "leaf"
    }

    this._path = computed(`${this.id}.path`, () => {
      const cur = this._current.get()
      return `${this.id}${cur ? `.${cur.getPath()}` : ""}`
    })
  }

  getPath(): string {
    return this._path.get()
  }

  getCurrent(): StateNode | undefined {
    return this._current.get()
  }

  getIsActive(): boolean {
    return this._isActive.get()
  }

  getDescendant<T extends StateNode>(path: string): T | undefined {
    const [head, ...rest] = path.split(".")
    const child = head ? this.children?.[head] : undefined
    if (!child) return undefined
    return rest.length ? child.getDescendant<T>(rest.join(".")) : (child as T)
  }

  /** Dispatch an event to this node, then to its active child. */
  handleEvent(info: EventInfo): void {
    const handlerName = EVENT_NAME_MAP[info.name]
    const current = this._current.get()
    if (handlerName) {
      const handler = (this as unknown as Record<string, ((i: EventInfo) => void) | undefined>)[handlerName]
      handler?.call(this, info)
    }
    // The handler may have transitioned; only forward to the child that was active when we started.
    if (current && current === this._current.get() && current.getIsActive()) {
      current.handleEvent(info)
    }
  }

  /** Move this node's current child to `id`, exiting the old one and entering the new one. */
  transition(id: string, info: object = {}): this {
    if (!this.children) throw new Error(`StateNode "${this.id}" has no children to transition to`)
    const next = this.children[id]
    if (!next) throw new Error(`StateNode "${this.id}" has no child "${id}"`)
    const i = info as Record<string, unknown>
    const prev = this._current.get()
    if (prev) prev.exit(i, id)
    this._current.set(next)
    next.enter(i, prev?.id ?? "initial")
    return this
  }

  enter(info: Record<string, unknown>, from: string): void {
    this._isActive.set(true)
    this.onEnter?.(info, from)
    if (this.children && this.initial && this.getIsActive()) {
      const initialChild: StateNode | undefined = this.children[this.initial]
      if (!initialChild) throw new Error(`StateNode "${this.id}" initial child "${this.initial}" not found`)
      this._current.set(initialChild)
      initialChild.enter(info, from)
    }
  }

  exit(info: Record<string, unknown>, to: string): void {
    const cur = this._current.get()
    if (cur) cur.exit(info, to)
    this._current.set(undefined)
    this._isActive.set(false)
    this.onExit?.(info, to)
  }

  /** Change the active tool from anywhere in the tree. */
  setCurrentToolIdMask(_mask: string | undefined): void {
    // reserved for tools that mask their id (e.g. zoom tool inside select)
  }

  onEnter?(info: Record<string, unknown>, from: string): void
  onExit?(info: Record<string, unknown>, to: string): void

  // Event handlers (see EventHandlers). Declared optional so subclasses implement only what they need.
  onPointerDown?(info: PointerEventInfo): void
  onPointerMove?(info: PointerEventInfo): void
  onPointerUp?(info: PointerEventInfo): void
  onRightClick?(info: PointerEventInfo): void
  onMiddleClick?(info: PointerEventInfo): void
  onDoubleClick?(info: ClickEventInfo): void
  onTripleClick?(info: ClickEventInfo): void
  onQuadrupleClick?(info: ClickEventInfo): void
  onKeyDown?(info: KeyboardEventInfo): void
  onKeyUp?(info: KeyboardEventInfo): void
  onKeyRepeat?(info: KeyboardEventInfo): void
  onWheel?(info: WheelEventInfo): void
  onCancel?(info: CancelEventInfo): void
  onComplete?(info: CompleteEventInfo): void
  onInterrupt?(info: InterruptEventInfo): void
  onTick?(info: TickEventInfo): void
}

export type { EventHandlers }

/** Convenience for subclass typing. */
export type StateNodeClass = typeof StateNode & StateNodeConstructor
