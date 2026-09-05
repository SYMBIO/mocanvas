import { describe, expect, it } from "vitest"
import { assertIdType, devFreeze } from "./devFreeze"
import { createRecordType, type BaseRecord, type RecordId } from "./ids"
import { RESET_VALUE } from "./_signals"
import { getIndexablePropertyOf, matchesQuery, applyCollectionDiff } from "./query"
import { Store } from "./Store"
import { StoreSchema } from "./StoreSchema"
import { createInMemoryStorage } from "./storage"

interface Widget extends BaseRecord<"widget", RecordId<Widget>> {
  kind: string
  size: number
}
interface Gadget extends BaseRecord<"gadget", RecordId<Gadget>> {
  label: string
}
type R = Widget | Gadget

const WidgetRecord = createRecordType<Widget>("widget", { scope: "document" })
const GadgetRecord = createRecordType<Gadget>("gadget", { scope: "document" })

function makeStore() {
  return new Store<R, undefined>({
    schema: StoreSchema.create<R, undefined>({ widget: WidgetRecord, gadget: GadgetRecord }),
    props: undefined,
  })
}

describe("matchesQuery", () => {
  const record: Widget = { id: "widget:a" as RecordId<Widget>, typeName: "widget", kind: "box", size: 3 }

  it("ANDs every clause", () => {
    expect(matchesQuery<Widget>({ kind: { eq: "box" }, size: { gt: 2 } }, record)).toBe(true)
    expect(matchesQuery<Widget>({ kind: { eq: "box" }, size: { gt: 3 } }, record)).toBe(false)
  })

  it("matches everything when empty", () => {
    expect(matchesQuery<Widget>({}, record)).toBe(true)
  })

  it("supports neq", () => {
    expect(matchesQuery<Widget>({ kind: { neq: "circle" } }, record)).toBe(true)
    expect(matchesQuery<Widget>({ kind: { neq: "box" } }, record)).toBe(false)
  })

  it("picks the first eq clause as the indexable property", () => {
    expect(getIndexablePropertyOf<Widget>({ size: { gt: 1 }, kind: { eq: "box" } })).toBe("kind")
    expect(getIndexablePropertyOf<Widget>({ size: { gt: 1 } })).toBeUndefined()
  })
})

describe("StoreQueries.index", () => {
  it("groups ids by the value of a property", () => {
    const store = makeStore()
    store.put([
      WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 }),
      WidgetRecord.create({ id: WidgetRecord.createId("b"), kind: "box", size: 2 }),
      WidgetRecord.create({ id: WidgetRecord.createId("c"), kind: "circle", size: 3 }),
    ])
    const index = store.query.index("widget", "kind")
    expect([...index.get().get("box")!]).toEqual(["widget:a", "widget:b"])
    expect([...index.get().get("circle")!]).toEqual(["widget:c"])
  })

  it("returns the same index object for the same type and property", () => {
    const store = makeStore()
    expect(store.query.index("widget", "kind")).toBe(store.query.index("widget", "kind"))
  })

  it("patches incrementally and reports the diff", () => {
    const store = makeStore()
    const a = WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 })
    store.put([a])
    const index = store.query.index("widget", "kind")
    index.get()
    const epoch = index.lastChangedEpoch

    store.update(a.id, (w) => ({ ...w, kind: "circle" }))

    expect(index.get().has("box")).toBe(false)
    expect([...index.get().get("circle")!]).toEqual(["widget:a"])

    const diffs = index.getDiffSince(epoch)
    if (diffs === RESET_VALUE) throw new Error("expected the index to describe the change as a diff")
    const diff = diffs[0]!
    expect([...diff.get("box")!.removed!]).toEqual(["widget:a"])
    expect([...diff.get("circle")!.added!]).toEqual(["widget:a"])
  })

  it("removes a record from its bucket when it is deleted", () => {
    const store = makeStore()
    const a = WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 })
    store.put([a])
    const index = store.query.index("widget", "kind")
    expect(index.get().get("box")!.size).toBe(1)
    store.remove([a.id])
    expect(index.get().get("box")).toBeUndefined()
  })

  it("ignores changes to other record types", () => {
    const store = makeStore()
    store.put([WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 })])
    const index = store.query.index("widget", "kind")
    const before = index.get()
    store.put([GadgetRecord.create({ id: GadgetRecord.createId("g"), label: "hi" })])
    expect(index.get()).toBe(before)
  })
})

