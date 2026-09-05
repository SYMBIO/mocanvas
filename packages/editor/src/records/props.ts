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

/**
 * Props of every registered asset type, keyed by asset type.
 * Empty by design: it is filled in by module augmentation, the same way
 * {@link TLGlobalShapePropsMap} is.
 *
 * ```ts
 * declare module "@mocanvas/mocanvas" {
 *   interface TLGlobalAssetPropsMap {
 *     "figma-file": { fileKey: string; nodeId: string; w: number; h: number }
 *   }
 * }
 * ```
 *
 * An `AssetUtil` reads this the way a `ShapeUtil` reads the shape map: its
 * `static props` is checked against the registered props, and the asset records
 * it produces are typed from them.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TLGlobalAssetPropsMap {}

/** The asset types registered in {@link TLGlobalAssetPropsMap}. */
export type RegisteredAssetType = keyof TLGlobalAssetPropsMap & string

/**
 * The props of asset type `Type`, or the open `object` when that type has not
 * been registered through {@link TLGlobalAssetPropsMap}.
 */
export type AssetPropsForType<Type extends string> = Type extends keyof TLGlobalAssetPropsMap
  ? TLGlobalAssetPropsMap[Type] extends object
    ? TLGlobalAssetPropsMap[Type]
    : object
  : object

/** An asset type name: the registered ones, plus any other string. */
export type AssetTypeName = RegisteredAssetType | (string & {})

/* ---- reading a value set ------------------------------------------------ */

/**
 * The union of the values of a `const` object or array.
 *
 * ```ts
 * const KINDS = { a: "a", b: "b" } as const
 * type Kind = SetValue<typeof KINDS>   // "a" | "b"
 * ```
 *
 * Used throughout the record layer so a closed set is declared once, as a
 * value, and the type is read back off it — rather than being written twice and
 * drifting.
 */
export type SetValue<Set extends { [key: string]: unknown } | readonly unknown[]> =
  Set extends readonly unknown[] ? Set[number] : Set[keyof Set]

/* ---- finding a shape by its props --------------------------------------- */

/**
 * The registered shape types whose props include `Props`.
 *
 * This is how a helper that only needs *part* of a shape stays honest: a
 * "resize anything with a width and height" routine takes
 * `ExtractShapeByProps<{ w: number; h: number }>` and gets every shape type
 * that actually has them, instead of `any` or a hand-maintained union that
 * forgets the custom shape someone added last week.
 */
export type ExtractShapeByProps<Props extends object> = {
  [Type in RegisteredShapeType]: Props extends Partial<TLGlobalShapePropsMap[Type]> ? Type : never
}[RegisteredShapeType]

/* ---- records grouped by type -------------------------------------------- */

/**
 * Records of one kind, grouped by their `type` discriminant.
 *
 * The shape a registry takes: `{ geo: GeoShapeUtil, arrow: ArrowShapeUtil }`.
 * Keyed by the *registered* types so a typo in a key is an error rather than a
 * silently ignored entry, and left open to any string for the types a build
 * does not know about statically.
 */
export type TLIndexedRecords<Value> = { [key: string]: Value }

/** Shape utils (or anything else) keyed by shape type. */
export type TLIndexedShapes<Value> = { [Type in ShapeTypeName]?: Value }

/** Binding utils keyed by binding type. */
export type TLIndexedBindings<Value> = { [Type in BindingTypeName]?: Value }

/** Asset utils keyed by asset type. */
export type TLIndexedAssets<Value> = { [Type in AssetTypeName]?: Value }
