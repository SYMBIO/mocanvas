import { describe, expect, it, vi } from "vitest"
import { computed, react, transact } from "./_signals"
import { createRecordType, type BaseRecord, type RecordId } from "./ids"
import { createEmptyRecordsDiff, reverseRecordsDiff, type RecordsDiff } from "./RecordsDiff"
import { Store, type HistoryEntry } from "./Store"
import { StoreSchema } from "./StoreSchema"

interface Book extends BaseRecord<"book", RecordId<Book>> {
  title: string
  authorId: RecordId<Author>
  pages: number
  props: { color: string }
}
interface Author extends BaseRecord<"author", RecordId<Author>> {
  name: string
}
interface Cursor extends BaseRecord<"cursor", RecordId<Cursor>> {
  x: number
  hovered: boolean
}
type R = Book | Author | Cursor

const Book = createRecordType<Book>("book", { scope: "document" }).withDefaultProperties(() => ({
  pages: 100,
  props: { color: "red" },
}))
const Author = createRecordType<Author>("author", { scope: "document" })
const Cursor = createRecordType<Cursor>("cursor", {
  scope: "session",
  ephemeralKeys: { x: false, hovered: true },
})

function makeStore(options?: { onValidationFailure?: (r: R) => R; strict?: boolean }) {
  const StrictAuthor = options?.strict
    ? createRecordType<Author>("author", {
        scope: "document",
        validator: {
          validate(record) {
            const r = record as Author
            if (typeof r.name !== "string") throw new Error("name must be a string")
            return r
          },
        },
      })
    : Author
  const schema = StoreSchema.create<R>(
    { book: Book, author: StrictAuthor, cursor: Cursor },
    options?.onValidationFailure ? { onValidationFailure: ({ record }) => options.onValidationFailure!(record) } : {},
  )
  return new Store<R>({ schema, props: undefined })
}

const herbert = Author.create({ id: Author.createId("herbert"), name: "Frank Herbert" })
const dune = Book.create({ id: Book.createId("dune"), title: "Dune", authorId: herbert.id })

function collect(store: Store<R>, filters?: Parameters<Store<R>["listen"]>[1]) {
  const entries: HistoryEntry<R>[] = []
  const dispose = store.listen((e) => entries.push(e), filters)
  return { entries, dispose }
}

describe("Store basics", () => {
  it("puts, gets, has, removes", () => {
    const store = makeStore()
    store.put([herbert, dune])
    expect(store.get(dune.id)).toEqual(dune)
    expect(store.has(herbert.id)).toBe(true)
    expect(store.allRecords()).toHaveLength(2)
    store.remove([dune.id])
    expect(store.get(dune.id)).toBeUndefined()
    expect(store.has(dune.id)).toBe(false)
    store.remove([dune.id]) // missing ids are ignored
    store.clear()
    expect(store.allRecords()).toEqual([])
  })

  it("freezes records (and props/meta) on put", () => {
    const store = makeStore()
    store.put([dune])
    const stored = store.get(dune.id)!
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored.props)).toBe(true)
  })

  it("loads initialData without side effects", () => {
    const schema = makeStore().schema
    const before = vi.fn((r: Book) => r)
    const store = new Store<R>({
      schema,
      props: undefined,
      initialData: { [herbert.id]: herbert, [dune.id]: dune } as never,
    })
    store.sideEffects.registerBeforeCreateHandler("book", before)
    expect(store.allRecords()).toHaveLength(2)
    expect(before).not.toHaveBeenCalled()
  })

  it("update helper applies a function", () => {
    const store = makeStore()
    store.put([dune])
    store.update(dune.id, (b) => ({ ...b, pages: 500 }))
    expect(store.get(dune.id)!.pages).toBe(500)
  })

  it("scopedTypes groups type names by scope", () => {
    const store = makeStore()
    expect([...store.scopedTypes.document].sort()).toEqual(["author", "book"])
    expect([...store.scopedTypes.session]).toEqual(["cursor"])
    expect(store.scopedTypes.presence.size).toBe(0)
  })
})