describe("StoreQueries.filterHistory", () => {
  it("carries only the diffs of the requested type", () => {
    const store = makeStore()
    const history = store.query.filterHistory("widget")
    history.get()
    const epoch = history.lastChangedEpoch

    // A change to another record type must not move the widget history at all.
    const value = history.get()
    store.put([GadgetRecord.create({ id: GadgetRecord.createId("g"), label: "hi" })])
    expect(history.get()).toBe(value)
    expect(history.lastChangedEpoch).toBe(epoch)

    store.put([WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 })])
    history.get()
    expect(history.lastChangedEpoch).toBeGreaterThan(epoch)

    const diffs = history.getDiffSince(epoch)
    if (diffs === RESET_VALUE) throw new Error("expected the filtered history to carry a diff")
    expect(Object.keys(diffs[0]!.added)).toEqual(["widget:a"])
  })
})

describe("StoreQueries filters", () => {
  it("answers a records() query from the index", () => {
    const store = makeStore()
    store.put([
      WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 }),
      WidgetRecord.create({ id: WidgetRecord.createId("b"), kind: "circle", size: 2 }),
    ])
    const boxes = store.query.records("widget", { kind: { eq: "box" } })
    expect(boxes.get().map((w) => w.id)).toEqual(["widget:a"])
  })

  it("still accepts a predicate", () => {
    const store = makeStore()
    store.put([
      WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 }),
      WidgetRecord.create({ id: WidgetRecord.createId("b"), kind: "box", size: 9 }),
    ])
    expect(store.query.exec("widget", (w) => w.size > 5).map((w) => w.id)).toEqual(["widget:b"])
  })

  it("ids() narrows with the same filter", () => {
    const store = makeStore()
    store.put([
      WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 }),
      WidgetRecord.create({ id: WidgetRecord.createId("b"), kind: "circle", size: 2 }),
    ])
    expect([...store.query.ids("widget", { kind: { eq: "circle" } }).get()]).toEqual(["widget:b"])
  })
})

describe("applyCollectionDiff", () => {
  it("removes before it adds", () => {
    const set = new Set([1, 2])
    applyCollectionDiff(set, { removed: new Set([1]), added: new Set([3]) })
    expect([...set]).toEqual([2, 3])
  })
})

describe("assertIdType", () => {
  it("narrows a matching id and throws otherwise", () => {
    const id: string = "widget:a"
    assertIdType(id, WidgetRecord)
    expect(() => assertIdType("gadget:a", WidgetRecord)).toThrow(/Expected widget id/)
    expect(() => assertIdType(undefined, WidgetRecord)).toThrow(/Expected widget id/)
  })
})

describe("devFreeze", () => {
  it("freezes nested objects in development", () => {
    const frozen = devFreeze({ a: { b: 1 }, list: [{ c: 2 }] })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.a)).toBe(true)
    expect(Object.isFrozen(frozen.list[0])).toBe(true)
  })

  it("passes primitives and null through", () => {
    expect(devFreeze(null)).toBe(null)
    expect(devFreeze(5)).toBe(5)
  })
})

describe("createInMemoryStorage", () => {
  it("round-trips records and the schema they were written against", () => {
    const storage = createInMemoryStorage<Widget>()
    const a = WidgetRecord.create({ id: WidgetRecord.createId("a"), kind: "box", size: 1 })
    storage.set(a)
    expect(storage.get(a.id)).toBe(a)
    expect(storage.getAll()).toEqual([a])
    expect(storage.getSchema()).toBeUndefined()
    storage.setSchema({ schemaVersion: 2, sequences: {} })
    expect(storage.getSchema()).toEqual({ schemaVersion: 2, sequences: {} })
    storage.delete(a.id)
    expect(storage.getAll()).toEqual([])
  })
})
