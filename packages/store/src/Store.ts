import { atom, computed, transact, unsafe__withoutCapture, type Atom, type Computed } from "./_signals"
import type { IdOf, RecordFromId, RecordScope, RecordType, UnknownRecord } from "./ids"
import { parseRecordId, uniqueId } from "./ids"
import type { SerializedSchema, SerializedStore } from "./migrate"
import {
  applyChangeToDiff,
  createEmptyRecordsDiff,
  isRecordsDiffEmpty,
  type RecordsDiff,
} from "./RecordsDiff"
import type { StoreSchema, StoreSnapshot, StoreValidationPhase } from "./StoreSchema"

export type ChangeSource = "user" | "remote"

export interface HistoryEntry<R extends UnknownRecord> {
  changes: RecordsDiff<R>
  source: ChangeSource
}

export type StoreListener<R extends UnknownRecord> = (entry: HistoryEntry<R>) => void

export interface StoreListenerFilters {
  source: ChangeSource | "all"
  scope: RecordScope | "all"
}

export type RecordFromTypeName<R extends UnknownRecord, T extends string> = Extract<R, { typeName: T }>

export type StoreRecord<S extends Store<any, any>> = S extends Store<infer R, any> ? R : never

export interface StoreOptions<R extends UnknownRecord, Props> {
  schema: StoreSchema<R, Props>
  initialData?: SerializedStore<R> | undefined
  props: Props
  id?: string | undefined
}

/* ------------------------------------------------------------------------ */
/* side effects                                                             */
/* ------------------------------------------------------------------------ */

export type StoreBeforeCreateHandler<R extends UnknownRecord> = (record: R, source: ChangeSource) => R
export type StoreAfterCreateHandler<R extends UnknownRecord> = (record: R, source: ChangeSource) => void
export type StoreBeforeChangeHandler<R extends UnknownRecord> = (prev: R, next: R, source: ChangeSource) => R
export type StoreAfterChangeHandler<R extends UnknownRecord> = (prev: R, next: R, source: ChangeSource) => void
/** Return `false` to veto the deletion. */
export type StoreBeforeDeleteHandler<R extends UnknownRecord> = (record: R, source: ChangeSource) => void | false
export type StoreAfterDeleteHandler<R extends UnknownRecord> = (record: R, source: ChangeSource) => void
export type StoreOperationCompleteHandler = (source: ChangeSource) => void

export interface StoreSideEffectHandlers<R extends UnknownRecord> {
  beforeCreate?: StoreBeforeCreateHandler<R> | undefined
  afterCreate?: StoreAfterCreateHandler<R> | undefined
  beforeChange?: StoreBeforeChangeHandler<R> | undefined
  afterChange?: StoreAfterChangeHandler<R> | undefined
  beforeDelete?: StoreBeforeDeleteHandler<R> | undefined
  afterDelete?: StoreAfterDeleteHandler<R> | undefined
}

interface HandlerSets<R extends UnknownRecord> {
  beforeCreate: Set<StoreBeforeCreateHandler<R>>
  afterCreate: Set<StoreAfterCreateHandler<R>>
  beforeChange: Set<StoreBeforeChangeHandler<R>>
  afterChange: Set<StoreAfterChangeHandler<R>>
  beforeDelete: Set<StoreBeforeDeleteHandler<R>>
  afterDelete: Set<StoreAfterDeleteHandler<R>>
}

/**
 * Hooks that run around record writes. `before*` handlers may replace the
 * record being written (or veto a delete); `after*` handlers observe.
 * `operationComplete` handlers run once when the outermost operation ends,
 * before history listeners are notified.
 */
export class StoreSideEffects<R extends UnknownRecord> {
  private readonly byType = new Map<string, HandlerSets<R>>()
  private readonly operationComplete = new Set<StoreOperationCompleteHandler>()
  private enabled = true

  isEnabled(): boolean {
    return this.enabled
  }

  setIsEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  private sets(typeName: string): HandlerSets<R> {
    let sets = this.byType.get(typeName)
    if (!sets) {
      sets = {
        beforeCreate: new Set(),
        afterCreate: new Set(),
        beforeChange: new Set(),
        afterChange: new Set(),
        beforeDelete: new Set(),
        afterDelete: new Set(),
      }
      this.byType.set(typeName, sets)
    }
    return sets
  }

