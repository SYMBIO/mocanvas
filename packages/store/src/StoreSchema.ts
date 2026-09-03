import type { IdOf, RecordScope, RecordType, UnknownRecord } from "./ids"
import {
  applyMigrationToStore,
  applyRecordMigration,
  type Migration,
  type MigrationResult,
  type MigrationSequence,
  type SerializedSchema,
  type SerializedStore,
} from "./migrate"
import type { Store } from "./Store"

export type StoreValidationPhase = "initialize" | "createRecord" | "updateRecord" | "tests"

export type RecordTypeMap<R extends UnknownRecord> = {
  readonly [TypeName in R["typeName"]]: RecordType<Extract<R, { typeName: TypeName }>, any>
}

export interface StoreValidationFailure<R extends UnknownRecord> {
  error: unknown
  store: Store<R, any>
  record: R
  phase: StoreValidationPhase
  recordBefore: R | null
}

export interface StoreSchemaOptions<R extends UnknownRecord, Props> {
  readonly migrations?: readonly MigrationSequence[] | undefined
  /**
   * Called when a record fails validation. Return a repaired record to keep
   * going, or throw to abort the operation. When omitted the error is thrown.
   */
  readonly onValidationFailure?: ((data: StoreValidationFailure<R>) => R) | undefined
  /** Reserved for store-level integrity checks; unused by the schema itself. */
  readonly createIntegrityChecker?: ((store: Store<R, Props>) => void) | undefined
}

export interface StoreSnapshot<R extends UnknownRecord> {
  store: SerializedStore<R>
  schema: SerializedSchema
}

/**
 * The set of record types a store holds plus the migrations that bring
 * persisted data up to date.
 */
export class StoreSchema<R extends UnknownRecord, Props = unknown> {
  static create<R extends UnknownRecord, Props = unknown>(
    types: RecordTypeMap<R>,
    options?: StoreSchemaOptions<R, Props>,
  ): StoreSchema<R, Props> {
    return new StoreSchema<R, Props>(types, options ?? {})
  }

  readonly migrations: Readonly<Record<string, MigrationSequence>>
  /** All migrations in application order (sequence registration order, then version). */
  readonly sortedMigrations: readonly Migration[]
  private readonly typeByName: ReadonlyMap<string, RecordType<R, any>>

  private constructor(
    readonly types: RecordTypeMap<R>,
    private readonly options: StoreSchemaOptions<R, Props>,
  ) {
    const byName = new Map<string, RecordType<R, any>>()
    for (const [name, type] of Object.entries(types) as [string, RecordType<R, any>][]) {
      if (type.typeName !== name) {
        throw new Error(`Record type registered under "${name}" has typeName "${type.typeName}"`)
      }
      byName.set(name, type)
    }
    this.typeByName = byName

    const migrations: Record<string, MigrationSequence> = {}
    const sorted: Migration[] = []
    const seenIds = new Set<string>()
    for (const sequence of options.migrations ?? []) {
      if (migrations[sequence.sequenceId]) {
        throw new Error(`Duplicate migration sequence "${sequence.sequenceId}"`)
      }
      migrations[sequence.sequenceId] = sequence
      for (const migration of sequence.sequence) {
        if (seenIds.has(migration.id)) throw new Error(`Duplicate migration id "${migration.id}"`)
        seenIds.add(migration.id)
        sorted.push(migration)
      }
    }
    this.migrations = migrations
    this.sortedMigrations = sorted
  }

  getType(typeName: string): RecordType<R, any> | undefined {
    return this.typeByName.get(typeName)
  }

  /** Scope of a record type; unknown types are treated as `document`. */
  getScope(typeName: string): RecordScope {
    return this.typeByName.get(typeName)?.scope ?? "document"
  }

  /**
   * Validate a record, delegating to its record type's validator. Records of
   * unknown types are passed through untouched so that foreign data survives
   * a load/save round-trip.
   */
  validateRecord(
    store: Store<R, any>,
    record: R,
    phase: StoreValidationPhase,
    recordBefore: R | undefined,
  ): R {
    const type = this.typeByName.get(record.typeName)
    if (!type) return record
    try {
      return type.validate(record, recordBefore)
    } catch (error) {
      if (this.options.onValidationFailure) {
        return this.options.onValidationFailure({
          error,
          store,
          record,
          phase,
          recordBefore: recordBefore ?? null,
        })
      }
      throw error
    }
  }

