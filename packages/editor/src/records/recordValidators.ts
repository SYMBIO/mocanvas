/**
 * Validator factories for the four record kinds an app can extend: shapes,
 * bindings, assets and custom records.
 *
 * Each takes the *props* the type declares and wraps them in the rest of the
 * record — the id, the `typeName`, the fields every record of that kind has.
 * That split is deliberate: an app author writes the part that is theirs, and
 * never has to restate that a shape has an `x`, a `rotation` and an `index`,
 * nor get the id prefix right.
 *
 * The resulting validator is what the schema runs on load, on every create and
 * on every update, so a document cannot acquire a shape whose props are the
 * wrong shape and then fail to open next week.
 */

import { T } from "../validation/T"
import type { Validatable, Validator } from "../validation/validator"
import type { BaseShape, ShapeId } from "./base"
import type { BaseBinding, BindingId } from "./binding"
import type { AssetId, BaseAsset } from "./asset"
import { CUSTOM_RECORD_TYPE_NAME, type TLCustomRecord, type TLCustomRecordId } from "./customRecord"

import { opacityValidator } from "./uiValues"
import { parentIdValidator } from "./idValidators"
import type { UnknownRecordProps } from "./props"

/**
 * A props map as the factories accept it: one validator (or {@link StyleProp})
 * per prop.
 */
type PropsMap = UnknownRecordProps | Record<string, Validatable<unknown>>

function propsValidator(props: PropsMap): Validator<unknown> {
  return T.object(props as Record<string, Validatable<unknown>>) as unknown as Validator<unknown>
}

/**
 * The validator for a shape type, from its `static props`.
 *
 * ```ts
 * const formatShapeValidator = createShapeValidator("format", {
 *   w: T.nonZeroNumber,
 *   h: T.nonZeroNumber,
 *   color: DefaultColorStyle,
 * })
 * ```
 */
export function createShapeValidator<Type extends string, Props extends object>(
  type: Type,
  props: PropsMap,
  meta?: PropsMap,
): Validator<BaseShape<Type, Props>> {
  return T.model(
    `shape:${type}`,
    T.object({
      id: T.idOfType<ShapeId>("shape"),
      typeName: T.literal("shape"),
      type: T.literal(type),
      x: T.number,
      y: T.number,
      rotation: T.number,
      index: T.indexKey,
      parentId: parentIdValidator,
      isLocked: T.boolean,
      opacity: opacityValidator,
      props: propsValidator(props),
      meta: meta ? propsValidator(meta) : T.jsonObject,
    }),
    // The config above describes exactly the record type named, but `T.object`
    // infers a structurally equal-yet-distinct type (mutable `id`, a
    // `Record<string, unknown>` meta) and `Validator` is invariant in its
    // parameter. Restate what was actually built.
  ) as unknown as Validator<BaseShape<Type, Props>>
}

/**
 * The validator for a binding type, from its `static props`.
 *
 * A binding is two shape ids and a props bag; `fromId` and `toId` are validated
 * as shape ids rather than as strings because a binding pointing at a page is
 * the kind of corruption that only shows up when something tries to render it.
 */
export function createBindingValidator<Type extends string, Props extends object>(
  type: Type,
  props: PropsMap,
  meta?: PropsMap,
): Validator<BaseBinding<Type, Props>> {
  return T.model(
    `binding:${type}`,
    T.object({
      id: T.idOfType<BindingId>("binding"),
      typeName: T.literal("binding"),
      type: T.literal(type),
      fromId: T.idOfType<ShapeId>("shape"),
      toId: T.idOfType<ShapeId>("shape"),
      props: propsValidator(props),
      meta: meta ? propsValidator(meta) : T.jsonObject,
    }),
  ) as unknown as Validator<BaseBinding<Type, Props>>
}

/**
 * The validator for an asset type, from its props.
 *
 * Assets have no geometry and no parent — they are the bytes a shape points
 * at — so this is the smallest of the four.
 */
export function createAssetValidator<Type extends string, Props extends object>(
  type: Type,
  props: PropsMap,
  meta?: PropsMap,
): Validator<BaseAsset<Type, Props>> {
  return T.model(
    `asset:${type}`,
    T.object({
      id: T.idOfType<AssetId>("asset"),
      typeName: T.literal("asset"),
      type: T.literal(type),
      props: propsValidator(props),
      meta: meta ? propsValidator(meta) : T.jsonObject,
    }),
  ) as unknown as Validator<BaseAsset<Type, Props>>
}

/**
 * The validator for a custom record type, from its props.
 *
 * Note the id: a custom record's id carries its type (`custom:review:…`), so
 * the validator checks the whole prefix rather than just `custom:`. An id from
 * one custom type must not validate as another's.
 */
export function createCustomRecordValidator<Type extends string>(
  type: Type,
  props: PropsMap,
  meta?: PropsMap,
): Validator<TLCustomRecord<Type>> {
  const idPrefix = `${CUSTOM_RECORD_TYPE_NAME}:${type}:`
  return T.model(
    `custom:${type}`,
    T.object({
      id: T.string.refine((value) => {
        if (!value.startsWith(idPrefix) || value.length <= idPrefix.length) {
          throw new Error(`Expected a ${type} custom record id, got ${JSON.stringify(value)}`)
        }
        return value as TLCustomRecordId<Type>
      }),
      typeName: T.literal(CUSTOM_RECORD_TYPE_NAME),
      type: T.literal(type),
      props: propsValidator(props),
      meta: meta ? propsValidator(meta) : T.jsonObject,
    }),
  ) as unknown as Validator<TLCustomRecord<Type>>
}
