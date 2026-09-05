/**
 * Custom record types: how an app puts data of its own in the document store.
 *
 * Shapes and bindings cover things that are *on* the canvas. Plenty of things
 * are not: a comment thread's resolution state, a review's checklist, a
 * document-wide setting an app owns. Those want everything the store gives a
 * shape — undo, sync, migration, reactive reads — and none of the geometry.
 *
 * A custom record is that: a record type an app declares, registered with the
 * schema alongside the built-ins, persisted in the same file, and typed through
 * the same module-augmentation mechanism shapes use.
 *
 * ```ts
 * declare module "@mocanvas/mocanvas" {
 *   interface TLGlobalRecordPropsMap {
 *     review: { status: "open" | "done"; assignee: string | null }
 *   }
 * }
 *
 * const reviewRecord: CustomRecordInfo<"review"> = {
 *   type: "review",
 *   scope: "document",
 *   props: { status: T.literalEnum("open", "done"), assignee: T.string.nullable() },
 *   migrations: reviewMigrations,
 * }
 *
 * createTLSchema({ records: { review: reviewRecord } })
 * ```
 */

import type { RecordId, RecordScope } from "@mocanvas/store"
import { uniqueId } from "@mocanvas/store"
import type { PropsMigrations } from "../migrations/propsMigrations"
import type { JsonObject } from "./base"
import type { RecordProps, UnknownRecordProps } from "./props"

/**
 * Props of every custom record type an app has registered, keyed by type.
 * Empty by design: it is filled in by module augmentation, exactly as
 * `TLGlobalShapePropsMap` is.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TLGlobalRecordPropsMap {}

/** The custom record types registered in {@link TLGlobalRecordPropsMap}. */
export type RegisteredCustomRecordType = keyof TLGlobalRecordPropsMap & string

/**
 * The props of custom record type `Type`, or the open `object` when that type
 * has not been registered.
 */
export type CustomRecordPropsForType<Type extends string> = Type extends keyof TLGlobalRecordPropsMap
  ? TLGlobalRecordPropsMap[Type] extends object
    ? TLGlobalRecordPropsMap[Type]
    : object
  : object

/**
 * One custom record.
 *
 * The shape of the record mirrors a shape's: a `type` discriminant, a `props`
 * bag the app owns, and a `meta` bag for anything the app wants to hang off it
 * without declaring. Everything a custom record type shares with every other
 * record — `id`, `typeName` — is fixed here so the store can treat them all
 * alike.
 */
export interface TLCustomRecord<Type extends string = RegisteredCustomRecordType> {
  readonly id: TLCustomRecordId<Type>
  readonly typeName: "custom"
  type: Type
  props: CustomRecordPropsForType<Type>
  meta: JsonObject
}

/** The id of a custom record: `custom:<type>:<unique>`. */
export type TLCustomRecordId<Type extends string = string> = RecordId<TLCustomRecord<Type>> & {
  readonly __customType__?: Type
}

/** The `typeName` every custom record shares. */
export const CUSTOM_RECORD_TYPE_NAME = "custom"

/**
 * What an app tells `createTLSchema` about one custom record type.
 *
 * `props` is a validator per prop, exactly as a shape util's `static props` is.
 * `scope` decides whether the records are persisted and shared (`document`),
 * local to this browser (`session`) or shared but never saved (`presence`) —
 * the same three choices every built-in record type makes.
 */
export interface CustomRecordInfo<Type extends string = string> {
  /** The type discriminant, e.g. `"review"`. Must be unique across custom types. */
  readonly type: Type
  /**
   * Where the records live. Defaults to `document`: a custom record almost
   * always *is* document data, which is the reason for declaring one.
   */
  readonly scope?: RecordScope | undefined
  /** One validator per prop. */
  readonly props: CustomRecordPropsForType<Type> extends infer P
    ? P extends object
      ? RecordProps<{ props: P }> | UnknownRecordProps
      : UnknownRecordProps
    : UnknownRecordProps
  /** How the props have changed over time; see `createCustomRecordMigrationSequence`. */
  readonly migrations?: PropsMigrations | undefined
  /** Props supplied when the caller omits them. */
  readonly getDefaultProps?: (() => CustomRecordPropsForType<Type>) | undefined
  /**
   * Props whose changes are not "real" document changes — transient flags the
   * store should not treat as an edit.
   */
  readonly ephemeralKeys?: Readonly<Record<string, boolean>> | undefined
}

/**
 * Mint an id for a custom record of `type`.
 *
 * The type is part of the id rather than only of the record, so that an id on
 * its own is enough to tell what it refers to — the same reason `shape:` ids
 * are prefixed. `{@link isCustomRecordId}(id, "review")` can then answer
 * without a store lookup.
 */
export function createCustomRecordId<Type extends string>(type: Type, id?: string): TLCustomRecordId<Type> {
  return `${CUSTOM_RECORD_TYPE_NAME}:${type}:${id ?? uniqueId()}` as TLCustomRecordId<Type>
}

/**
 * Whether `id` is a custom record id — optionally, one of a particular type.
 *
 * ```ts
 * isCustomRecordId(id)            // any custom record
 * isCustomRecordId(id, "review")  // a review specifically
 * ```
 */
export function isCustomRecordId<Type extends string = string>(
  id: unknown,
  type?: Type,
): id is TLCustomRecordId<Type> {
  if (typeof id !== "string") return false
  if (type !== undefined) {
    const prefix = `${CUSTOM_RECORD_TYPE_NAME}:${type}:`
    return id.startsWith(prefix) && id.length > prefix.length
  }
  // With no type to check against, both segments still have to be there: a
  // `custom:review:` with nothing after it names no record.
  const parts = id.split(":")
  return parts.length === 3 && parts[0] === CUSTOM_RECORD_TYPE_NAME && parts[1] !== "" && parts[2] !== ""
}

/** Whether `record` is a custom record — optionally, one of a particular type. */
export function isCustomRecord<Type extends string = RegisteredCustomRecordType>(
  record: unknown,
  type?: Type,
): record is TLCustomRecord<Type> {
  if (typeof record !== "object" || record === null) return false
  const candidate = record as { typeName?: unknown; type?: unknown }
  if (candidate.typeName !== CUSTOM_RECORD_TYPE_NAME) return false
  return type === undefined || candidate.type === type
}

/** The type part of a custom record id, or `undefined` when it is not one. */
export function getCustomRecordIdType(id: string): string | undefined {
  if (!isCustomRecordId(id)) return undefined
  const rest = id.slice(CUSTOM_RECORD_TYPE_NAME.length + 1)
  const colon = rest.indexOf(":")
  return colon > 0 ? rest.slice(0, colon) : undefined
}
