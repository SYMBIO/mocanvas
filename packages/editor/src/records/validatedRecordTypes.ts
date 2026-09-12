/**
 * Turning the `static props` maps of a set of utils into record types that
 * actually validate.
 *
 * Shapes and bindings all share one `typeName`, so the store's type map gets a
 * single entry for each and the entry has to dispatch on the record's own
 * `type`. That is the same arrangement `createCustomRecordTypeMap` uses for
 * custom records, and for the same reason: one shared validator could not tell
 * a `geo` from an `arrow`.
 *
 * **Props the map does not declare are kept, not rejected.** `createShapeValidator`
 * on its own refuses them, which is right for a record an app is making; but a
 * record the store is *holding* may have come out of a `.tldr` written by a
 * newer generation of the format, and dropping what this build does not
 * recognise would lose it on the next save. The declared props are still
 * checked. See `UnknownPropsPolicy`.
 *
 * **A type with no declared props is passed through.** Shapes of a type this
 * build has never heard of — one an app registered in a newer version, one
 * whose util was not passed to this editor — must survive a load/save round
 * trip rather than be deleted on the next save. That is the policy
 * `StoreSchema.validateRecord`, `T.union().validateUnknownVariants` and
 * `normalizeLoadedRecords` already state; declaring props is what opts a type
 * into being checked.
 */

import { createRecordType, type RecordType } from "@mocanvas/store"
import { ValidationError } from "../validation/validator"
import type { Asset, BaseAsset } from "./asset"
import type { UnknownShape } from "./base"
import type { UnknownBinding } from "./binding"
import type { UnknownRecordProps } from "./props"
import {
  createAssetPropsValidator,
  createBaseAssetValidator,
  createBaseBindingValidator,
  createBaseShapeValidator,
  createBindingValidator,
  createShapeValidator,
} from "./recordValidators"

/** What this module needs to know about one util: its type and its props. */
export interface PropsSource {
  readonly type: string
  readonly props?: UnknownRecordProps | undefined
}

/**
 * The props maps of a set of utils, keyed by type, with `defaults` (the
 * built-in registry) underneath.
 *
 * A util the caller passed wins over a registered default of the same name, so
 * an app that subclasses `GeoShapeUtil` with an extra prop is validated against
 * *its* map rather than the built-in one.
 */
export function collectProps(
  utils: readonly PropsSource[] | undefined,
  defaults: Readonly<Record<string, { readonly props?: UnknownRecordProps | undefined }>>,
): Record<string, UnknownRecordProps> {
  const out: Record<string, UnknownRecordProps> = {}
  for (const [type, info] of Object.entries(defaults)) {
    if (info.props) out[type] = info.props
  }
  for (const util of utils ?? []) {
    if (util.props) out[util.type] = util.props
  }
  return out
}

/**
 * A validator that picks the per-type validator by the record's `type`.
 *
 * A record whose `type` is not a string is refused outright: every shape and
 * binding has one, and without it there is nothing to dispatch on — a record
 * like that is corrupt rather than foreign.
 */
function dispatchingValidator<R>(
  kind: "shape" | "binding" | "asset",
  byType: ReadonlyMap<string, { validate(value: unknown): unknown }>,
  base: { validate(value: unknown): unknown },
): { validate(value: unknown): R } {
  return {
    validate(value: unknown): R {
      const type = (value as { type?: unknown } | null)?.type
      if (typeof type !== "string") {
        throw new ValidationError(
          `Expected a ${kind} type, got ${type === undefined ? "undefined" : typeof type}`,
          ["type"],
        )
      }
      const validator = byType.get(type)
      // A type nobody declared props for is foreign data, not invalid data —
      // but only its PROPS are foreign. The rest of the record is the same
      // shape it is for every type, so it is still checked; otherwise a store
      // built with no utils accepts `x: "NOT A NUMBER"`.
      if (!validator) return base.validate(value) as R
      return validator.validate(value) as R
    },
  }
}

/** The `shape` record type, validating every type whose props are known. */
export function createShapeRecordType(
  propsByType: Readonly<Record<string, UnknownRecordProps>>,
): RecordType<UnknownShape, any> {
  const byType = new Map(
    Object.entries(propsByType).map(
      ([type, props]) => [type, createShapeValidator(type, props, undefined, { unknownProps: "keep" })] as const,
    ),
  )
  return createRecordType<UnknownShape>("shape", {
    scope: "document",
    validator: dispatchingValidator<UnknownShape>("shape", byType, createBaseShapeValidator()),
  }).withDefaultProperties(() => ({ x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {} }))
}

/**
 * The `asset` record type, validating every type whose props are known.
 *
 * Assets were the one record kind the schema left unchecked. The comment on
 * `AssetRecordType` said so and gave the reason — turning validation on would
 * start rejecting assets inside `parseTldrFile` written by older editors — but
 * that is an argument for the `"keep"` policy, not for checking nothing: a
 * consumer building a document from untrusted rows had an `image` asset with
 * empty props mount and render rather than throw.
 */
export function createAssetRecordType(
  propsByType: Readonly<Record<string, UnknownRecordProps>>,
): RecordType<Asset, any> {
  const byType = new Map(
    Object.entries(propsByType).map(
      ([type, props]) => [type, createAssetPropsValidator(type, props, { unknownProps: "keep" })] as const,
    ),
  )
  // Built over the open form — the store may hold an asset type this build has
  // never heard of — and restated as the closed `Asset` the record union names.
  // Shapes get the same effect by putting the open form in the union itself;
  // widening `EditorRecord` for assets would move a published type for no gain.
  return createRecordType<BaseAsset<string, object>>("asset", {
    scope: "document",
    validator: dispatchingValidator<BaseAsset<string, object>>("asset", byType, createBaseAssetValidator()),
  }).withDefaultProperties(() => ({ meta: {} })) as unknown as RecordType<Asset, any>
}

/** The `binding` record type; see {@link createShapeRecordType}. */
export function createBindingRecordType(
  propsByType: Readonly<Record<string, UnknownRecordProps>>,
): RecordType<UnknownBinding, any> {
  const byType = new Map(
    Object.entries(propsByType).map(
      ([type, props]) => [type, createBindingValidator(type, props, undefined, { unknownProps: "keep" })] as const,
    ),
  )
  return createRecordType<UnknownBinding>("binding", {
    scope: "document",
    validator: dispatchingValidator<UnknownBinding>("binding", byType, createBaseBindingValidator()),
  }).withDefaultProperties(() => ({ meta: {} }))
}
