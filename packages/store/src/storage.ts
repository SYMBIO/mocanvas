/**
 * The synchronous storage contract a store can be backed by.
 *
 * Deliberately synchronous and deliberately tiny: it is the shape an embedded
 * key-value store (a SQLite table, a `Map`, an in-process test double) already
 * has, so a host can hand one over without writing an adapter. Anything
 * asynchronous — a network, IndexedDB — belongs behind a snapshot load and save
 * rather than behind this.
 */

import type { IdOf, UnknownRecord } from "./ids"
import type { SerializedSchema } from "./migrate"

/**
 * Somewhere records can be read from and written to, one at a time, without
 * awaiting.
 *
 * Implementations must be consistent within a call: `getAll` reflects every
 * `set` and `delete` that has already returned.
 */
export interface SynchronousRecordStorage<R extends UnknownRecord = UnknownRecord> {
  /** The record stored under `id`, or `undefined`. */
  get(id: IdOf<R>): R | undefined
  /** Every stored record. Order is not significant. */
  getAll(): R[]
  /** Store `record` under its own id, replacing anything already there. */
  set(record: R): void
  /** Remove the record stored under `id`. Removing an absent id is not an error. */
  delete(id: IdOf<R>): void
  /** Remove every record. */
  clear(): void
}

/**
 * Record storage that also remembers the schema its records were written
 * against, so they can be migrated when they are read back.
 *
 * Storing records without their schema is the one mistake that cannot be
 * recovered from later: there is no way to tell which migrations have already
 * run, and re-running them corrupts the data.
 */
export interface SynchronousStorage<R extends UnknownRecord = UnknownRecord> extends SynchronousRecordStorage<R> {
  /** The schema the stored records were written against, or `undefined` when empty. */
  getSchema(): SerializedSchema | undefined
  /** Record the schema the stored records are written against. */
  setSchema(schema: SerializedSchema): void
}

/**
 * A {@link SynchronousStorage} backed by a plain `Map`.
 *
 * Useful in tests and as the reference implementation of the contract — the
 * shortest correct answer to "what does a storage have to do?".
 */
export function createInMemoryStorage<R extends UnknownRecord = UnknownRecord>(): SynchronousStorage<R> {
  const records = new Map<IdOf<R>, R>()
  let schema: SerializedSchema | undefined

  return {
    get: (id) => records.get(id),
    getAll: () => [...records.values()],
    set: (record) => {
      records.set(record.id as IdOf<R>, record)
    },
    delete: (id) => {
      records.delete(id)
    },
    clear: () => records.clear(),
    getSchema: () => schema,
    setSchema: (next) => {
      schema = next
    },
  }
}
