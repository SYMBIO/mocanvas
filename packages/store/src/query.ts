/**
 * Declarative queries over the store, and the incremental indexes they run on.
 *
 * A query is a plain object — `{ type: { eq: "geo" }, parentId: { eq: pageId } }`
 * — rather than a predicate function, and that is the point: an object can be
 * inspected. The store picks one of the query's properties, maintains an index
 * from that property's value to the ids that hold it, and answers the query by
 * intersecting index buckets instead of scanning every record. A predicate can
 * only be run over everything.
 *
 * The index is itself a signal, and it carries diffs: a dependent that already
 * built a result can patch it from {@link RSIndexDiff} rather than rebuilding.
 */

import type { IdOf, UnknownRecord } from "./ids"

/**
 * What changed in a set: the members added and the members removed.
 *
 * Either side may be absent, which means "nothing on that side" — a diff with
 * neither is a diff that says nothing happened.
 */
export interface CollectionDiff<T> {
  added?: Set<T>
  removed?: Set<T>
}

/**
 * How one property of a record is matched.
 *
 * SEMANTICS-ASSUMED: three comparisons — equality, inequality and a numeric
 * greater-than — are what an index can answer without scanning, which is the
 * whole reason queries are data rather than functions. `gt` is deliberately
 * numeric: the only ordered property records carry is a number.
 */
export type QueryValueMatcher<T> = { eq: T } | { neq: T } | { gt: number }

/**
 * A query over the records of one type: property name to matcher, every entry
 * of which must hold (they are ANDed).
 *
 * ```ts
 * store.query.records("shape", () => ({ type: { eq: "geo" }, isLocked: { eq: false } }))
 * ```
 */
export type QueryExpression<R extends object> = {
  [K in keyof R]?: QueryValueMatcher<R[K]>
}

/**
 * An index over one property of one record type: for each value that property
 * takes, the ids of the records that hold it.
 */
export type RSIndexMap<R extends UnknownRecord, Property extends keyof R & string = keyof R & string> = Map<
  R[Property],
  Set<IdOf<R>>
>

/** How an {@link RSIndexMap} changed: per property value, which ids joined and left. */
export type RSIndexDiff<R extends UnknownRecord, Property extends keyof R & string = keyof R & string> = Map<
  R[Property],
  CollectionDiff<IdOf<R>>
>

/**
 * A live index over one property, as a diff-carrying signal.
 *
 * Reading it gives the current {@link RSIndexMap}; asking it for the diffs
 * since a past epoch gives {@link RSIndexDiff}s that describe how to get from
 * the old map to the new one.
 */
export type RSIndex<R extends UnknownRecord, Property extends keyof R & string = keyof R & string> = import("./_signals").Computed<
  RSIndexMap<R, Property>,
  RSIndexDiff<R, Property>
>

/** Whether `value` satisfies `matcher`. */
export function matchesQueryValue<T>(matcher: QueryValueMatcher<T>, value: T): boolean {
  if ("eq" in matcher) return Object.is(matcher.eq, value)
  if ("neq" in matcher) return !Object.is(matcher.neq, value)
  return typeof value === "number" && value > matcher.gt
}

/** Whether `record` satisfies every entry of `query`. An empty query matches everything. */
export function matchesQuery<R extends object>(query: QueryExpression<R>, record: R): boolean {
  for (const key of Object.keys(query) as (keyof R)[]) {
    const matcher = query[key]
    if (matcher === undefined) continue
    if (!matchesQueryValue(matcher, record[key])) return false
  }
  return true
}

/**
 * The property this query can be answered from an index on, or `undefined`
 * when none of it is indexable.
 *
 * Only an `eq` clause narrows to a single index bucket; `neq` and `gt` still
 * need every bucket looked at, so they are no better than a scan. The first
 * `eq` wins — the remaining clauses are checked against the records it yields.
 */
export function getIndexablePropertyOf<R extends object>(query: QueryExpression<R>): (keyof R & string) | undefined {
  for (const key of Object.keys(query) as (keyof R & string)[]) {
    const matcher = query[key]
    if (matcher && "eq" in matcher) return key
  }
  return undefined
}

/** Apply a {@link CollectionDiff} to a set, in place. */
export function applyCollectionDiff<T>(set: Set<T>, diff: CollectionDiff<T>): Set<T> {
  if (diff.removed) for (const value of diff.removed) set.delete(value)
  if (diff.added) for (const value of diff.added) set.add(value)
  return set
}

/** Whether a {@link CollectionDiff} describes no change at all. */
export function isCollectionDiffEmpty<T>(diff: CollectionDiff<T>): boolean {
  return (diff.added?.size ?? 0) === 0 && (diff.removed?.size ?? 0) === 0
}
