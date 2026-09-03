import type { IdOf, UnknownRecord } from "./ids"

/** Serialized records keyed by id. */
export type SerializedStore<R extends UnknownRecord> = Record<IdOf<R>, R>

/**
 * Persisted description of a schema: for each migration sequence, how many
 * migrations had been applied when the data was saved.
 */
export interface SerializedSchemaV2 {
  schemaVersion: 2
  sequences: { [sequenceId: string]: number }
}

export type SerializedSchema = SerializedSchemaV2

export type MigrationId = `${string}/${number}`

export interface RecordMigration {
  readonly id: MigrationId
  readonly scope: "record"
  /** Only records for which this returns true are migrated. Defaults to all records. */
  readonly filter?: ((record: UnknownRecord) => boolean) | undefined
  /** Mutate the record in place, or return a replacement. */
  readonly up: (record: UnknownRecord) => void | UnknownRecord
  readonly down?: ((record: UnknownRecord) => void | UnknownRecord) | undefined
}

export interface StoreMigration {
  readonly id: MigrationId
  readonly scope: "store"
  /** Mutate the store in place, or return a replacement. */
  readonly up: (store: SerializedStore<UnknownRecord>) => void | SerializedStore<UnknownRecord>
  readonly down?:
    | ((store: SerializedStore<UnknownRecord>) => void | SerializedStore<UnknownRecord>)
    | undefined
}

export type Migration = RecordMigration | StoreMigration

export interface MigrationSequence {
  readonly sequenceId: string
  /**
   * When data is loaded that has never seen this sequence, should every
   * migration be applied (`true`, the default) or should the data be assumed
   * already up to date (`false`)? Use `false` for sequences added to a type
   * that already existed before the sequence did.
   */
  readonly retroactive: boolean
  readonly sequence: readonly Migration[]
}

export type MigrationResult<T> = { type: "success"; value: T } | { type: "error"; reason: string }

/**
 * Build the ids of a sequence's migrations from friendly names:
 *
 * ```ts
 * const Versions = createMigrationIds('com.example.shape.box', { AddColor: 1, AddSize: 2 })
 * // Versions.AddColor === 'com.example.shape.box/1'
 * ```
 */
export function createMigrationIds<const ID extends string, const Versions extends Record<string, number>>(
  sequenceId: ID,
  versions: Versions,
): { readonly [K in keyof Versions]: `${ID}/${Versions[K]}` } {
  const result: Record<string, string> = {}
  for (const [name, version] of Object.entries(versions)) {
    result[name] = `${sequenceId}/${version}`
  }
  return result as { readonly [K in keyof Versions]: `${ID}/${Versions[K]}` }
}

export function parseMigrationId(id: string): { sequenceId: string; version: number } {
  const slash = id.lastIndexOf("/")
  if (slash <= 0) throw new Error(`Malformed migration id ${JSON.stringify(id)}`)
  const version = Number(id.slice(slash + 1))
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Malformed migration id ${JSON.stringify(id)}: version must be a positive integer`)
  }
  return { sequenceId: id.slice(0, slash), version }
}

/**
 * Create a validated migration sequence. Migration ids must be
 * `${sequenceId}/1`, `${sequenceId}/2`, ... in order.
 */
export function createMigrationSequence(options: {
  sequenceId: string
  retroactive?: boolean | undefined
  sequence: readonly Migration[]
}): MigrationSequence {
  const { sequenceId, retroactive = true, sequence } = options
  if (!sequenceId || sequenceId.includes("/")) {
    throw new Error(`Invalid sequenceId ${JSON.stringify(sequenceId)}: must be non-empty and not contain "/"`)
  }
  sequence.forEach((migration, i) => {
    const id = migration.id
    const parsed = parseMigrationId(id)
    if (parsed.sequenceId !== sequenceId) {
      throw new Error(`Migration ${id} does not belong to sequence ${sequenceId}`)
    }
    if (parsed.version !== i + 1) {
      throw new Error(`Migration ${id} is out of order: expected version ${i + 1}`)
    }
    const scope: string = migration.scope
    if (scope !== "record" && scope !== "store") {
      throw new Error(`Migration ${id} has invalid scope ${JSON.stringify(scope)}`)
    }
  })
  return { sequenceId, retroactive, sequence: [...sequence] }
}

/**
 * Convenience for the common case: a sequence of record-scoped migrations
 * that all apply to one record type (optionally narrowed further by `filter`).
 */
export function createRecordMigrationSequence(options: {
  sequenceId: string
  recordType: string
  retroactive?: boolean | undefined
  filter?: ((record: UnknownRecord) => boolean) | undefined
  sequence: readonly Omit<RecordMigration, "scope" | "filter">[]
}): MigrationSequence {
  const { recordType, filter } = options
  const combinedFilter = (record: UnknownRecord) =>
    record.typeName === recordType && (filter ? filter(record) : true)
  return createMigrationSequence({
    sequenceId: options.sequenceId,
    retroactive: options.retroactive,
    sequence: options.sequence.map(
      (m): RecordMigration => ({ id: m.id, scope: "record", filter: combinedFilter, up: m.up, down: m.down }),
    ),
  })
}

/** Apply one record migration to a single record, honoring its filter. */
export function applyRecordMigration(
  migration: RecordMigration,
  record: UnknownRecord,
  direction: "up" | "down",
): UnknownRecord {
  if (migration.filter && !migration.filter(record)) return record
  const fn = direction === "up" ? migration.up : migration.down
  if (!fn) throw new Error(`Migration ${migration.id} has no ${direction} function`)
  const result = fn(record)
  return result === undefined ? record : result
}

/** Apply one migration (record- or store-scoped) to a whole store in place. */
export function applyMigrationToStore(
  migration: Migration,
  store: SerializedStore<UnknownRecord>,
  direction: "up" | "down",
): SerializedStore<UnknownRecord> {
  if (migration.scope === "store") {
    const fn = direction === "up" ? migration.up : migration.down
    if (!fn) throw new Error(`Migration ${migration.id} has no ${direction} function`)
    const result = fn(store)
    return result === undefined ? store : result
  }
  for (const id in store) {
    const record = store[id as IdOf<UnknownRecord>]!
    const next = applyRecordMigration(migration, record, direction)
    if (next !== record) store[id as IdOf<UnknownRecord>] = next
  }
  return store
}