  private add<K extends keyof HandlerSets<R>>(
    typeName: string,
    kind: K,
    handler: HandlerSets<R>[K] extends Set<infer H> ? H : never,
  ): () => void {
    const set = this.sets(typeName)[kind] as Set<unknown>
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  /** Register several handlers for several types at once. Returns a disposer for all of them. */
  register(handlers: {
    [T in R["typeName"]]?: StoreSideEffectHandlers<RecordFromTypeName<R, T>>
  }): () => void {
    const disposers: (() => void)[] = []
    for (const [typeName, h] of Object.entries(handlers) as [string, StoreSideEffectHandlers<any> | undefined][]) {
      if (!h) continue
      if (h.beforeCreate) disposers.push(this.add(typeName, "beforeCreate", h.beforeCreate))
      if (h.afterCreate) disposers.push(this.add(typeName, "afterCreate", h.afterCreate))
      if (h.beforeChange) disposers.push(this.add(typeName, "beforeChange", h.beforeChange))
      if (h.afterChange) disposers.push(this.add(typeName, "afterChange", h.afterChange))
      if (h.beforeDelete) disposers.push(this.add(typeName, "beforeDelete", h.beforeDelete))
      if (h.afterDelete) disposers.push(this.add(typeName, "afterDelete", h.afterDelete))
    }
    return () => disposers.forEach((d) => d())
  }

  registerBeforeCreateHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreBeforeCreateHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "beforeCreate", handler as unknown as StoreBeforeCreateHandler<R>)
  }

  registerAfterCreateHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreAfterCreateHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "afterCreate", handler as unknown as StoreAfterCreateHandler<R>)
  }

  registerBeforeChangeHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreBeforeChangeHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "beforeChange", handler as unknown as StoreBeforeChangeHandler<R>)
  }

  registerAfterChangeHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreAfterChangeHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "afterChange", handler as unknown as StoreAfterChangeHandler<R>)
  }

  registerBeforeDeleteHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreBeforeDeleteHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "beforeDelete", handler as unknown as StoreBeforeDeleteHandler<R>)
  }

  registerAfterDeleteHandler<T extends R["typeName"]>(
    typeName: T,
    handler: StoreAfterDeleteHandler<RecordFromTypeName<R, T>>,
  ): () => void {
    return this.add(typeName, "afterDelete", handler as unknown as StoreAfterDeleteHandler<R>)
  }

  registerOperationCompleteHandler(handler: StoreOperationCompleteHandler): () => void {
    this.operationComplete.add(handler)
    return () => {
      this.operationComplete.delete(handler)
    }
  }

  /** @internal */
  handleBeforeCreate(record: R, source: ChangeSource): R {
    const sets = this.byType.get(record.typeName)
    if (!sets) return record
    let result = record
    for (const handler of sets.beforeCreate) result = handler(result, source)
    return result
  }

  /** @internal */
  handleAfterCreate(record: R, source: ChangeSource): void {
    const sets = this.byType.get(record.typeName)
    if (!sets) return
    for (const handler of sets.afterCreate) handler(record, source)
  }

  /** @internal */
  handleBeforeChange(prev: R, next: R, source: ChangeSource): R {
    const sets = this.byType.get(next.typeName)
    if (!sets) return next
    let result = next
    for (const handler of sets.beforeChange) result = handler(prev, result, source)
    return result
  }

  /** @internal */
  handleAfterChange(prev: R, next: R, source: ChangeSource): void {
    const sets = this.byType.get(next.typeName)
    if (!sets) return
    for (const handler of sets.afterChange) handler(prev, next, source)
  }

  /** @internal Returns false when a handler vetoed the delete. */
  handleBeforeDelete(record: R, source: ChangeSource): boolean {
    const sets = this.byType.get(record.typeName)
    if (!sets) return true
    for (const handler of sets.beforeDelete) {
      if (handler(record, source) === false) return false
    }
    return true
  }

  /** @internal */
  handleAfterDelete(record: R, source: ChangeSource): void {
    const sets = this.byType.get(record.typeName)
    if (!sets) return
    for (const handler of sets.afterDelete) handler(record, source)
  }

  /** @internal */
  handleOperationComplete(source: ChangeSource): void {
    for (const handler of this.operationComplete) handler(source)
  }
}