describe("Store history / listen", () => {
  it("reports added, updated and removed records", () => {
    const store = makeStore()
    const { entries } = collect(store)

    store.put([dune])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.source).toBe("user")
    expect(entries[0]!.changes.added[dune.id]).toEqual(dune)

    const dune2 = { ...dune, pages: 999 }
    store.put([dune2])
    expect(entries).toHaveLength(2)
    expect(entries[1]!.changes.updated[dune.id]).toEqual([dune, dune2])

    store.remove([dune.id])
    expect(entries).toHaveLength(3)
    expect(entries[2]!.changes.removed[dune.id]).toEqual(dune2)
  })

  it("does not notify for no-op puts", () => {
    const store = makeStore()
    store.put([dune])
    const { entries } = collect(store)
    store.put([dune]) // same reference
    store.put([{ ...dune, props: { ...dune.props } }]) // structurally equal
    expect(entries).toHaveLength(0)
    expect(store.get(dune.id)).toBe(store.get(dune.id))
  })

  it("squashes everything inside atomic() into one entry", () => {
    const store = makeStore()
    const { entries } = collect(store)
    const dune2 = { ...dune, pages: 1 }
    store.atomic(() => {
      store.put([herbert])
      store.put([dune])
      store.put([dune2])
      store.atomic(() => store.remove([herbert.id]))
      expect(entries).toHaveLength(0) // nothing until the outermost completes
    })
    expect(entries).toHaveLength(1)
    const changes = entries[0]!.changes
    expect(changes.added[dune.id]).toEqual(dune2)
    expect(changes.updated).toEqual({})
    expect(changes.removed).toEqual({}) // added then removed -> nothing
  })

  it("does not notify when the squashed diff is empty", () => {
    const store = makeStore()
    const { entries } = collect(store)
    store.atomic(() => {
      store.put([dune])
      store.remove([dune.id])
    })
    expect(entries).toHaveLength(0)
  })

  it("update then remove squashes to removed(original)", () => {
    const store = makeStore()
    store.put([dune])
    const { entries } = collect(store)
    store.atomic(() => {
      store.put([{ ...dune, pages: 5 }])
      store.remove([dune.id])
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.changes.removed[dune.id]).toEqual(dune)
  })

  it("distinguishes user and remote sources and filters on them", () => {
    const store = makeStore()
    const all = collect(store)
    const user = collect(store, { source: "user" })
    const remote = collect(store, { source: "remote" })

    store.put([herbert])
    store.mergeRemoteChanges(() => store.put([dune]))

    expect(all.entries.map((e) => e.source)).toEqual(["user", "remote"])
    expect(user.entries).toHaveLength(1)
    expect(user.entries[0]!.changes.added[herbert.id]).toBeDefined()
    expect(remote.entries).toHaveLength(1)
    expect(remote.entries[0]!.changes.added[dune.id]).toBeDefined()
  })

  it("emits separate entries per source within one operation", () => {
    const store = makeStore()
    const { entries } = collect(store)
    store.atomic(() => {
      store.put([herbert])
      store.mergeRemoteChanges(() => store.put([dune]))
      store.put([{ ...herbert, name: "F. Herbert" }])
    })
    expect(entries.map((e) => e.source)).toEqual(["user", "remote", "user"])
  })

  it("filters by scope", () => {
    const store = makeStore()
    const doc = collect(store, { scope: "document" })
    const session = collect(store, { scope: "session" })
    const cursor = Cursor.create({ id: Cursor.createId("c"), x: 1, hovered: false })
    store.atomic(() => store.put([dune, cursor]))
    expect(Object.keys(doc.entries[0]!.changes.added)).toEqual([dune.id])
    expect(Object.keys(session.entries[0]!.changes.added)).toEqual([cursor.id])
    store.put([cursor]) // no-op
    store.put([{ ...cursor, x: 2 }])
    expect(doc.entries).toHaveLength(1) // session-only change not delivered to document listener
    expect(session.entries).toHaveLength(2)
  })

  it("stops delivering after dispose", () => {
    const store = makeStore()
    const { entries, dispose } = collect(store)
    store.put([dune])
    dispose()
    store.put([herbert])
    expect(entries).toHaveLength(1)
  })

  it("bumps the history epoch once per completed operation", () => {
    const store = makeStore()
    const start = store.history.get()
    store.atomic(() => {
      store.put([dune])
      store.put([herbert])
    })
    expect(store.history.get()).toBe(start + 1)
    store.put([dune]) // no-op
    expect(store.history.get()).toBe(start + 1)
  })

  it("listeners may write to the store (nested operations flush separately)", () => {
    const store = makeStore()
    const seen: string[] = []
    store.listen((e) => {
      seen.push(Object.keys(e.changes.added).join(","))
      if (e.changes.added[dune.id]) store.put([herbert])
    })
    store.put([dune])
    expect(seen).toEqual([dune.id, herbert.id])
  })
})

