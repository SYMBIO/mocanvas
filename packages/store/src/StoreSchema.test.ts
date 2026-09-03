import { afterEach, describe, expect, it, vi } from "vitest"
import { createRecordType, type BaseRecord, type RecordId } from "./ids"
import {
  createMigrationIds,
  createMigrationSequence,
  createRecordMigrationSequence,
  parseMigrationId,
  type SerializedStore,
} from "./migrate"
import { StoreSchema, type StoreSnapshot } from "./StoreSchema"

interface Book extends BaseRecord<"book", RecordId<Book>> {
  title: string
  /** added in v1 */
  pages?: number
  /** renamed from `author` in v2 */
  authorName?: string
  author?: string
}
interface Note extends BaseRecord<"note", RecordId<Note>> {
  text: string
}
type R = Book | Note

const Book = createRecordType<Book>("book", { scope: "document" })
const Note = createRecordType<Note>("note", { scope: "session" })

const bookVersions = createMigrationIds("com.test.book", { AddPages: 1, RenameAuthor: 2 })
const bookMigrations = createRecordMigrationSequence({
  sequenceId: "com.test.book",
  recordType: "book",
  sequence: [
    {
      id: bookVersions.AddPages,
      up(record) {
        ;(record as Book).pages = 0
      },
      down(record) {
        delete (record as Book).pages
      },
    },
    {
      id: bookVersions.RenameAuthor,
      up(record) {
        const r = record as Book
        r.authorName = r.author ?? ""
        delete r.author
      },
      down(record) {
        const r = record as Book
        r.author = r.authorName ?? ""
        delete r.authorName
      },
    },
  ],
})

const storeVersions = createMigrationIds("com.test.store", { DropOrphanNotes: 1 })
const storeMigrations = createMigrationSequence({
  sequenceId: "com.test.store",
  sequence: [
    {
      id: storeVersions.DropOrphanNotes,
      scope: "store",
      up(store) {
        for (const id in store) {
          const r = store[id as keyof typeof store]!
          if (r.typeName === "note" && (r as Note).text === "") delete store[id as keyof typeof store]
        }
      },
    },
  ],
})

function makeSchema(extra?: { retroactiveNoteSeq?: boolean }) {
  const noteMigrations = createRecordMigrationSequence({
    sequenceId: "com.test.note",
    recordType: "note",
    retroactive: extra?.retroactiveNoteSeq ?? true,
    sequence: [
      {
        id: "com.test.note/1",
        up(record) {
          ;(record as Note).text = (record as Note).text.toUpperCase()
        },
      },
    ],
  })
  return StoreSchema.create<R>({ book: Book, note: Note }, { migrations: [bookMigrations, storeMigrations, noteMigrations] })
}

const oldStore = (): SerializedStore<R> =>
  ({
    "book:1": { id: "book:1", typeName: "book", title: "Dune", author: "Herbert" },
    "note:1": { id: "note:1", typeName: "note", text: "hi" },
    "note:2": { id: "note:2", typeName: "note", text: "" },
    "gizmo:1": { id: "gizmo:1", typeName: "gizmo", whatever: 1 },
  }) as unknown as SerializedStore<R>

afterEach(() => {
  vi.restoreAllMocks()
})

describe("migration helpers", () => {
  it("createMigrationIds builds ids", () => {
    expect(bookVersions.AddPages).toBe("com.test.book/1")
    expect(bookVersions.RenameAuthor).toBe("com.test.book/2")
  })

  it("parseMigrationId", () => {
    expect(parseMigrationId("a.b/3")).toEqual({ sequenceId: "a.b", version: 3 })
    expect(() => parseMigrationId("nope")).toThrow()
    expect(() => parseMigrationId("a/0")).toThrow()
    expect(() => parseMigrationId("a/x")).toThrow()
  })

  it("createMigrationSequence validates ordering and ownership", () => {
    expect(() =>
      createMigrationSequence({
        sequenceId: "s",
        sequence: [{ id: "s/2", scope: "record", up() {} }],
      }),
    ).toThrow(/out of order/)
    expect(() =>
      createMigrationSequence({
        sequenceId: "s",
        sequence: [{ id: "other/1", scope: "record", up() {} }],
      }),
    ).toThrow(/does not belong/)
    expect(() => createMigrationSequence({ sequenceId: "a/b", sequence: [] })).toThrow()
    const seq = createMigrationSequence({ sequenceId: "s", sequence: [] })
    expect(seq.retroactive).toBe(true)
  })
})

