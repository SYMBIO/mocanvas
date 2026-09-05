/**
 * Turning the `records` an app declares into the pieces a schema is built from.
 *
 * `createTLSchema({ records })` takes {@link CustomRecordInfo}s — a type name,
 * some prop validators, some migrations — and has to end up with two things:
 * the `RecordType`s the store registers, and the `MigrationSequence`s that
 * bring older documents forward. Those two derivations are here, on their own,
 * so that the schema factory is wiring rather than logic and so that both can
 * be tested without building a store.
 */

import { createRecordType, type MigrationSequence, type RecordType } from "@mocanvas/store"
import { toCustomRecordMigrationSequence } from "../migrations/customRecordMigrations"
import { isPropsMigrations } from "../migrations/propsMigrations"
import {
  CUSTOM_RECORD_TYPE_NAME,
  createCustomRecordId,
  type CustomRecordInfo,
  type TLCustomRecord,
} from "./customRecord"
import { createCustomRecordValidator } from "./recordValidators"
import type { UnknownRecordProps } from "./props"

/** A custom record whose type is only known at runtime. */
export type UnknownCustomRecord = TLCustomRecord<string>

/**
 * Build the `RecordType` for one custom record type.
 *
 * Every custom record shares the `custom` `typeName` — one entry in the store's
 * type map covers all of them — but each gets its own validator, keyed to its
 * own `type` and its own props. That is why this returns a record type per
 * declaration rather than one for the lot: the store validates a record with
 * the type registered under its `typeName`, and a single shared validator could
 * not tell a `review` from a `checklist`.
 */
export function createCustomRecordType(info: CustomRecordInfo<string>): RecordType<UnknownCustomRecord, any> {
  const validator = createCustomRecordValidator(info.type, info.props as UnknownRecordProps)
  const defaults = info.getDefaultProps
  return createRecordType<UnknownCustomRecord>(CUSTOM_RECORD_TYPE_NAME, {
    scope: info.scope ?? "document",
    validator,
    ...(info.ephemeralKeys ? { ephemeralKeys: info.ephemeralKeys as never } : {}),
  }).withDefaultProperties(() => ({
    type: info.type,
    props: (defaults ? defaults() : {}) as UnknownCustomRecord["props"],
    meta: {},
  }))
}

/**
 * Create a record of a declared custom type, with its defaults filled in.
 *
 * ```ts
 * const review = createCustomRecord(reviewInfo, { status: "open", assignee: null })
 * editor.store.put([review])
 * ```
 */
export function createCustomRecord<Type extends string>(
  info: CustomRecordInfo<Type>,
  props: TLCustomRecord<Type>["props"],
  options?: { id?: string; meta?: Record<string, never> },
): TLCustomRecord<Type> {
  const defaults = info.getDefaultProps?.() ?? {}
  return {
    id: createCustomRecordId(info.type, options?.id),
    typeName: CUSTOM_RECORD_TYPE_NAME,
    type: info.type,
    props: { ...defaults, ...props },
    meta: options?.meta ?? {},
  } as TLCustomRecord<Type>
}

/**
 * The migration sequences for a set of custom record declarations.
 *
 * A declaration with no `migrations` contributes nothing; one whose
 * `migrations` is already a full store `MigrationSequence` is passed through,
 * so a record type that needs to migrate more than its own props still can.
 */
export function createCustomRecordMigrationSequences(
  records: Readonly<Record<string, CustomRecordInfo<string>>> | undefined,
): MigrationSequence[] {
  const out: MigrationSequence[] = []
  for (const info of Object.values(records ?? {})) {
    const migrations = info.migrations
    if (!migrations) continue
    if (typeof (migrations as unknown as MigrationSequence).sequenceId === "string") {
      out.push(migrations as unknown as MigrationSequence)
      continue
    }
    if (!isPropsMigrations(migrations)) {
      throw new Error(
        `custom record "${info.type}" has a \`migrations\` that is neither a props nor a store migration sequence`,
      )
    }
    out.push(toCustomRecordMigrationSequence(info.type, migrations))
  }
  return out
}

/**
 * Check a set of custom record declarations before anything is built from them.
 *
 * Two types with the same name, or a name that collides with a built-in record
 * type, produce a store where one silently shadows the other — a bug that only
 * shows up as missing data. Better to refuse at declaration time.
 */
export function validateCustomRecordInfos(
  records: Readonly<Record<string, CustomRecordInfo<string>>> | undefined,
): void {
  const seen = new Set<string>()
  const reserved = new Set([
    "document",
    "page",
    "shape",
    "binding",
    "asset",
    "camera",
    "instance",
    "instance_page_state",
    "instance_presence",
    "pointer",
    "user",
  ])
  for (const [key, info] of Object.entries(records ?? {})) {
    if (key !== info.type) {
      throw new Error(`Custom record registered under "${key}" declares type "${info.type}"`)
    }
    if (reserved.has(info.type)) {
      throw new Error(`Custom record type "${info.type}" collides with a built-in record type`)
    }
    if (seen.has(info.type)) throw new Error(`Duplicate custom record type "${info.type}"`)
    seen.add(info.type)
  }
}

/**
 * One `RecordType` covering every declared custom type.
 *
 * Custom records all share the `custom` `typeName`, and the store's type map is
 * keyed by `typeName` — so the map gets one entry, not one per declaration.
 * Validation and defaults dispatch on the record's own `type`, which is what
 * keeps a `review` from being validated as a `checklist`.
 *
 * A record whose `type` was never declared is refused rather than waved
 * through: it would otherwise round-trip unvalidated and look like data the
 * schema understood. With nothing declared the entry still exists and refuses
 * everything, which is the same answer arrived at sooner.
 */
export function createCustomRecordTypeMap(
  records: Readonly<Record<string, CustomRecordInfo<string>>> | undefined,
): RecordType<UnknownCustomRecord, any> {
  const infos = Object.values(records ?? {})
  const byType = new Map(infos.map((info) => [info.type, createCustomRecordType(info)]))
  // Scope has to be one value for the whole entry. `document` unless every
  // declaration agrees on something else, since that is what a custom record
  // almost always is.
  const scopes = new Set(infos.map((i) => i.scope ?? "document"))
  const scope = scopes.size === 1 ? [...scopes][0]! : "document"

  const forRecord = (record: unknown): RecordType<UnknownCustomRecord, any> => {
    const type = (record as { type?: unknown } | null)?.type
    const found = typeof type === "string" ? byType.get(type) : undefined
    if (!found) {
      throw new Error(
        `Unknown custom record type ${JSON.stringify(type)}; declare it in \`createTLSchema({ records })\``,
      )
    }
    return found
  }

  return createRecordType<UnknownCustomRecord>(CUSTOM_RECORD_TYPE_NAME, {
    scope,
    validator: {
      validate: (value: unknown) => forRecord(value).validate(value),
    },
  }).withDefaultProperties(() => ({
    // Defaults are filled per type by `createCustomRecord`; the shared entry
    // cannot know which type a bare `create()` meant.
    type: "",
    props: {} as UnknownCustomRecord["props"],
    meta: {},
  }))
}