/* ------------------------------------------------------------------------ */
/* helpers                                                                  */
/* ------------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function shallowEqualObjects(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in b) || a[key] !== b[key]) return false
  }
  return true
}

/**
 * Records are considered unchanged when every top-level value is identical,
 * with `props` and `meta` compared one level deeper. Cheap enough to run on
 * every `put`, and avoids no-op history entries.
 */
export function isRecordShallowEqual(a: UnknownRecord, b: UnknownRecord): boolean {
  if (a === b) return true
  const ao = a as unknown as Record<string, unknown>
  const bo = b as unknown as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in bo)) return false
    const av = ao[key]
    const bv = bo[key]
    if (av === bv) continue
    if ((key === "props" || key === "meta") && isPlainObject(av) && isPlainObject(bv)) {
      if (!shallowEqualObjects(av, bv)) return false
      continue
    }
    return false
  }
  return true
}

/** Freeze a record and its `props` / `meta` bags (one level). */
export function freezeRecord<R extends UnknownRecord>(record: R): R {
  const r = record as unknown as Record<string, unknown>
  if (isPlainObject(r["props"]) && !Object.isFrozen(r["props"])) Object.freeze(r["props"])
  if (isPlainObject(r["meta"]) && !Object.isFrozen(r["meta"])) Object.freeze(r["meta"])
  return Object.freeze(record)
}

interface TypeIndex<R extends UnknownRecord> {
  /** Mutated in place on every add/remove: O(1) per record. */
  readonly live: Set<IdOf<R>>
  /** Bumped whenever `live` changes; the reactive handle on membership. */
  readonly epoch: Atom<number>
}

interface Listener<R extends UnknownRecord> {
  onHistory: StoreListener<R>
  filters: StoreListenerFilters
}

/* ------------------------------------------------------------------------ */
/* queries                                                                  */
/* ------------------------------------------------------------------------ */

/** Reactive views over the store's records, cached per type name. */
export class StoreQueries<R extends UnknownRecord> {
  private readonly idsCache = new Map<string, Computed<ReadonlySet<IdOf<R>>>>()
  private readonly recordsCache = new Map<string, Computed<R[]>>()

  constructor(private readonly store: Store<R, any>) {}

  /** The set of ids of every record of `typeName`. Maintained incrementally. */
  ids<T extends R["typeName"]>(typeName: T): Computed<ReadonlySet<IdOf<RecordFromTypeName<R, T>>>> {
    let c = this.idsCache.get(typeName)
    if (!c) {
      const index = this.store.getTypeIndex(typeName)
      c = computed(`store:${this.store.id}:ids:${typeName}`, () => {
        index.epoch.get()
        return new Set(index.live) as ReadonlySet<IdOf<R>>
      })
      this.idsCache.set(typeName, c)
    }
    return c as unknown as Computed<ReadonlySet<IdOf<RecordFromTypeName<R, T>>>>
  }

  /** Every record of `typeName`, in insertion order. */
  records<T extends R["typeName"]>(typeName: T): Computed<RecordFromTypeName<R, T>[]> {
    let c = this.recordsCache.get(typeName)
    if (!c) {
      const ids = this.ids(typeName)
      c = computed(`store:${this.store.id}:records:${typeName}`, () => {
        const result: R[] = []
        for (const id of ids.get()) {
          const record = this.store.get(id as IdOf<R>) as R | undefined
          if (record !== undefined) result.push(record)
        }
        return result
      })
      this.recordsCache.set(typeName, c)
    }
    return c as unknown as Computed<RecordFromTypeName<R, T>[]>
  }

  /** The first record of `typeName` matching `predicate` (or the first record, when omitted). */
  record<T extends R["typeName"]>(
    typeName: T,
    predicate?: (record: RecordFromTypeName<R, T>) => boolean,
  ): Computed<RecordFromTypeName<R, T> | undefined> {
    const records = this.records(typeName)
    return computed(`store:${this.store.id}:record:${typeName}`, () => {
      const all = records.get()
      if (!predicate) return all[0]
      for (const record of all) if (predicate(record)) return record
      return undefined
    })
  }

  /** Non-reactive filter over the records of `typeName`. */
  exec<T extends R["typeName"]>(
    typeName: T,
    predicate: (record: RecordFromTypeName<R, T>) => boolean,
  ): RecordFromTypeName<R, T>[] {
    return unsafe__withoutCapture(() => this.records(typeName).get().filter(predicate))
  }
}