describe("extractingChanges / applyDiff", () => {
  it("extracts the diff of a function and can undo it", () => {
    const store = makeStore()
    store.put([herbert])
    const { entries } = collect(store)
    const diff = store.extractingChanges(() => {
      store.put([dune])
      store.put([{ ...herbert, name: "F.H." }])
    })
    expect(entries).toHaveLength(1) // listeners still notified
    expect(Object.keys(diff.added)).toEqual([dune.id])
    expect((diff.updated[herbert.id]![1] as Author).name).toBe("F.H.")

    store.applyDiff(reverseRecordsDiff(diff))
    expect(store.get(dune.id)).toBeUndefined()
    expect(store.get(herbert.id)!.name).toBe("Frank Herbert")
    expect(entries).toHaveLength(2)

    store.applyDiff(diff)
    expect(store.get(dune.id)).toEqual(dune)
    expect(store.get(herbert.id)!.name).toBe("F.H.")
  })

  it("nested extractingChanges each see their own scope", () => {
    const store = makeStore()
    let inner: RecordsDiff<R> = createEmptyRecordsDiff()
    const outer = store.extractingChanges(() => {
      store.put([herbert])
      inner = store.extractingChanges(() => store.put([dune]))
    })
    expect(Object.keys(inner.added)).toEqual([dune.id])
    expect(Object.keys(outer.added).sort()).toEqual([herbert.id, dune.id].sort())
  })

  it("applyDiff can skip side effects", () => {
    const store = makeStore()
    const after = vi.fn()
    store.sideEffects.registerAfterCreateHandler("book", after)
    const diff = createEmptyRecordsDiff<R>()
    diff.added[dune.id] = dune
    store.applyDiff(diff, { runCallbacks: false })
    expect(after).not.toHaveBeenCalled()
    store.remove([dune.id])
    store.applyDiff(diff)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it("applyDiff with ignoreEphemeralKeys keeps current ephemeral values", () => {
    const store = makeStore()
    const c0 = Cursor.create({ id: Cursor.createId("c"), x: 0, hovered: false })
    const c1 = { ...c0, x: 1, hovered: true }
    store.put([c0])
    const diff = store.extractingChanges(() => store.put([c1]))
    // user hovers away in the meantime
    store.put([{ ...c1, hovered: false }])
    store.applyDiff(reverseRecordsDiff(diff), { ignoreEphemeralKeys: true })
    expect(store.get(c0.id)).toEqual({ ...c0, hovered: false })
    store.applyDiff(diff, { ignoreEphemeralKeys: false })
    expect(store.get(c0.id)!.hovered).toBe(true)
  })
})

describe("serialization", () => {
  it("serialize defaults to document scope and supports others", () => {
    const store = makeStore()
    const cursor = Cursor.create({ id: Cursor.createId("c"), x: 1, hovered: false })
    store.put([dune, herbert, cursor])
    expect(Object.keys(store.serialize()).sort()).toEqual([dune.id, herbert.id].sort())
    expect(Object.keys(store.serialize("session"))).toEqual([cursor.id])
    expect(Object.keys(store.serialize("presence"))).toEqual([])
    expect(Object.keys(store.serialize("all"))).toHaveLength(3)
  })

  it("round-trips through a snapshot", () => {
    const store = makeStore()
    store.put([dune, herbert])
    const snapshot = store.getStoreSnapshot()
    expect(snapshot.schema).toEqual(store.schema.serialize())

    const store2 = makeStore()
    store2.put([Book.create({ id: Book.createId("old"), title: "Old", authorId: herbert.id })])
    const { entries } = collect(store2)
    store2.loadStoreSnapshot(snapshot)
    expect(store2.serialize()).toEqual(snapshot.store)
    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]!.changes.removed)).toEqual(["book:old"])

    const store3 = new Store<R>({ schema: store.schema, props: undefined, initialData: snapshot.store })
    expect(store3.serialize()).toEqual(snapshot.store)
  })

  it("loadStoreSnapshot leaves other scopes alone when the snapshot has none", () => {
    const store = makeStore()
    const cursor = Cursor.create({ id: Cursor.createId("c"), x: 1, hovered: false })
    store.put([dune, cursor])
    store.loadStoreSnapshot({ store: { [herbert.id]: herbert } as never, schema: store.schema.serialize() })
    expect(store.get(dune.id)).toBeUndefined()
    expect(store.get(herbert.id)).toEqual(herbert)
    expect(store.get(cursor.id)).toEqual(cursor)
  })

  it("loadStoreSnapshot throws on unmigratable data", () => {
    const store = makeStore()
    expect(() =>
      store.loadStoreSnapshot({ store: {} as never, schema: { schemaVersion: 2, sequences: { nope: 5 } } }),
    ).not.toThrow() // unknown sequence: ignored with a warning
    expect(() => store.loadStoreSnapshot({ store: {} as never, schema: { schemaVersion: 1 } as never })).toThrow()
  })

  it("preserves records of unknown types", () => {
    const store = makeStore()
    const gizmo = { id: "gizmo:1", typeName: "gizmo", n: 1 } as unknown as R
    store.put([gizmo])
    expect(store.get(gizmo.id)).toEqual(gizmo)
    expect(store.serialize()[gizmo.id]).toEqual(gizmo) // unknown types count as document scope
  })
})