  /** The current version of every sequence. */
  serialize(): SerializedSchema {
    const sequences: Record<string, number> = {}
    for (const sequence of Object.values(this.migrations)) {
      sequences[sequence.sequenceId] = sequence.sequence.length
    }
    return { schemaVersion: 2, sequences }
  }

  /** A schema at version 0 of every sequence (all migrations still pending). */
  serializeEarliestVersion(): SerializedSchema {
    const sequences: Record<string, number> = {}
    for (const sequence of Object.values(this.migrations)) sequences[sequence.sequenceId] = 0
    return { schemaVersion: 2, sequences }
  }

  /**
   * The migrations that must run to bring data saved under `persistedSchema`
   * up to this schema, in order. Sequences the persisted schema knows but we
   * do not are ignored with a warning.
   */
  getMigrationsSince(persistedSchema: SerializedSchema): MigrationResult<Migration[]> {
    if (persistedSchema.schemaVersion !== 2) {
      return {
        type: "error",
        reason: `Unsupported schema version ${String((persistedSchema as { schemaVersion: unknown }).schemaVersion)}`,
      }
    }
    const persisted = persistedSchema.sequences ?? {}

    for (const sequenceId of Object.keys(persisted)) {
      if (!this.migrations[sequenceId]) {
        console.warn(`[store] ignoring unknown migration sequence "${sequenceId}" in persisted schema`)
      }
    }

    const result: Migration[] = []
    for (const sequence of Object.values(this.migrations)) {
      const persistedVersion = persisted[sequence.sequenceId]
      let startAt: number
      if (persistedVersion === undefined) {
        if (!sequence.retroactive) continue
        startAt = 0
      } else {
        if (!Number.isInteger(persistedVersion) || persistedVersion < 0) {
          return { type: "error", reason: `Invalid version ${String(persistedVersion)} for sequence "${sequence.sequenceId}"` }
        }
        if (persistedVersion > sequence.sequence.length) {
          return {
            type: "error",
            reason: `Sequence "${sequence.sequenceId}" is at version ${persistedVersion} but this schema only knows ${sequence.sequence.length}: data comes from a newer version`,
          }
        }
        startAt = persistedVersion
      }
      for (let i = startAt; i < sequence.sequence.length; i++) result.push(sequence.sequence[i]!)
    }
    return { type: "success", value: result }
  }

  /**
   * Migrate a single record. Only record-scoped migrations can be applied;
   * encountering a store-scoped one is an error. `down` runs the migrations
   * in reverse (from this schema to `persistedSchema`).
   */
  migratePersistedRecord(
    record: UnknownRecord,
    persistedSchema: SerializedSchema,
    direction: "up" | "down" = "up",
  ): MigrationResult<UnknownRecord> {
    const migrations = this.getMigrationsSince(persistedSchema)
    if (migrations.type === "error") return migrations
    const ordered = direction === "up" ? migrations.value : [...migrations.value].reverse()
    let current: UnknownRecord = structuredClone(record)
    try {
      for (const migration of ordered) {
        if (migration.scope !== "record") {
          return { type: "error", reason: `Migration ${migration.id} is store-scoped and cannot be applied to a single record` }
        }
        if (direction === "down" && !migration.down) {
          return { type: "error", reason: `Migration ${migration.id} has no down migration` }
        }
        current = applyRecordMigration(migration, current, direction)
      }
    } catch (error) {
      return { type: "error", reason: `Migration failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { type: "success", value: current }
  }

  /**
   * Bring a whole persisted store up to date. The input is not mutated.
   * Records of types this schema does not know are preserved as-is.
   */
  migrateStoreSnapshot(snapshot: StoreSnapshot<R>): MigrationResult<SerializedStore<R>> {
    const migrations = this.getMigrationsSince(snapshot.schema)
    if (migrations.type === "error") return migrations

    let store: SerializedStore<UnknownRecord> = structuredClone(snapshot.store)
    if (migrations.value.length === 0) return { type: "success", value: store as SerializedStore<R> }

    try {
      for (const migration of migrations.value) {
        store = applyMigrationToStore(migration, store, "up")
      }
    } catch (error) {
      return { type: "error", reason: `Migration failed: ${error instanceof Error ? error.message : String(error)}` }
    }

    // Migrations must not change a record's id or lose it.
    for (const id in store) {
      const record = store[id as IdOf<UnknownRecord>]
      if (!record || record.id !== id) {
        return { type: "error", reason: `Migration produced a record whose id does not match its key (${id})` }
      }
    }
    return { type: "success", value: store as SerializedStore<R> }
  }
}