/* ------------------------------------------------------------------------ */
/* store                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * A reactive, transactional collection of records.
 *
 * - one atom per record, so consumers subscribe to exactly what they read
 * - per-type id sets maintained incrementally
 * - writes are batched; listeners receive one squashed diff per outermost operation
 * - records are frozen on write
 */
export class Store<R extends UnknownRecord = UnknownRecord, Props = unknown> {
  readonly id: string
  readonly schema: StoreSchema<R, Props>
  readonly props: Props
  readonly scopedTypes: { readonly [S in RecordScope]: ReadonlySet<string> }
  readonly sideEffects = new StoreSideEffects<R>()
  readonly query: StoreQueries<R>
  /** Bumped once per completed operation that changed something. */
  readonly history: Atom<number>

  private readonly records = new Map<IdOf<R>, Atom<R | undefined>>()
  private readonly typeIndexes = new Map<string, TypeIndex<R>>()
  private readonly listeners = new Set<Listener<R>>()
  private pendingEntries: HistoryEntry<R>[] = []
  private readonly extractStack: RecordsDiff<R>[] = []
  private depth = 0
  private source: ChangeSource = "user"
  private runCallbacks = true
  private inOperationComplete = false
  private disposed = false

  constructor(options: StoreOptions<R, Props>) {
    this.id = options.id ?? uniqueId()
    this.schema = options.schema
    this.props = options.props
    this.history = atom(`store:${this.id}:history`, 0)
    this.query = new StoreQueries(this)

    const scoped = { document: new Set<string>(), session: new Set<string>(), presence: new Set<string>() }
    for (const type of Object.values(this.schema.types) as RecordType<R, any>[]) {
      scoped[type.scope].add(type.typeName)
    }
    this.scopedTypes = scoped

    if (options.initialData) {
      const records = Object.values(options.initialData) as R[]
      this.atomic(() => this.put(records, "initialize"), { runCallbacks: false })
    }
  }

  /* ---- reading ---------------------------------------------------------- */

  /** @internal */
  getTypeIndex(typeName: string): TypeIndex<R> {
    let index = this.typeIndexes.get(typeName)
    if (!index) {
      index = { live: new Set(), epoch: atom(`store:${this.id}:index:${typeName}`, 0) }
      this.typeIndexes.set(typeName, index)
    }
    return index
  }

  /** Get a record (reactive: subscribes to the record, or to its type's membership when absent). */
  get<K extends IdOf<R>>(id: K): RecordFromId<K> | undefined {
    const a = this.records.get(id)
    if (a) return a.get() as RecordFromId<K> | undefined
    // Not present: depend on membership of this id's type so creation is observed.
    this.getTypeIndex(typeNameOfId(id)).epoch.get()
    return undefined
  }

  /** Get a record without registering a reactive dependency. */
  unsafeGetWithoutCapture<K extends IdOf<R>>(id: K): RecordFromId<K> | undefined {
    const a = this.records.get(id)
    return a ? (unsafe__withoutCapture(() => a.get()) as RecordFromId<K> | undefined) : undefined
  }

  has<K extends IdOf<R>>(id: K): boolean {
    return this.get(id) !== undefined
  }

  /** All records (reactive over every record and every type's membership). */
  allRecords(): R[] {
    for (const index of this.typeIndexes.values()) index.epoch.get()
    const result: R[] = []
    for (const a of this.records.values()) {
      const record = a.get()
      if (record !== undefined) result.push(record)
    }
    return result
  }

  /** Scope of a record type; unknown types are `document`. */
  getScope(typeName: string): RecordScope {
    return this.schema.getScope(typeName)
  }

  /* ---- writing ---------------------------------------------------------- */

