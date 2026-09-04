/**
 * The augmentable prop maps custom shapes and bindings register themselves in,
 * and the types that read a `static props` map.
 *
 * A package that defines a custom shape declares its props here:
 *
 * ```ts
 * declare module "@mocanvas/mocanvas" {
 *   interface TLGlobalShapePropsMap {
 *     format: { w: number; h: number }
 *   }
 * }
 * ```
 *
 * From then on `editor.createShape({ type: "format", props: { … } })` is
 * checked against those props, and `Shape<"format">` resolves to the full
 * record. Types that are not registered keep working: their props resolve to
 * the open `object`, exactly as before anyone augmented anything.
 *
 * Augment whichever module you import from — the interface is re-exported all
 * the way up the chain (`@mocanvas/editor` → `@mocanvas/mocanvas` →
 * `@mocanvas/compat`) and TypeScript merges the declaration into the same
 * interface through the re-exports.
 */

import type { Validatable } from "../validation/validator"
import type { StyleProp } from "./styleProp"

/**
 * Props of every registered custom shape type, keyed by shape type.
 * Empty by design: it is filled in by module augmentation.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TLGlobalShapePropsMap {}

/**
 * Props of every registered binding type, keyed by binding type.
 * Empty by design: it is filled in by module augmentation.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TLGlobalBindingPropsMap {}

/** The shape types registered in {@link TLGlobalShapePropsMap}. */
export type RegisteredShapeType = keyof TLGlobalShapePropsMap & string

/** The binding types registered in {@link TLGlobalBindingPropsMap}. */
export type RegisteredBindingType = keyof TLGlobalBindingPropsMap & string

/**
 * A shape type name: the registered ones (so editors autocomplete them) and
 * any other string, because a shape type need not be registered to exist.
 */
export type ShapeTypeName = RegisteredShapeType | (string & {})

/** A binding type name; see {@link ShapeTypeName}. */
export type BindingTypeName = RegisteredBindingType | (string & {})

/**
 * The props of shape type `Type`, or the open `object` when that type has not
 * been registered through {@link TLGlobalShapePropsMap}.
 */
export type ShapePropsForType<Type extends string> = Type extends keyof TLGlobalShapePropsMap
  ? TLGlobalShapePropsMap[Type] extends object
    ? TLGlobalShapePropsMap[Type]
    : object
  : object

/**
 * The props of binding type `Type`, or the open `object` when that type has
 * not been registered through {@link TLGlobalBindingPropsMap}.
 */
export type BindingPropsForType<Type extends string> = Type extends keyof TLGlobalBindingPropsMap
  ? TLGlobalBindingPropsMap[Type] extends object
    ? TLGlobalBindingPropsMap[Type]
    : object
  : object

/* ---- `static props` maps ------------------------------------------------ */

/**
 * One entry of a `static props` map: a validator, or a {@link StyleProp} —
 * which validates too, and additionally makes the prop shared across shapes.
 */
export type RecordPropValidator<T> = Validatable<T> | StyleProp<T>

/**
 * The `static props` map of a shape or binding util: one validator per prop of
 * the record it describes.
 */
export type RecordProps<R extends { props: object }> = {
  [K in keyof R["props"]]: RecordPropValidator<R["props"][K]>
}

/**
 * A `static props` map read without knowing the record type — what the base
 * class can say about it. Every value must still be a validator, which is the
 * whole difference from `Record<string, unknown>`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnknownRecordProps = Record<string, RecordPropValidator<any>>

/** The props object a `static props` map describes. */
export type RecordPropsType<Props extends UnknownRecordProps> = {
  [K in keyof Props]: Props[K] extends Validatable<infer T> ? T : never
}
