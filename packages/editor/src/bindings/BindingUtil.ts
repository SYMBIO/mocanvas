import type { Editor } from "../editor/Editor"
import type { UnknownBinding } from "../records/binding"
import type { UnknownShape } from "../records/base"

export interface BindingUtilConstructor<B extends UnknownBinding = UnknownBinding, U extends BindingUtil<B> = BindingUtil<B>> {
  new (editor: Editor): U
  type: B["type"]
  props?: Record<string, unknown>
  migrations?: unknown
}

/**
 * What a shape is asked before a binding is made between it and another shape.
 *
 * v5 hands over the **records**, not their type names: a util that used to
 * branch on `toShapeType` now reads `toShape.type`, and one that needs more
 * than the type — a locked target, a prop, the parent — has it without a second
 * lookup through the editor.
 */
export interface BindingCanBindOptions<From extends UnknownShape = UnknownShape, To extends UnknownShape = UnknownShape> {
  /** The shape the binding starts at (`binding.fromId`). */
  fromShape: From
  /** The shape the binding ends at (`binding.toId`). */
  toShape: To
  /** The binding type about to be created. */
  bindingType: string
}

export interface BindingOnCreateOptions<B extends UnknownBinding> {
  binding: B
}
export interface BindingOnChangeOptions<B extends UnknownBinding> {
  bindingBefore: B
  bindingAfter: B
}
export interface BindingOnShapeChangeOptions<B extends UnknownBinding> {
  binding: B
  shapeBefore: UnknownShape
  shapeAfter: UnknownShape
  /** Why the shape changed: itself, or because an ancestor moved. */
  reason: "self" | "ancestry"
}
export interface BindingOnShapeIsolateOptions<B extends UnknownBinding> {
  binding: B
  /** The shape leaving this binding's context (deleted, or copied without its partner). */
  removedShape?: UnknownShape
}
export interface BindingOnShapeDeleteOptions<B extends UnknownBinding> {
  binding: B
  shape: UnknownShape
}
/**
 * What the binding's own delete callbacks are told.
 *
 * Deliberately just the binding: `onBeforeDelete` fires because the *binding*
 * record is going away, which happens for reasons that have nothing to do with
 * either shape — an explicit `deleteBinding`, a store reset, a peer's edit
 * arriving. When a *shape* is what is being deleted, the callback is
 * `onBeforeDeleteFromShape` / `onBeforeDeleteToShape`, and it is told which.
 */
export interface BindingOnDeleteOptions<B extends UnknownBinding> {
  binding: B
}

/**
 * Describes how a binding type behaves. One instance per binding type per editor.
 * Callbacks run inside the store transaction that caused them.
 */
export abstract class BindingUtil<B extends UnknownBinding = UnknownBinding> {
  static type: string
  static props?: Record<string, unknown>
  static migrations?: unknown

  constructor(readonly editor: Editor) {}

  get type(): B["type"] {
    return (this.constructor as BindingUtilConstructor<B>).type
  }

  abstract getDefaultProps(): Partial<B["props"]>

  /**
   * Whether this binding type may connect these two shapes.
   *
   * Consulted alongside `ShapeUtil.canBind`, which asks the same question from
   * the shape's side; both must say yes.
   */
  canBind?(options: BindingCanBindOptions): boolean

  onBeforeCreate?(options: BindingOnCreateOptions<B>): B | void
  onAfterCreate?(options: BindingOnCreateOptions<B>): void
  onBeforeChange?(options: BindingOnChangeOptions<B>): B | void
  onAfterChange?(options: BindingOnChangeOptions<B>): void
  onBeforeDelete?(options: BindingOnDeleteOptions<B>): void
  onAfterDelete?(options: BindingOnDeleteOptions<B>): void
  /** The `from` shape changed (moved, resized, ...). */
  onAfterChangeFromShape?(options: BindingOnShapeChangeOptions<B>): void
  /** The `to` shape changed. */
  onAfterChangeToShape?(options: BindingOnShapeChangeOptions<B>): void
  /** The `from` shape is about to be deleted; the binding is deleted right after. */
  onBeforeDeleteFromShape?(options: BindingOnShapeDeleteOptions<B>): void
  /** The `to` shape is about to be deleted; the binding is deleted right after. */
  onBeforeDeleteToShape?(options: BindingOnShapeDeleteOptions<B>): void
  /** The `from` shape is being isolated (partner going away); typically the binding converts to a static value. */
  onBeforeIsolateFromShape?(options: BindingOnShapeIsolateOptions<B>): void
  onBeforeIsolateToShape?(options: BindingOnShapeIsolateOptions<B>): void
}
