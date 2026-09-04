import type { RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import type { JsonObject, ShapeId } from "./base"
import type { BindingPropsForType } from "./props"

/** A directed relationship between two shapes (e.g. an arrow end attached to a shape). */
export interface BaseBinding<Type extends string, Props extends object> {
  readonly id: BindingId
  readonly typeName: "binding"
  type: Type
  fromId: ShapeId
  toId: ShapeId
  props: Props
  meta: JsonObject
}
export type UnknownBinding = BaseBinding<string, object>
/**
 * A binding record. Like {@link Shape}, naming the type resolves its props
 * through the augmentable `TLGlobalBindingPropsMap`; a bare `Binding`
 * keeps the open `object` props.
 */
export type Binding<Type extends string = string> = BaseBinding<Type, BindingPropsForType<Type>>
export type BindingId = RecordId<UnknownBinding>

export const BindingRecordType = createRecordType<UnknownBinding>("binding", { scope: "document" }).withDefaultProperties(
  () => ({ meta: {} }),
)

export function createBindingId(id?: string): BindingId {
  return BindingRecordType.createId(id) as BindingId
}
export function isBindingId(id: unknown): id is BindingId {
  return typeof id === "string" && id.startsWith("binding:")
}
export function isBinding(record: unknown): record is UnknownBinding {
  return typeof record === "object" && record !== null && (record as { typeName?: string }).typeName === "binding"
}

export type BindingCreate<B extends UnknownBinding = UnknownBinding> = {
  id?: BindingId
  type: B["type"]
  fromId: ShapeId
  toId: ShapeId
  props?: Partial<B["props"]>
  meta?: Partial<B["meta"]>
}

export type BindingPartial<B extends UnknownBinding = UnknownBinding> = {
  id: BindingId
  type: B["type"]
} & Partial<Omit<B, "id" | "type" | "props" | "meta">> & {
    props?: Partial<B["props"]>
    meta?: Partial<B["meta"]>
  }