describe("queries and reactivity", () => {
  it("query.ids is maintained incrementally and is reactive", () => {
    const store = makeStore()
    const ids = store.query.ids("book")
    expect(ids.get().size).toBe(0)
    const first = ids.get()
    store.put([herbert]) // other type: no change
    expect(ids.get()).toBe(first)
    store.put([dune])
    expect([...ids.get()]).toEqual([dune.id])
    store.put([{ ...dune, pages: 3 }]) // update: membership unchanged
    const afterUpdate = ids.get()
    store.put([{ ...dune, pages: 4 }])
    expect(ids.get()).toBe(afterUpdate)
    store.remove([dune.id])
    expect(ids.get().size).toBe(0)
    expect(store.query.ids("book")).toBe(ids) // cached
  })

  it("query.records and query.record", () => {
    const store = makeStore()
    const books = store.query.records("book")
    expect(books.get()).toEqual([])
    const other = Book.create({ id: Book.createId("other"), title: "Other", authorId: herbert.id })
    store.put([dune, other, herbert])
    expect(books.get().map((b) => b.id)).toEqual([dune.id, other.id])
    const dune2 = { ...dune, pages: 1 }
    store.put([dune2])
    expect(books.get()[0]).toEqual(dune2)

    const byTitle = store.query.record("book", (b) => b.title === "Other")
    expect(byTitle.get()).toEqual(other)
    store.remove([other.id])
    expect(byTitle.get()).toBeUndefined()
    expect(store.query.record("book").get()).toEqual(dune2)
    expect(store.query.exec("book", (b) => b.pages === 1)).toEqual([dune2])
  })

  it("computeds observe creation of a record that did not exist yet, and its removal", () => {
    const store = makeStore()
    let runs = 0
    const title = computed("title", () => {
      runs++
      return store.get(dune.id)?.title
    })
    expect(title.get()).toBeUndefined()
    store.put([dune])
    expect(title.get()).toBe("Dune")
    store.put([{ ...dune, title: "Dune!" }])
    expect(title.get()).toBe("Dune!")
    store.remove([dune.id])
    expect(title.get()).toBeUndefined()
    expect(runs).toBe(4)
  })

  it("react runs once per completed transaction", () => {
    const store = makeStore()
    store.put([dune])
    const seen: number[] = []
    const dispose = react("pages", () => {
      seen.push(store.get(dune.id)?.pages ?? -1)
    })
    transact(() => {
      store.put([{ ...dune, pages: 1 }])
      store.put([{ ...dune, pages: 2 }])
    })
    store.put([herbert]) // unrelated
    expect(seen).toEqual([100, 2])
    dispose()
    store.put([{ ...dune, pages: 3 }])
    expect(seen).toEqual([100, 2])
  })

  it("createComputedCache derives per record", () => {
    const store = makeStore()
    const derive = vi.fn((b: Book) => b.title.toUpperCase())
    const cache = store.createComputedCache<string, RecordId<Book>>("upper", derive)
    expect(cache.get(dune.id)).toBeUndefined()
    store.put([dune])
    expect(cache.get(dune.id)).toBe("DUNE")
    expect(cache.get(dune.id)).toBe("DUNE")
    expect(derive).toHaveBeenCalledTimes(1)
    store.put([{ ...dune, pages: 1 }])
    expect(cache.get(dune.id)).toBe("DUNE")
    expect(derive).toHaveBeenCalledTimes(2)
    store.remove([dune.id])
    expect(cache.get(dune.id)).toBeUndefined()
  })
})

