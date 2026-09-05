/**
 * The pre-sequence migration format, and the reasons a migration can fail.
 *
 * Before migrations were named sequences, a schema declared one integer version
 * per record type plus one for the store, and a table of numbered up/down
 * functions between them. mocanvas never *writes* that format — {@link
 * SerializedSchemaV1} exists so a document saved by something that did can
 * still be recognised and loaded, and so a schema written against the old shape
 * can still be described.
 *
 * Nothing here changes what mocanvas persists. See `StoreSchema.serialize`,
 * which always produces the v2 shape.
 */

import type { UnknownRecord } from "./ids"

/**
 * The persisted schema shape used before migration sequences: a version number
 * per record type, and one for the store as a whole.
 *
 * Read-only as far as mocanvas is concerned. A snapshot carrying one is treated
 * as knowing none of today's sequences, so every retroactive sequence runs from
 * the beginning — which is right, because none of them existed when the file
 * was written.
 */
export interface SerializedSchemaV1 {
  schemaVersion: 1
  storeVersion: number
  recordVersions: Record<
    string,
    { version: number } | { version: number; subTypeVersions: Record<string, number>; subTypeKey: string }
  >
}

/** Whether a persisted schema is in the pre-sequence format. */
export function isSerializedSchemaV1(schema: { schemaVersion: number }): schema is SerializedSchemaV1 {
  return schema.schemaVersion === 1
}

/** One numbered step of a {@link LegacyMigrations} table. */
export interface LegacyMigration<Before = any, After = any> {
  up: (oldState: Before) => After
  down: (newState: After) => Before
}

/** The version bounds every legacy migration table declares. */
export interface LegacyBaseMigrationsInfo {
  firstVersion: number
  currentVersion: number
  migrators: { [version: number]: LegacyMigration }
}

/**
 * A legacy migration table: the version range it covers, the numbered steps,
 * and optionally the sub-type split a record type used (a shape's `type`, say,
 * each with its own version line).
 */
export interface LegacyMigrations extends LegacyBaseMigrationsInfo {
  subTypeKey?: string
  subTypeMigrations?: Record<string, LegacyBaseMigrationsInfo>
}

/**
 * A dependency declared by a standalone migration sequence: it must run after
 * (or before) another sequence's numbered migration, even though neither owns
 * the other.
 *
 * Ordering between sequences is otherwise registration order, which is fine
 * until one sequence's `up` reads a field another sequence is still about to
 * add.
 */
export interface StandaloneDependsOn {
  dependsOn: readonly string[]
}

/**
 * Why loading a persisted snapshot failed.
 *
 * These are the cases worth telling apart in a UI: "this file is from a newer
 * version of the app" is a message a user can act on, and
 * "migrationError" is not.
 */
export const MigrationFailureReason = {
  /** The persisted schema names a sequence version higher than this schema knows. */
  TargetVersionTooNew: "target-version-too-new",
  /** The persisted data is older than the oldest migration that survives. */
  TargetVersionTooOld: "target-version-too-old",
  /** A record's type is not registered in this schema and cannot be migrated. */
  UnrecognizedType: "unrecognized-type",
  /** A migration function threw. */
  MigrationError: "migration-error",
  /** The persisted schema itself is malformed. */
  IncompatibleSubtype: "incompatible-subtype",
  /** The persisted schema version is not one this store understands. */
  UnknownSchemaVersion: "unknown-schema-version",
} as const

/** One of the {@link MigrationFailureReason} values. */
export type MigrationFailureReason = (typeof MigrationFailureReason)[keyof typeof MigrationFailureReason]