  /**
   * Insert or update records. Records are validated, passed through `before*`
   * side effects, frozen, and written. `after*` side effects run once every
   * record in the call has been written.
   */
  put(records: readonly R[], phaseOverride?: StoreValidationPhase): void {
    this.atomic(() => {
      const source = this.source
      const callbacks = this.runCallbacks && this.sideEffects.isEnabled()
      const created: R[] = []
      const changed: [R, R][] = []

      for (const record of records) {
        const id = record.id
        const existing = this.records.get(id)
        const before = existing?.get()

        if (before !== undefined) {
          if (before === record) continue
          let next = this.schema.validateRecord(this, record, phaseOverride ?? "updateRecord", before)
          if (callbacks) next = this.sideEffects.handleBeforeChange(before, next, source)
          if (next === before || isRecordShallowEqual(before, next)) continue
          if (next.id !== id) {
            throw new Error(`Cannot change the id of a record (${id} -> ${next.id})`)
          }
          freezeRecord(next)
          if (before.typeName !== next.typeName) {
            this.removeFromIndex(before.typeName, id)
            this.addToIndex(next.typeName, id)
          }
          existing!.set(next)
          this.recordChange(id, before, next)
          changed.push([before, next])
        } else {
          let next = this.schema.validateRecord(this, record, phaseOverride ?? "createRecord", undefined)
          if (callbacks) next = this.sideEffects.handleBeforeCreate(next, source)
          if (next.id !== id) {
            throw new Error(`Cannot change the id of a record (${id} -> ${next.id})`)
          }
          freezeRecord(next)
          const a = existing ?? atom<R | undefined>(`store:${this.id}:record:${id}`, undefined)
          a.set(next)
          this.records.set(id, a)
          this.addToIndex(next.typeName, id)
          this.recordChange(id, undefined, next)
          created.push(next)
        }
      }

      if (callbacks) {
        for (const record of created) this.sideEffects.handleAfterCreate(record, source)
        for (const [prev, next] of changed) this.sideEffects.handleAfterChange(prev, next, source)
      }
    })
  }

  /** Remove records by id. Missing ids are ignored. `beforeDelete` handlers may veto. */
  remove(ids: readonly IdOf<R>[]): void {
    this.atomic(() => {
      const source = this.source
      const callbacks = this.runCallbacks && this.sideEffects.isEnabled()
      const toRemove: R[] = []

      for (const id of ids) {
        const a = this.records.get(id)
        if (!a) continue
        const record = a.get()
        if (record === undefined) continue
        if (callbacks && !this.sideEffects.handleBeforeDelete(record, source)) continue
        toRemove.push(record)
      }

      const removed: R[] = []
      for (const record of toRemove) {
        const a = this.records.get(record.id)
        if (!a) continue // a handler already removed it
        const current = a.get()
        if (current === undefined) continue
        a.set(undefined)
        this.records.delete(record.id)
        this.removeFromIndex(current.typeName, record.id)
        this.recordChange(record.id, current, undefined)
        removed.push(current)
      }

      if (callbacks) {
        for (const record of removed) this.sideEffects.handleAfterDelete(record, source)
      }
    })
  }

  /** Remove every record. */
  clear(): void {
    this.remove(Array.from(this.records.keys()))
  }

  /**
   * Update one record with a function. No-op when the record does not exist.
   */
  update<K extends IdOf<R>>(id: K, updater: (record: RecordFromId<K>) => RecordFromId<K>): void {
    const current = this.unsafeGetWithoutCapture(id)
    if (current === undefined) return
    this.put([updater(current) as unknown as R])
  }

  /* ---- transactions ----------------------------------------------------- */

  /**
   * Run `fn` as one operation: side effects' `operationComplete` handlers run
   * once at the end, and listeners get a single squashed history entry.
   */
  atomic<T>(fn: () => T, options?: { source?: ChangeSource | undefined; runCallbacks?: boolean | undefined }): T {
    const prevSource = this.source
    const prevRunCallbacks = this.runCallbacks
    if (options?.source !== undefined) this.source = options.source
    if (options?.runCallbacks !== undefined) this.runCallbacks = options.runCallbacks
    const source = this.source
    const runCallbacks = this.runCallbacks
    this.depth++
    try {
      return transact(() => unsafe__withoutCapture(fn))
    } finally {
      this.depth--
      if (this.depth === 0) {
        try {
          this.completeOperation(source, runCallbacks)
        } finally {
          this.source = prevSource
          this.runCallbacks = prevRunCallbacks
        }
      } else {
        this.source = prevSource
        this.runCallbacks = prevRunCallbacks
      }
    }
  }

  /** Changes made inside `fn` are reported to listeners with source `remote`. */
  mergeRemoteChanges(fn: () => void): void {
    this.atomic(fn, { source: "remote" })
  }