describe("side effects", () => {
  it("runs handlers in order and lets before* handlers transform records", () => {
    const store = makeStore()
    const log: string[] = []
    store.sideEffects.registerBeforeCreateHandler("book", (b, source) => {
      log.push(`beforeCreate:${source}`)
      return { ...b, title: b.title.trim() }
    })
    store.sideEffects.registerAfterCreateHandler("book", (b) => log.push(`afterCreate:${b.title}`))
    store.sideEffects.registerBeforeChangeHandler("book", (_prev, next) => {
      log.push("beforeChange")
      return { ...next, pages: Math.max(1, next.pages) }
    })
    store.sideEffects.registerAfterChangeHandler("book", (prev, next) => log.push(`afterChange:${prev.pages}->${next.pages}`))
    store.sideEffects.registerBeforeDeleteHandler("book", () => {
      log.push("beforeDelete")
    })
    store.sideEffects.registerAfterDeleteHandler("book", () => log.push("afterDelete"))
    store.sideEffects.registerOperationCompleteHandler((source) => log.push(`complete:${source}`))
    store.listen(() => log.push("listener"))

    store.put([{ ...dune, title: "  Dune  " }])
    expect(store.get(dune.id)!.title).toBe("Dune")
    store.put([{ ...store.get(dune.id)!, pages: 0 }])
    expect(store.get(dune.id)!.pages).toBe(1)
    store.remove([dune.id])

    expect(log).toEqual([
      "beforeCreate:user",
      "afterCreate:Dune",
      "complete:user",
      "listener",
      "beforeChange",
      "afterChange:100->1",
      "complete:user",
      "listener",
      "beforeDelete",
      "afterDelete",
      "complete:user",
      "listener",
    ])
  })

  it("after handlers run once all records in a put are written", () => {
    const store = makeStore()
    store.sideEffects.registerAfterCreateHandler("book", (b) => {
      expect(store.get(b.authorId)).toBeDefined()
    })
    store.put([dune, herbert]) // book before author in the array
  })

  it("beforeDelete can veto", () => {
    const store = makeStore()
    store.put([dune])
    store.sideEffects.registerBeforeDeleteHandler("book", () => false)
    store.remove([dune.id])
    expect(store.has(dune.id)).toBe(true)
  })

  it("handler-made changes are squashed into the same history entry", () => {
    const store = makeStore()
    // Deleting an author deletes their books.
    store.sideEffects.registerAfterDeleteHandler("author", (author) => {
      store.remove(store.query.exec("book", (b) => b.authorId === author.id).map((b) => b.id))
    })
    store.put([dune, herbert])
    const { entries } = collect(store)
    store.remove([herbert.id])
    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]!.changes.removed).sort()).toEqual([dune.id, herbert.id].sort())
  })

  it("operationComplete runs once per outermost operation and may write", () => {
    const store = makeStore()
    const complete = vi.fn(() => {
      if (!store.has(herbert.id)) store.put([herbert])
    })
    store.sideEffects.registerOperationCompleteHandler(complete)
    const { entries } = collect(store)
    store.atomic(() => {
      store.put([dune])
      store.atomic(() => store.put([{ ...dune, pages: 2 }]))
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]!.changes.added).sort()).toEqual([dune.id, herbert.id].sort())
  })

  it("remote merges run handlers with source remote", () => {
    const store = makeStore()
    const sources: string[] = []
    store.sideEffects.registerAfterCreateHandler("book", (_b, source) => sources.push(source))
    store.sideEffects.registerOperationCompleteHandler((source) => sources.push(`complete:${source}`))
    store.mergeRemoteChanges(() => store.put([dune]))
    expect(sources).toEqual(["remote", "complete:remote"])
  })

  it("register() batches handlers and returns one disposer; setIsEnabled toggles all", () => {
    const store = makeStore()
    const created = vi.fn()
    const dispose = store.sideEffects.register({ book: { afterCreate: created } })
    store.put([dune])
    expect(created).toHaveBeenCalledTimes(1)
    store.sideEffects.setIsEnabled(false)
    store.remove([dune.id])
    store.put([dune])
    expect(created).toHaveBeenCalledTimes(1)
    store.sideEffects.setIsEnabled(true)
    dispose()
    store.remove([dune.id])
    store.put([dune])
    expect(created).toHaveBeenCalledTimes(1)
  })
})

