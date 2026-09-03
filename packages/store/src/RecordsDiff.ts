import type { IdOf, UnknownRecord } from "./ids"

/** A set of changes to a store's records. */
export interface RecordsDiff<R extends UnknownRecord> {
  added: Record<IdOf<R>, R>
  updated: Record<IdOf<R>, [from: R, to: R]>
  removed: Record<IdOf<R>, R>
}

export function createEmptyRecordsDiff<R extends UnknownRecord>(): RecordsDiff<R> {
  return { added: {}, updated: {}, removed: {} } as RecordsDiff<R>
}

export function isRecordsDiffEmpty<R extends UnknownRecord>(diff: RecordsDiff<R>): boolean {
  for (const _ in diff.added) return false
  for (const _ in diff.updated) return false
  for (const _ in diff.removed) return false
  return true
}

/** Produce the diff that undoes `diff`. */
export function reverseRecordsDiff<R extends UnknownRecord>(diff: RecordsDiff<R>): RecordsDiff<R> {
  const result = createEmptyRecordsDiff<R>()
  for (const id in diff.added) {
    result.removed[id as IdOf<R>] = diff.added[id as IdOf<R>]!
  }
  for (const id in diff.removed) {
    result.added[id as IdOf<R>] = diff.removed[id as IdOf<R>]!
  }
  for (const id in diff.updated) {
    const [from, to] = diff.updated[id as IdOf<R>]!
    result.updated[id as IdOf<R>] = [to, from]
  }
  return result
}

/**
 * Record that `id` went from `before` to `after` in `target`, collapsing with
 * any change already recorded for the same id:
 *
 *   added   + updated -> added (latest)
 *   added   + removed -> (nothing)
 *   updated + updated -> updated [original from, latest to]
 *   updated + removed -> removed (original from)
 *   removed + added   -> updated [removed, added] (or nothing if identical)
 */
export function applyChangeToDiff<R extends UnknownRecord>(
  target: RecordsDiff<R>,
  id: IdOf<R>,
  before: R | undefined,
  after: R | undefined,
): void {
  if (before === undefined && after === undefined) return

  if (id in target.added) {
    if (after === undefined) {
      delete target.added[id]
    } else {
      target.added[id] = after
    }
    return
  }

  if (id in target.updated) {
    const [from] = target.updated[id]!
    if (after === undefined) {
      delete target.updated[id]
      target.removed[id] = from
    } else if (from === after) {
      delete target.updated[id]
    } else {
      target.updated[id] = [from, after]
    }
    return
  }

  if (id in target.removed) {
    const original = target.removed[id]!
    if (after === undefined) return // removed twice: keep original
    delete target.removed[id]
    if (original !== after) target.updated[id] = [original, after]
    return
  }

  // No prior entry for this id.
  if (before === undefined) {
    if (after !== undefined) target.added[id] = after
  } else if (after === undefined) {
    target.removed[id] = before
  } else if (before !== after) {
    target.updated[id] = [before, after]
  }
}

/** Merge `diff` into `target` in place (see `applyChangeToDiff` for the rules). */
export function squashRecordDiffsMutable<R extends UnknownRecord>(
  target: RecordsDiff<R>,
  diff: RecordsDiff<R>,
): void {
  for (const id in diff.added) {
    applyChangeToDiff(target, id as IdOf<R>, undefined, diff.added[id as IdOf<R>]!)
  }
  for (const id in diff.updated) {
    const [from, to] = diff.updated[id as IdOf<R>]!
    applyChangeToDiff(target, id as IdOf<R>, from, to)
  }
  for (const id in diff.removed) {
    applyChangeToDiff(target, id as IdOf<R>, diff.removed[id as IdOf<R>]!, undefined)
  }
}

/** Squash a sequence of diffs into one equivalent diff (does not mutate inputs). */
export function squashRecordDiffs<R extends UnknownRecord>(diffs: readonly RecordsDiff<R>[]): RecordsDiff<R> {
  const result = createEmptyRecordsDiff<R>()
  for (const diff of diffs) squashRecordDiffsMutable(result, diff)
  return result
}

/** Shallow-copy a diff (entries are shared). */
export function cloneRecordsDiff<R extends UnknownRecord>(diff: RecordsDiff<R>): RecordsDiff<R> {
  return {
    added: { ...diff.added },
    updated: { ...diff.updated },
    removed: { ...diff.removed },
  } as RecordsDiff<R>
}