  /** Run `fn` and return the squashed diff of everything it changed. Listeners are still notified. */
  extractingChanges(fn: () => void): RecordsDiff<R> {
    const diff = createEmptyRecordsDiff<R>()
    this.extractStack.push(diff)
    try {
      this.atomic(fn)
    } finally {
      this.extractStack.pop()
    }
    return diff
  }

  /**
   * Apply a diff (e.g. from `extractingChanges` or `reverseRecordsDiff`).
   * With `ignoreEphemeralKeys`, ephemeral keys of updated records keep their
   * current store values instead of the diff's.
   */
  applyDiff(
    diff: RecordsDiff<R>,
    options?: { runCallbacks?: boolean | undefined; ignoreEphemeralKeys?: boolean | undefined },
  ): void {
    const runCallbacks = options?.runCallbacks ?? true
    const ignoreEphemeralKeys = options?.ignoreEphemeralKeys ?? false
    this.atomic(
      () => {
        const toPut: R[] = []
        for (const id in diff.added) toPut.push(diff.added[id as IdOf<R>]!)
        for (const id in diff.updated) {
          let [, to] = diff.updated[id as IdOf<R>]!
          if (ignoreEphemeralKeys) {
            const current = this.unsafeGetWithoutCapture(id as IdOf<R>)
            const type = this.schema.getType(to.typeName)
            if (current !== undefined && type && type.ephemeralKeySet.size > 0) {
              const merged: Record<string, unknown> = { ...(to as unknown as Record<string, unknown>) }
              const cur = current as unknown as Record<string, unknown>
              for (const key of type.ephemeralKeySet) {
                if (key in cur) merged[key] = cur[key]
                else delete merged[key]
              }
              to = merged as unknown as R
            }
          }
          toPut.push(to)
        }
        this.put(toPut)
        const toRemove = Object.keys(diff.removed) as IdOf<R>[]
        if (toRemove.length > 0) this.remove(toRemove)
      },
      { runCallbacks },
    )
  }

  /* ---- listening -------------------------------------------------------- */

