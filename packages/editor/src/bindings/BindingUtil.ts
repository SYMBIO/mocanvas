import type { Editor } from "../editor/Editor"
import type { UnknownBinding } from "../records/binding"
import type { UnknownShape } from "../records/base"

export interface BindingUtilConstructor<B extends UnknownBinding = UnknownBinding, U extends BindingUtil<B> = BindingUtil<B>> {
  new (editor: Editor): U
  type: B["type"]
  props?: Record<string, unknown>
  migrations?: unknown
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

  onBeforeCreate?(options: BindingOnCreateOptions<B>): B | void
  onAfterCreate?(options: BindingOnCreateOptions<B>): void
  onBeforeChange?(options: BindingOnChangeOptions<B>): B | void
  onAfterChange?(options: BindingOnChangeOptions<B>): void
  onBeforeDelete?(options: { binding: B }): void
  onAfterDelete?(options: { binding: B }): void
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
