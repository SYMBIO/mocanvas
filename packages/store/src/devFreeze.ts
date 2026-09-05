/**
 * Two small guards the store leans on: a development-only deep freeze, and an
 * id assertion that narrows.
 */

import type { IdOf, RecordType, UnknownRecord } from "./ids"

/** Whether the bundle is a development build. Frozen at module load. */
const IS_DEV =
  typeof process !== "undefined" && typeof process.env === "object" && process.env["NODE_ENV"] !== "production"

/**
 * Deep-freeze `object` in development builds, and hand it straight back in
 * production.
 *
 * Records in the store are shared by reference with every consumer that read
 * them, so mutating one in place skips the whole change pipeline: no diff, no
 * side effects, no listeners, and an undo that silently does nothing. Freezing
 * turns that from a bug someone finds a week later into a `TypeError` on the
 * line that did it. The check is skipped in production because freezing every
 * record on every write is not free.
 *
 * Already-frozen objects are left alone, so re-freezing a record that came out
 * of the store costs one property read.
 */
export function devFreeze<T>(object: T): T {
  if (!IS_DEV) return object
  return deepFreeze(object)
}

function deepFreeze<T>(object: T): T {
  if (object === null || typeof object !== "object") return object
  if (Object.isFrozen(object)) return object
  Object.freeze(object)
  // `Object.freeze` is shallow; a record's `props` and `meta` are the parts
  // most likely to be mutated in place, and they are one level down.
  for (const value of Object.values(object as Record<string, unknown>)) deepFreeze(value)
  if (Array.isArray(object)) for (const value of object) deepFreeze(value)
  return object
}

/**
 * Assert that `id` belongs to `type`, narrowing it to that type's id.
 *
 * Record ids are branded strings, so the compiler already stops most mix-ups —
 * but ids that arrive from outside the program (a URL, a saved file, a sync
 * message) are plain strings that someone has to vouch for. This is the place
 * to do that vouching: it throws with the offending id rather than letting a
 * `page:` id be looked up as a shape and quietly returning `undefined`.
 *
 * ```ts
 * assertIdType(idFromUrl, PageRecordType)
 * editor.setCurrentPage(idFromUrl) // now typed as TLPageId
 * ```
 */
export function assertIdType<R extends UnknownRecord>(
  id: string | undefined,
  type: RecordType<R, any>,
): asserts id is IdOf<R> {
  if (!type.isId(id)) {
    throw new Error(`Expected ${type.typeName} id, got ${JSON.stringify(id)}`)
  }
}