  /**
   * Subscribe to history entries. Called after each outermost operation with
   * the squashed changes, filtered by source and record scope.
   */
  listen(onHistory: StoreListener<R>, filters?: Partial<StoreListenerFilters>): () => void {
    const listener: Listener<R> = {
      onHistory,
      filters: { source: filters?.source ?? "all", scope: filters?.scope ?? "all" },
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /* ---- persistence ------------------------------------------------------ */

  /** Plain-object snapshot of the records in `scope` (default `document`). */
  serialize(scope: RecordScope | "all" = "document"): SerializedStore<R> {
    const result = {} as SerializedStore<R>
    unsafe__withoutCapture(() => {
      for (const [id, a] of this.records) {
        const record = a.get()
        if (record === undefined) continue
        if (scope === "all" || this.getScope(record.typeName) === scope) result[id] = record
      }
    })
    return result
  }

  getStoreSnapshot(scope: RecordScope | "all" = "document"): StoreSnapshot<R> {
    return { store: this.serialize(scope), schema: this.schema.serialize() }
  }

  /**
   * Replace the store's contents with a snapshot (migrating it first).
   * Existing records in `document` scope and in every scope present in the
   * snapshot are removed unless the snapshot contains them; other scopes are
   * left alone. Side effects do not run; listeners are notified.
   */
  loadStoreSnapshot(snapshot: StoreSnapshot<R>): void {
    const migrated = this.schema.migrateStoreSnapshot(snapshot)
    if (migrated.type === "error") {
      throw new Error(`Failed to migrate snapshot: ${migrated.reason}`)
    }
    const incoming = migrated.value
    const records = Object.values(incoming) as R[]
    this.atomic(
      () => {
        const scopes = new Set<RecordScope>(["document"])
        for (const record of records) scopes.add(this.getScope(record.typeName))
        const toRemove: IdOf<R>[] = []
        for (const [id, a] of this.records) {
          const record = a.get()
          if (record === undefined) continue
          if (scopes.has(this.getScope(record.typeName)) && !(id in incoming)) toRemove.push(id)
        }
        this.remove(toRemove)
        this.put(records, "initialize")
      },
      { runCallbacks: false },
    )
  }

  /* ---- derived caches --------------------------------------------------- */

  /**
   * A per-record derived value, recomputed only when that record changes.
   * Entries are dropped automatically when records are removed.
   */
  createComputedCache<T, K extends IdOf<R> = IdOf<R>>(
    name: string,
    derive: (record: RecordFromId<K>) => T,
    options?: { isEqual?: ((a: T, b: T) => boolean) | undefined },
  ): { get(id: K): T | undefined } {
    const cache = new WeakMap<Atom<R | undefined>, Computed<T | undefined>>()
    return {
      get: (id: K) => {
        const a = this.records.get(id)
        if (!a) {
          this.getTypeIndex(typeNameOfId(id)).epoch.get()
          return undefined
        }
        let c = cache.get(a)
        if (!c) {
          c = computed(
            `${name}:${id}`,
            () => {
              const record = a.get()
              return record === undefined ? undefined : derive(record as unknown as RecordFromId<K>)
            },
            options?.isEqual
              ? { isEqual: (x, y) => (x === undefined || y === undefined ? x === y : options.isEqual!(x, y)) }
              : undefined,
          )
          cache.set(a, c)
        }
        return c.get()
      },
    }
  }

  /* ---- lifecycle -------------------------------------------------------- */

  isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /* ---- internals -------------------------------------------------------- */

  private addToIndex(typeName: string, id: IdOf<R>) {
    const index = this.getTypeIndex(typeName)
    if (index.live.has(id)) return
    index.live.add(id)
    index.epoch.update((n) => n + 1)
  }

  private removeFromIndex(typeName: string, id: IdOf<R>) {
    const index = this.typeIndexes.get(typeName)
    if (!index || !index.live.delete(id)) return
    index.epoch.update((n) => n + 1)
  }

  private recordChange(id: IdOf<R>, before: R | undefined, after: R | undefined) {
    const last = this.pendingEntries[this.pendingEntries.length - 1]
    let entry: HistoryEntry<R>
    if (last && last.source === this.source) {
      entry = last
    } else {
      entry = { changes: createEmptyRecordsDiff<R>(), source: this.source }
      this.pendingEntries.push(entry)
    }
    applyChangeToDiff(entry.changes, id, before, after)
    for (const diff of this.extractStack) applyChangeToDiff(diff, id, before, after)
  }

  private completeOperation(source: ChangeSource, runCallbacks: boolean) {
    if (!this.pendingEntries.some((e) => !isRecordsDiffEmpty(e.changes))) {
      this.pendingEntries = []
      return
    }
    if (runCallbacks && this.sideEffects.isEnabled() && !this.inOperationComplete) {
      this.inOperationComplete = true
      const prevSource = this.source
      this.source = source
      this.depth++
      try {
        transact(() => unsafe__withoutCapture(() => this.sideEffects.handleOperationComplete(source)))
      } finally {
        this.depth--
        this.source = prevSource
        this.inOperationComplete = false
      }
    }
    this.history.update((n) => n + 1)
    this.flushHistory()
  }

  private flushHistory() {
    const entries = this.pendingEntries
    this.pendingEntries = []
    if (this.listeners.size === 0) return
    for (const entry of entries) {
      if (isRecordsDiffEmpty(entry.changes)) continue
      for (const listener of Array.from(this.listeners)) {
        if (listener.filters.source !== "all" && listener.filters.source !== entry.source) continue
        const changes =
          listener.filters.scope === "all" ? entry.changes : this.filterDiffByScope(entry.changes, listener.filters.scope)
        if (isRecordsDiffEmpty(changes)) continue
        listener.onHistory({ changes, source: entry.source })
      }
    }
  }

  private filterDiffByScope(diff: RecordsDiff<R>, scope: RecordScope): RecordsDiff<R> {
    const result = createEmptyRecordsDiff<R>()
    for (const id in diff.added) {
      const record = diff.added[id as IdOf<R>]!
      if (this.getScope(record.typeName) === scope) result.added[id as IdOf<R>] = record
    }
    for (const id in diff.updated) {
      const pair = diff.updated[id as IdOf<R>]!
      if (this.getScope(pair[1].typeName) === scope) result.updated[id as IdOf<R>] = pair
    }
    for (const id in diff.removed) {
      const record = diff.removed[id as IdOf<R>]!
      if (this.getScope(record.typeName) === scope) result.removed[id as IdOf<R>] = record
    }
    return result
  }
}

function typeNameOfId(id: string): string {
  const colon = id.indexOf(":")
  return colon > 0 ? id.slice(0, colon) : parseRecordId(id).typeName
}
