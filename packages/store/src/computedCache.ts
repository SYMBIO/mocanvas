/**
 * Standalone per-record memos.
 *
 * `Store.createComputedCache` already memoizes a value per record, but it is a
 * method: the cache belongs to one store instance, and the derivation cannot see
 * anything else. A shape util or binding util usually needs the opposite shape —
 * one cache declared once at module scope, derived from a record *and* the editor
 * that owns it, and shared by every store that editor drives.
 *
 * `createComputedCache` is that form. The context is passed in at `get` time and
 * the underlying per-record cache is created lazily, once per context.
 */
import type { IdOf, RecordId, UnknownRecord } from "./ids"
import { Store } from "./Store"

/**
 * A context a computed cache can read a store from: a store itself, or anything
 * holding one (an `Editor`).
 */
export type ComputedCacheContext = Store<any, any> | { readonly store: Store<any, any> }

/** The handle returned by {@link createComputedCache}. */
export interface ComputedCache<Context, R extends UnknownRecord, Result> {
  /** The derived value for `id`, or `undefined` if no such record exists. */
  get(context: Context, id: IdOf<R>): Result | undefined
}

/** Options for {@link createComputedCache}. */
export interface CreateComputedCacheOptions<Result> {
  /**
   * Treat two derived values as the same, so dependents are not woken when the
   * derivation recomputes to an equivalent result.
   */
  isEqual?: ((a: Result, b: Result) => boolean) | undefined
}

function storeOf(context: unknown): Store<any, any> {
  if (context instanceof Store) return context
  const store = (context as { store?: unknown } | null | undefined)?.store
  if (store instanceof Store) return store
  throw new Error("createComputedCache: context is neither a Store nor an object holding one")
}

/**
 * Declare a per-record memo, keyed by record id, recomputed only when that
 * record changes.
 *
 * ```ts
 * const bindingsCache = createComputedCache("connection bindings", (editor: Editor, shape: TLShape) =>
 *   editor.getBindingsFromShape(shape.id, "connection"),
 * )
 * bindingsCache.get(editor, shapeId)
 * ```
 *
 * SEMANTICS-ASSUMED: `Context` is unconstrained rather than bound to
 * {@link ComputedCacheContext}. The consumer annotates the derivation's own
 * parameter (`(editor: Editor, shape: TLShape) => …`) and that is what `get`
 * must accept; constraining the type parameter as well would force every caller
 * to prove `Editor` is structurally a store holder at each call site for no
 * added safety. The store is resolved at `get` time instead, and a context that
 * carries none throws immediately rather than silently returning `undefined`.
 */
export function createComputedCache<Context, R extends UnknownRecord, Result>(
  name: string,
  derive: (context: Context, record: R) => Result,
  options?: CreateComputedCacheOpts<Result, R>,
): ComputedCache<Context, R, Result> {
  // Keyed on the context object, so an editor that is torn down takes its
  // caches with it and a second editor does not read the first one's values.
  const perContext = new WeakMap<object, { get(id: RecordId<UnknownRecord>): Result | undefined }>()

  return {
    get(context: Context, id: IdOf<R>): Result | undefined {
      const key = context as unknown as object
      if (key === null || (typeof key !== "object" && typeof key !== "function")) {
        throw new Error("createComputedCache: context must be an object")
      }
      let cache = perContext.get(key)
      if (!cache) {
        // `areRecordsEqual` gates the derivation itself: when the incoming
        // record is equivalent to the one the last result came from, the
        // previous result is handed back untouched.
        const areRecordsEqual = options?.areRecordsEqual
        // Memoized per record id, not per cache: one shared "last record" would
        // compare a shape against whichever unrelated shape was derived before it.
        const previous = new Map<string, { record: R; result: Result }>()
        const derivation = areRecordsEqual
          ? (record: UnknownRecord): Result => {
              const next = record as R
              const last = previous.get(record.id)
              if (last && areRecordsEqual(last.record, next)) return last.result
              const result = derive(context, next)
              previous.set(record.id, { record: next, result })
              return result
            }
          : (record: UnknownRecord): Result => derive(context, record as R)

        cache = storeOf(context).createComputedCache<Result>(
          name,
          derivation,
          options?.isEqual ? { isEqual: options.isEqual } : undefined,
        )
        perContext.set(key, cache)
      }
      return cache.get(id as unknown as RecordId<UnknownRecord>)
    },
  }
}

/**
 * Options for {@link createComputedCache}, including the record-level equality
 * that decides when a derivation is worth re-running at all.
 */
export type CreateComputedCacheOpts<Result, R extends UnknownRecord = UnknownRecord> =
  CreateComputedCacheOptions<Result> & {
    /**
     * Treat two versions of the *record* as the same, so the derivation is not
     * re-run when only parts it does not read have changed.
     *
     * `isEqual` compares results and can only save the dependents work;
     * `areRecordsEqual` compares inputs and saves the derivation itself. Use it
     * when the derivation is expensive and reads only a couple of fields —
     * geometry from `props`, say, which should not be rebuilt because the shape
     * moved.
     */
    areRecordsEqual?: ((a: R, b: R) => boolean) | undefined
  }
