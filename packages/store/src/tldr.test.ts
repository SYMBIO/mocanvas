import { describe, expect, it } from "vitest"
import { createRecordType, type BaseRecord, type RecordId, type UnknownRecord } from "./ids"
import { Store } from "./Store"
import { StoreSchema } from "./StoreSchema"
import {
  parseTldrFile,
  serializeTldrFile,
  storeSnapshotToTldrFile,
  TLDR_FILE_FORMAT_VERSION,
  tldrFileToStoreSnapshot,
} from "./tldr"

const schema = { schemaVersion: 2 as const, sequences: { "com.test.shape": 3, "com.test.page": 1 } }
const records: UnknownRecord[] = [
  { id: "page:1", typeName: "page", name: "Page 1", index: "a1" } as unknown as UnknownRecord,
  { id: "shape:1", typeName: "shape", x: 1, y: 2, props: { w: 10, h: 20 } } as unknown as UnknownRecord,
]

describe("parseTldrFile", () => {
  it("parses a valid envelope (object or string)", () => {
    const file = { tldrawFileFormatVersion: 1, schema, records }
    const a = parseTldrFile(file)
    expect(a).toEqual({ ok: true, schema, records })
    const b = parseTldrFile(JSON.stringify(file))
    expect(b).toEqual({ ok: true, schema, records })
  })

  it("reports notATldrFile for garbage", () => {
    expect(parseTldrFile("not json")).toMatchObject({ ok: false, error: "notATldrFile" })
    expect(parseTldrFile(null)).toEqual({ ok: false, error: "notATldrFile" })
    expect(parseTldrFile([])).toEqual({ ok: false, error: "notATldrFile" })
    expect(parseTldrFile({ hello: "world" })).toEqual({ ok: false, error: "notATldrFile" })
    expect(parseTldrFile({ tldrawFileFormatVersion: "1", schema, records })).toEqual({ ok: false, error: "notATldrFile" })
    expect(parseTldrFile({ tldrawFileFormatVersion: 1, records })).toEqual({ ok: false, error: "notATldrFile" })
  })

  it("detects legacy v1 documents", () => {
    expect(parseTldrFile({ name: "x", document: { id: "doc", pages: {}, version: 15 } })).toEqual({
      ok: false,
      error: "v1File",
    })
  })

  it("detects future format versions", () => {
    expect(parseTldrFile({ tldrawFileFormatVersion: TLDR_FILE_FORMAT_VERSION + 1, schema, records })).toEqual({
      ok: false,
      error: "futureVersion",
    })
  })

  it("validates the records array", () => {
    expect(parseTldrFile({ tldrawFileFormatVersion: 1, schema, records: {} })).toEqual({
      ok: false,
      error: "invalidRecords",
    })
    expect(parseTldrFile({ tldrawFileFormatVersion: 1, schema, records: [{ id: "a:b" }] })).toEqual({
      ok: false,
      error: "invalidRecords",
    })
    expect(
      parseTldrFile({ tldrawFileFormatVersion: 1, schema, records: [records[0], { ...records[0] }] }),
    ).toEqual({ ok: false, error: "invalidRecords" })
    expect(parseTldrFile({ tldrawFileFormatVersion: 1, schema, records: [] })).toEqual({ ok: true, schema, records: [] })
  })
})

describe("serializeTldrFile", () => {
  it("round-trips through parse", () => {
    const text = serializeTldrFile(schema, records)
    const parsed = parseTldrFile(text)
    expect(parsed).toEqual({ ok: true, schema, records })
    expect(text.startsWith("{\n")).toBe(true) // pretty printed
    const json = JSON.parse(text)
    expect(Object.keys(json)).toEqual(["tldrawFileFormatVersion", "schema", "records"])
    expect(json.tldrawFileFormatVersion).toBe(1)
  })

  it("produces identical text regardless of key insertion order", () => {
    const a = serializeTldrFile(
      { schemaVersion: 2, sequences: { b: 1, a: 2 } },
      [{ typeName: "shape", id: "shape:1", props: { z: 1, a: 2 } } as unknown as UnknownRecord],
    )
    const b = serializeTldrFile(
      { sequences: { a: 2, b: 1 }, schemaVersion: 2 },
      [{ props: { a: 2, z: 1 }, id: "shape:1", typeName: "shape" } as unknown as UnknownRecord],
    )
    expect(a).toBe(b)
  })

  it("keeps array order and drops undefined values", () => {
    const text = serializeTldrFile(schema, [
      { id: "shape:1", typeName: "shape", points: [3, 1, 2], gone: undefined } as unknown as UnknownRecord,
    ])
    const parsed = parseTldrFile(text)
    expect(parsed.ok && (parsed.records[0] as any).points).toEqual([3, 1, 2])
    expect(parsed.ok && "gone" in parsed.records[0]!).toBe(false)
  })
})

describe("snapshot <-> file conversion", () => {
  interface Shape extends BaseRecord<"shape", RecordId<Shape>> {
    x: number
  }
  const Shape = createRecordType<Shape>("shape", { scope: "document" })
  const storeSchema = StoreSchema.create<Shape>({ shape: Shape })

  it("round-trips a store through a .tldr string", () => {
    const store = new Store<Shape>({ schema: storeSchema, props: undefined })
    store.put([Shape.create({ id: Shape.createId("b"), x: 2 }), Shape.create({ id: Shape.createId("a"), x: 1 })])
    const text = storeSnapshotToTldrFile(store.getStoreSnapshot())
    const parsed = parseTldrFile(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records.map((r) => r.id)).toEqual(["shape:a", "shape:b"]) // sorted by id
    const store2 = new Store<Shape>({ schema: storeSchema, props: undefined })
    store2.loadStoreSnapshot(tldrFileToStoreSnapshot(parsed) as never)
    expect(store2.serialize()).toEqual(store.serialize())
  })
})