describe("StoreSchema", () => {
  it("serializes as v2 with the length of each sequence", () => {
    const schema = makeSchema()
    expect(schema.serialize()).toEqual({
      schemaVersion: 2,
      sequences: { "com.test.book": 2, "com.test.store": 1, "com.test.note": 1 },
    })
    expect(schema.serializeEarliestVersion().sequences).toEqual({
      "com.test.book": 0,
      "com.test.store": 0,
      "com.test.note": 0,
    })
  })

  it("rejects duplicate sequences and mismatched type names", () => {
    expect(() =>
      StoreSchema.create<R>({ book: Book, note: Note }, { migrations: [bookMigrations, bookMigrations] }),
    ).toThrow(/Duplicate/)
    expect(() => StoreSchema.create<R>({ book: Note as never, note: Note })).toThrow(/typeName/)
  })

  it("migrates a snapshot up from the earliest version", () => {
    const schema = makeSchema()
    const input: StoreSnapshot<R> = { store: oldStore(), schema: schema.serializeEarliestVersion() }
    const inputCopy = structuredClone(input)
    const result = schema.migrateStoreSnapshot(input)
    expect(result.type).toBe("success")
    if (result.type !== "success") return
    const store = result.value as unknown as Record<string, any>
    expect(store["book:1"]).toEqual({ id: "book:1", typeName: "book", title: "Dune", pages: 0, authorName: "Herbert" })
    expect(store["note:1"]).toEqual({ id: "note:1", typeName: "note", text: "HI" })
    expect(store["note:2"]).toBeUndefined() // dropped by the store migration
    // unknown record types are preserved untouched
    expect(store["gizmo:1"]).toEqual({ id: "gizmo:1", typeName: "gizmo", whatever: 1 })
    // input not mutated
    expect(input).toEqual(inputCopy)
  })

  it("applies only the migrations after the persisted version", () => {
    const schema = makeSchema()
    const result = schema.migrateStoreSnapshot({
      store: {
        "book:1": { id: "book:1", typeName: "book", title: "Dune", pages: 7, author: "H" },
      } as unknown as SerializedStore<R>,
      schema: { schemaVersion: 2, sequences: { "com.test.book": 1, "com.test.store": 1, "com.test.note": 1 } },
    })
    expect(result).toEqual({
      type: "success",
      value: { "book:1": { id: "book:1", typeName: "book", title: "Dune", pages: 7, authorName: "H" } },
    })
  })

  it("is a no-op when the snapshot is current", () => {
    const schema = makeSchema()
    const store = oldStore()
    const result = schema.migrateStoreSnapshot({ store, schema: schema.serialize() })
    expect(result).toEqual({ type: "success", value: store })
  })

  it("treats sequences missing from the persisted schema according to `retroactive`", () => {
    const persisted = { schemaVersion: 2 as const, sequences: { "com.test.book": 2, "com.test.store": 1 } }
    const retro = makeSchema({ retroactiveNoteSeq: true }).migrateStoreSnapshot({ store: oldStore(), schema: persisted })
    expect(retro.type).toBe("success")
    if (retro.type === "success") expect((retro.value as any)["note:1"].text).toBe("HI")

    const notRetro = makeSchema({ retroactiveNoteSeq: false }).migrateStoreSnapshot({
      store: oldStore(),
      schema: persisted,
    })
    expect(notRetro.type).toBe("success")
    if (notRetro.type === "success") expect((notRetro.value as any)["note:1"].text).toBe("hi")
  })

  it("ignores unknown sequences with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const schema = makeSchema()
    const result = schema.migrateStoreSnapshot({
      store: {} as SerializedStore<R>,
      schema: { schemaVersion: 2, sequences: { ...schema.serialize().sequences, "com.other.thing": 3 } },
    })
    expect(result.type).toBe("success")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("com.other.thing"))
  })

  it("errors on data from a newer version or an unknown schema version", () => {
    const schema = makeSchema()
    const future = schema.migrateStoreSnapshot({
      store: {} as SerializedStore<R>,
      schema: { schemaVersion: 2, sequences: { "com.test.book": 3 } },
    })
    expect(future.type).toBe("error")
    if (future.type === "error") expect(future.reason).toMatch(/newer/)

    const v1 = schema.migrateStoreSnapshot({
      store: {} as SerializedStore<R>,
      schema: { schemaVersion: 1 } as never,
    })
    expect(v1.type).toBe("error")
  })

  it("reports migration exceptions as errors", () => {
    const schema = StoreSchema.create<R>(
      { book: Book, note: Note },
      {
        migrations: [
          createMigrationSequence({
            sequenceId: "boom",
            sequence: [
              {
                id: "boom/1",
                scope: "record",
                up() {
                  throw new Error("kaboom")
                },
              },
            ],
          }),
        ],
      },
    )
    const result = schema.migrateStoreSnapshot({ store: oldStore(), schema: schema.serializeEarliestVersion() })
    expect(result).toEqual({ type: "error", reason: expect.stringContaining("kaboom") })
  })

  it("migrates single records up and down", () => {
    const schema = StoreSchema.create<R>({ book: Book, note: Note }, { migrations: [bookMigrations] })
    const old = { id: "book:1", typeName: "book", title: "Dune", author: "Herbert" } as unknown as Book
    const up = schema.migratePersistedRecord(old, schema.serializeEarliestVersion(), "up")
    expect(up).toEqual({
      type: "success",
      value: { id: "book:1", typeName: "book", title: "Dune", pages: 0, authorName: "Herbert" },
    })
    if (up.type !== "success") return
    const down = schema.migratePersistedRecord(up.value, schema.serializeEarliestVersion(), "down")
    expect(down).toEqual({ type: "success", value: old })

    // records of other types pass through the filtered migrations untouched
    const note = { id: "note:1", typeName: "note", text: "x" } as Note
    expect(schema.migratePersistedRecord(note, schema.serializeEarliestVersion())).toEqual({
      type: "success",
      value: note,
    })
  })

  it("refuses to apply store-scoped migrations to a single record and reports missing down", () => {
    const schema = makeSchema()
    const rec = { id: "book:1", typeName: "book", title: "x" } as Book
    const result = schema.migratePersistedRecord(rec, schema.serializeEarliestVersion())
    expect(result.type).toBe("error")

    const noDown = StoreSchema.create<R>(
      { book: Book, note: Note },
      {
        migrations: [
          createRecordMigrationSequence({
            sequenceId: "nd",
            recordType: "book",
            sequence: [{ id: "nd/1", up() {} }],
          }),
        ],
      },
    )
    const down = noDown.migratePersistedRecord(rec, noDown.serializeEarliestVersion(), "down")
    expect(down).toEqual({ type: "error", reason: expect.stringContaining("no down") })
  })

  it("exposes types and scopes", () => {
    const schema = makeSchema()
    expect(schema.getType("book")).toBe(Book)
    expect(schema.getScope("note")).toBe("session")
    expect(schema.getScope("unknown")).toBe("document")
  })
})