describe("validation", () => {
  it("throws on invalid records by default", () => {
    const store = makeStore({ strict: true })
    expect(() => store.put([{ ...herbert, name: 42 as never }])).toThrow(/name/)
    expect(store.has(herbert.id)).toBe(false)
  })

  it("uses onValidationFailure to repair", () => {
    const store = makeStore({ strict: true, onValidationFailure: (r) => ({ ...r, name: "repaired" }) as R })
    store.put([{ ...herbert, name: 42 as never }])
    expect((store.get(herbert.id) as Author).name).toBe("repaired")
  })

  it("rejects id changes from handlers", () => {
    const store = makeStore()
    store.sideEffects.registerBeforeCreateHandler("book", (b) => ({ ...b, id: Book.createId("x") }))
    expect(() => store.put([dune])).toThrow(/id/)
  })
})

describe("scale", () => {
  it("handles 100k records with incremental id sets", () => {
    const store = makeStore()
    const author = herbert
    const books: Book[] = []
    for (let i = 0; i < 100_000; i++) {
      books.push(Book.create({ id: Book.createId(String(i)), title: `Book ${i}`, authorId: author.id }))
    }
    const ids = store.query.ids("book")
    const t0 = performance.now()
    store.put([author, ...books])
    const tPut = performance.now() - t0
    expect(ids.get().size).toBe(100_000)
    expect(store.allRecords()).toHaveLength(100_001)

    // Single updates do not touch membership; single inserts are cheap.
    const t1 = performance.now()
    for (let i = 0; i < 1000; i++) {
      const b = books[i]!
      store.put([{ ...b, pages: i }])
    }
    const tUpdates = performance.now() - t1
    expect(ids.get().size).toBe(100_000)

    const t2 = performance.now()
    store.put([Book.create({ id: Book.createId("extra"), title: "x", authorId: author.id })])
    expect(ids.get().size).toBe(100_001)
    const tInsert = performance.now() - t2

    expect(tPut).toBeLessThan(5000)
    expect(tUpdates).toBeLessThan(2000)
    expect(tInsert).toBeLessThan(200)
  })
})
