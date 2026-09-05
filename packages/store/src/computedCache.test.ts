import { describe, expect, it, vi } from "vitest"
import { computed, react } from "./_signals"
import { createComputedCache } from "./computedCache"
import { createRecordType, type BaseRecord, type RecordId } from "./ids"
import { Store } from "./Store"
import { StoreSchema } from "./StoreSchema"

interface Node extends BaseRecord<"node", RecordId<Node>> {
  label: string
}
type R = Node

const Node = createRecordType<Node>("node", { scope: "document" })

function makeStore() {
  return new Store<R>({ schema: StoreSchema.create<R>({ node: Node }), props: undefined })
}

/** The shape a shape util's context has: an object that owns a store. */
function makeEditor(store: Store<R>) {
  return { store, prefix: ">" }
}

const a = Node.create({ id: Node.createId("a"), label: "alpha" })
const b = Node.create({ id: Node.createId("b"), label: "beta" })

describe("createComputedCache", () => {
  it("derives from the record and the context", () => {
    const store = makeStore()
    store.put([a, b])
    const editor = makeEditor(store)
    const cache = createComputedCache("labels", (ctx: typeof editor, node: Node) => ctx.prefix + node.label)
    expect(cache.get(editor, a.id)).toBe(">alpha")
    expect(cache.get(editor, b.id)).toBe(">beta")
  })

  it("accepts a bare store as the context", () => {
    const store = makeStore()
    store.put([a])
    const cache = createComputedCache("upper", (_ctx: Store<R>, node: Node) => node.label.toUpperCase())
    expect(cache.get(store, a.id)).toBe("ALPHA")
  })

  it("recomputes only when the record it reads changes", () => {
    const store = makeStore()
    store.put([a, b])
    const editor = makeEditor(store)
    const derive = vi.fn((ctx: typeof editor, node: Node) => ctx.prefix + node.label)
    const cache = createComputedCache("labels", derive)

    // A live subscriber, so the cached computed stays attached between reads.
    const seen: (string | undefined)[] = []
    const stop = react("watch a", () => seen.push(cache.get(editor, a.id)))
    expect(derive).toHaveBeenCalledTimes(1)

    store.update(b.id, (r) => ({ ...r, label: "beta!" }))
    expect(seen).toEqual([">alpha"])
    expect(derive).toHaveBeenCalledTimes(1)

    store.update(a.id, (r) => ({ ...r, label: "alpha!" }))
    expect(seen).toEqual([">alpha", ">alpha!"])
    expect(derive).toHaveBeenCalledTimes(2)
    stop()
  })

  it("is undefined for a missing record, and reactive when it appears", () => {
    const store = makeStore()
    const editor = makeEditor(store)
    const cache = createComputedCache("labels", (ctx: typeof editor, node: Node) => ctx.prefix + node.label)
    const seen: (string | undefined)[] = []
    const stop = react("watch a", () => seen.push(cache.get(editor, a.id)))
    expect(seen).toEqual([undefined])
    store.put([a])
    expect(seen).toEqual([undefined, ">alpha"])
    store.remove([a.id])
    expect(seen).toEqual([undefined, ">alpha", undefined])
    stop()
  })

  it("keeps one cache per context", () => {
    const store = makeStore()
    store.put([a])
    const one = makeEditor(store)
    const two = { store, prefix: "#" }
    const cache = createComputedCache("labels", (ctx: { store: Store<R>; prefix: string }, node: Node) => ctx.prefix + node.label)
    expect(cache.get(one, a.id)).toBe(">alpha")
    expect(cache.get(two, a.id)).toBe("#alpha")
  })

  it("honours isEqual so an equivalent result does not wake dependents", () => {
    const store = makeStore()
    store.put([a])
    const editor = makeEditor(store)
    const cache = createComputedCache(
      "lengths",
      (_ctx: typeof editor, node: Node) => ({ length: node.label.length }),
      { isEqual: (x, y) => x.length === y.length },
    )
    let runs = 0
    const derived = computed("watched", () => {
      runs++
      return cache.get(editor, a.id)
    })
    const stop = react("hold", () => derived.get())
    expect(runs).toBe(1)
    // Same length, so the cached value is equal and nothing downstream reruns.
    store.update(a.id, (r) => ({ ...r, label: "aleph" }))
    expect(runs).toBe(1)
    store.update(a.id, (r) => ({ ...r, label: "a" }))
    expect(runs).toBe(2)
    stop()
  })

  it("rejects a context that owns no store", () => {
    const cache = createComputedCache("labels", (_ctx: { nope: true }, node: Node) => node.label)
    expect(() => cache.get({ nope: true }, a.id)).toThrow(/neither a Store nor/)
  })

  it("rejects a primitive context", () => {
    const cache = createComputedCache("labels", (_ctx: string, node: Node) => node.label)
    expect(() => cache.get("editor", a.id)).toThrow(/must be an object/)
  })
})
