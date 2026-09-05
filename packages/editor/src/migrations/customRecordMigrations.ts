/**
 * Props migrations for custom record types.
 *
 * A custom record's props change over time exactly as a shape's do, and for the
 * same reason: the app adds a field, and every document saved before that field
 * existed still has to open. The only difference is the sequence id, which has
 * to name a *custom record* type so its version line is its own.
 */

import { createMigrationIds, createMigrationSequence, parseMigrationId, type MigrationSequence, type UnknownRecord } from "@mocanvas/store"
import { CUSTOM_RECORD_TYPE_NAME } from "../records/customRecord"
import { createShapePropsMigrationSequence, type MigratableProps, type PropsMigrations } from "./propsMigrations"

/**
 * The `sequenceId` prefix of a custom record type's props migrations.
 *
 * An app's own record types are the app's own migration line — nothing this
 * library ships claims a name under here, so the default prefix is safe for
 * them in a way it is not for built-in shapes.
 */
export const CUSTOM_RECORD_MIGRATION_SEQUENCE_PREFIX = "com.tldraw.record"

/** The `sequenceId` under which custom record type `type`'s migrations are registered. */
export function customRecordMigrationSequenceId(type: string): string {
  return `${CUSTOM_RECORD_MIGRATION_SEQUENCE_PREFIX}.${type}`
}

/**
 * Migration ids for a custom record type, from friendly version names:
 *
 * ```ts
 * const versions = createCustomRecordMigrationIds("review", { AddAssignee: 1 })
 * // versions.AddAssignee === "com.tldraw.record.review/1"
 * ```
 */
export function createCustomRecordMigrationIds<
  const Type extends string,
  const Versions extends Record<string, number>,
>(
  recordType: Type,
  versions: Versions,
): {
  readonly [K in keyof Versions]: `${typeof CUSTOM_RECORD_MIGRATION_SEQUENCE_PREFIX}.${Type}/${Versions[K]}`
} {
  return createMigrationIds(
    customRecordMigrationSequenceId(recordType) as `${typeof CUSTOM_RECORD_MIGRATION_SEQUENCE_PREFIX}.${Type}`,
    versions,
  )
}

/** Check a custom record props migration sequence and hand it back. */
export function createCustomRecordMigrationSequence(migrations: PropsMigrations): PropsMigrations {
  return createShapePropsMigrationSequence(migrations)
}

function isPlainObject(value: unknown): value is MigratableProps {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Turn a custom record type's props migrations into the record-scoped
 * `MigrationSequence` the store applies.
 *
 * Each step is narrowed to records with the right `typeName` *and* `type`, and
 * only ever touches their `props` — so a migration for `review` cannot reach a
 * `checklist` record that happens to be in the same document.
 */
export function toCustomRecordMigrationSequence(type: string, migrations: PropsMigrations): MigrationSequence {
  const first = migrations.sequence[0]
  const sequenceId = first ? parseMigrationId(first.id).sequenceId : customRecordMigrationSequenceId(type)
  if (!sequenceId.endsWith(`.${type}`)) {
    throw new Error(
      `Migration sequence "${sequenceId}" does not name custom record "${type}"; ids must end in ".${type}"`,
    )
  }

  const matches = (record: UnknownRecord): boolean =>
    record.typeName === CUSTOM_RECORD_TYPE_NAME && (record as { type?: unknown }).type === type

  const wrap = (fn: (props: MigratableProps) => void | MigratableProps) => (record: UnknownRecord): UnknownRecord => {
    const props = (record as { props?: unknown }).props
    if (!isPlainObject(props)) return record
    const next = { ...props }
    const replacement = fn(next)
    return { ...record, props: replacement ?? next } as UnknownRecord
  }

  return createMigrationSequence({
    sequenceId,
    ...(migrations.retroactive === undefined ? {} : { retroactive: migrations.retroactive }),
    sequence: migrations.sequence.map((migration) => ({
      id: migration.id,
      scope: "record" as const,
      filter: matches,
      up: wrap(migration.up),
      ...(migration.down ? { down: wrap(migration.down) } : {}),
    })),
  })
}
