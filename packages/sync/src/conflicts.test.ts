import { afterEach, describe, expect, it } from "vitest"
import {
  createShapeId,
  createStore,
  PageRecordType,
  ShapeRecordType,
  type EditorRecord,
  type EditorStore,
  type PageId,
  type ShapeId,
} from "@mocanvas/editor"
import { ZERO_INDEX_KEY } from "@mocanvas/store"
import { createSyncClient, type SyncClient } from "./SyncClient"
import { decodeMessage, encodeMessage, type SyncMessage } from "./protocol"
import { createMemoryHub, createMemoryTransportPair, type Transport } from "./transport"

/** Let every queued microtask (the in-memory transport's delivery) run. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

const PAGE_ID = PageRecordType.createId("test") as PageId

function makeStore(): EditorStore {
  const store = createStore()
  store.put([PageRecordType.create({ id: PAGE_ID, name: "Page 1", index: ZERO_INDEX_KEY })])
  return store
}

function makeShape(id: ShapeId, x = 0): EditorRecord {
  return ShapeRecordType.create({
    id,
    type: "geo",
    parentId: PAGE_ID,
    index: ZERO_INDEX_KEY,
    x,
    y: 0,
    props: { w: 10, h: 10 },
  }) as EditorRecord
}

const setProps = (store: EditorStore, id: ShapeId, props: Record<string, unknown>) => {
  store.update(id, (shape) => ({ ...shape, props: { ...shape.props, ...props } }))
}

/** A shape's props, which the record union types only as `object`. */
const propsOf = (store: EditorStore, id: ShapeId): { w?: number; h?: number } | undefined =>
  store.get(id)?.props as { w?: number; h?: number } | undefined

/**
 * The document as bytes, so "converged" means byte-for-byte the same.
 *
 * Keys are sorted before serializing. Two replicas that each add a different
 * key to one object end up with the same keys in a different insertion order,
 * and JSON object key order is not part of the value.
 */
function documentBytes(store: EditorStore): string {
  const records = store.serialize("document")
  const ids = Object.keys(records).sort()
  return canonical(ids.map((id) => records[id as keyof typeof records]))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>).sort()
    return `{${entries
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/* -------------------------------------------------------------------------- */
/* transports that let a test drive delivery by hand                          */
/* -------------------------------------------------------------------------- */

interface ManualTransport<R extends EditorRecord = EditorRecord> extends Transport<R> {
  /** Everything the client tried to send, in order. */
  readonly sent: SyncMessage<R>[]
  /** Hand one message to the client, through a real encode/decode round trip. */
  deliver(message: SyncMessage<R>): void
}

function manualTransport(): ManualTransport {
  const listeners = new Set<(message: SyncMessage<EditorRecord>) => void>()
  const sent: SyncMessage<EditorRecord>[] = []
  let closed = false
  return {
    sent,
    send(message) {
      if (!closed) sent.push(message)
    },
    deliver(message) {
      if (closed) return
      const decoded = decodeMessage<EditorRecord>(encodeMessage(message))
      if (!decoded) throw new Error("message did not survive the wire")
      for (const listener of Array.from(listeners)) listener(decoded)
    },
    onMessage(callback) {
      listeners.add(callback)
      return () => void listeners.delete(callback)
    },
    onOpen(callback) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled && !closed) callback()
      })
      return () => {
        cancelled = true
      }
    },
    close() {
      closed = true
      listeners.clear()
    },
  }
}

/** Wraps a transport in a switch, so a test can take the network away. */
function gated(inner: Transport<EditorRecord>): {
  transport: Transport<EditorRecord>
  goOffline(): void
  goOnline(): void
} {
  const opens = new Set<() => void>()
  const closes = new Set<() => void>()
  let online = true
  return {
    transport: {
      send(message) {
        // A socket that is down drops what it is handed, exactly like the
        // WebSocket transport does.
        if (online) inner.send(message)
      },
      onMessage(callback) {
        return inner.onMessage((message) => {
          if (online) callback(message)
        })
      },
      onOpen(callback) {
        opens.add(callback)
        if (online) queueMicrotask(callback)
        return () => void opens.delete(callback)
      },
      onClose(callback) {
        closes.add(callback)
        return () => void closes.delete(callback)
      },
      close: () => inner.close(),
    },
    goOffline() {
      if (!online) return
      online = false
      for (const callback of Array.from(closes)) callback()
    },
    goOnline() {
      if (online) return
      online = true
      for (const callback of Array.from(opens)) callback()
    },
  }
}

/* -------------------------------------------------------------------------- */

describe("conflicting edits", () => {
  let clients: SyncClient[] = []

  afterEach(() => {
    for (const client of clients) client.dispose()
    clients = []
  })

  function join(store: EditorStore, transport: Transport<EditorRecord>, clientId: string): SyncClient {
    const client = createSyncClient<EditorRecord>({ store, roomId: "room", transport, clientId })
    clients.push(client)
    client.connect()
    return client
  }

  it("keeps both edits when two people change different props of one shape", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, ta, "a")
    join(b, tb, "b")
    await flush()

    const id = createShapeId("shared")
    a.put([makeShape(id, 0)])
    await flush()

    // Neither has heard the other when it makes its change.
    setProps(a, id, { w: 100 })
    setProps(b, id, { h: 200 })
    await flush()

    for (const store of [a, b]) {
      expect(store.get(id)?.props).toMatchObject({ w: 100, h: 200 })
    }
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("keeps both edits when they touch different fields at different depths", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, ta, "a")
    join(b, tb, "b")
    await flush()

    const id = createShapeId("deep")
    a.put([makeShape(id, 0)])
    await flush()

    a.update(id, (shape) => ({ ...shape, x: 11, meta: { ...shape.meta, author: "a" } }))
    b.update(id, (shape) => ({ ...shape, rotation: 0.5, meta: { ...shape.meta, note: "b" } }))
    await flush()

    expect(a.get(id)).toMatchObject({ x: 11, rotation: 0.5, meta: { author: "a", note: "b" } })
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("picks the same winner on both peers when they change the same prop", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, ta, "a")
    join(b, tb, "b")
    await flush()

    const id = createShapeId("contested")
    a.put([makeShape(id, 0)])
    await flush()

    setProps(a, id, { w: 1 })
    setProps(b, id, { w: 2 })
    await flush()

    expect(propsOf(a, id)?.w).toBe(propsOf(b, id)?.w)
    // Both stamps have the same lamport value, so the client id breaks the tie.
    expect(propsOf(a, id)?.w).toBe(2)
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("converges whatever order the messages arrive in, duplicates included", async () => {
    const seed = createShapeId("seed")
    const contested = createShapeId("contested")

    // Two producers that never hear each other, so every message is concurrent.
    const producerA = makeStore()
    const producerB = makeStore()
    for (const store of [producerA, producerB]) store.put([makeShape(seed, 0)])
    const ta = manualTransport()
    const tb = manualTransport()
    join(producerA, ta, "a")
    join(producerB, tb, "b")
    await flush()

    producerA.put([makeShape(contested, 1)])
    producerB.put([makeShape(contested, 2)]) // the same id invented twice
    setProps(producerA, contested, { w: 50 })
    producerB.update(contested, (shape) => ({ ...shape, y: 9 }))
    producerA.remove([seed])
    producerB.update(seed, (shape) => ({ ...shape, x: 7 }))
    await flush()

    const messages = [...ta.sent, ...tb.sent].filter((message) => message.type === "diff")
    expect(messages.length).toBe(6)

    const orderings = [
      [0, 1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1, 0],
      [2, 5, 0, 3, 1, 4, 2, 5], // two messages delivered twice
      [4, 0, 4, 2, 1, 5, 3, 3],
      [3, 1, 5, 0, 2, 4],
    ]
    const replicas = orderings.map((order, index) => {
      const store = makeStore()
      store.put([makeShape(seed, 0)])
      const transport = manualTransport()
      join(store, transport, `r${index}`)
      for (const i of order) transport.deliver(messages[i]!)
      return store
    })

    const first = documentBytes(replicas[0]!)
    for (const replica of replicas) expect(documentBytes(replica)).toBe(first)
    // And the merge really happened: the contested shape carries both peers'
    // later edits, not just whichever creation won.
    expect(replicas[0]!.get(contested)).toMatchObject({ y: 9, props: { w: 50 } })
  })

  it("converges on a delete racing an edit, in both arrival orders", async () => {
    const id = createShapeId("doomed")

    const deleter = makeStore()
    const editor = makeStore()
    for (const store of [deleter, editor]) store.put([makeShape(id, 0)])
    const td = manualTransport()
    const te = manualTransport()
    join(deleter, td, "a")
    join(editor, te, "z")
    await flush()

    deleter.remove([id])
    setProps(editor, id, { w: 64 })
    await flush()

    const removal = td.sent.filter((message) => message.type === "diff")[0]!
    const change = te.sent.filter((message) => message.type === "diff")[0]!

    const forwards = makeStore()
    forwards.put([makeShape(id, 0)])
    const tf = manualTransport()
    join(forwards, tf, "f")
    tf.deliver(removal)
    tf.deliver(change)

    const backwards = makeStore()
    backwards.put([makeShape(id, 0)])
    const tb = manualTransport()
    join(backwards, tb, "b")
    tb.deliver(change)
    tb.deliver(removal)

    expect(documentBytes(forwards)).toBe(documentBytes(backwards))
    // Both stamps tie on lamport, so "z" — the editor — wins and the shape lives.
    expect(propsOf(forwards, id)?.w).toBe(64)

    // The two originals agree too, once they finally hear each other.
    td.deliver(change)
    te.deliver(removal)
    expect(documentBytes(deleter)).toBe(documentBytes(editor))
  })

  it("keeps a delete that outranks the edit it races", async () => {
    const id = createShapeId("gone")
    const editor = makeStore()
    const deleter = makeStore()
    for (const store of [editor, deleter]) store.put([makeShape(id, 0)])
    const te = manualTransport()
    const td = manualTransport()
    join(editor, te, "a")
    join(deleter, td, "z")
    await flush()

    setProps(editor, id, { w: 64 })
    deleter.remove([id])
    await flush()

    const change = te.sent.filter((message) => message.type === "diff")[0]!
    const removal = td.sent.filter((message) => message.type === "diff")[0]!

    const orders = [
      [change, removal],
      [removal, change],
    ]
    orders.forEach((order, index) => {
      const store = makeStore()
      store.put([makeShape(id, 0)])
      const transport = manualTransport()
      join(store, transport, `peer${index}`)
      for (const message of order) transport.deliver(message)
      expect(store.get(id)).toBeUndefined()
    })
  })

  it("lets a late joiner adopt a snapshot and then edit without clobbering", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const id = createShapeId("existing")
    a.put([makeShape(id, 0)])
    join(a, hub.join(), "a")
    await flush()

    // A edits before anyone else is in the room, so it holds the only stamps.
    a.update(id, (shape) => ({ ...shape, x: 5 }))
    await flush()

    const b = makeStore()
    join(b, hub.join(), "b")
    await flush()
    expect(b.get(id)?.x).toBe(5)

    // B now edits a different field. A's earlier work must survive on both.
    setProps(b, id, { w: 33 })
    await flush()
    expect(a.get(id)).toMatchObject({ x: 5, props: { w: 33 } })
    expect(documentBytes(a)).toBe(documentBytes(b))

    // And an edit from A to the very field B adopted still lands.
    a.update(id, (shape) => ({ ...shape, x: 6 }))
    await flush()
    expect(b.get(id)?.x).toBe(6)
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("loses nothing when both sides edit while the transport is down", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    const gateA = gated(hub.join())
    const gateB = gated(hub.join())
    const clientA = join(a, gateA.transport, "a")
    join(b, gateB.transport, "b")
    await flush()

    const id = createShapeId("split")
    a.put([makeShape(id, 0)])
    await flush()
    expect(b.get(id)).toBeDefined()

    // The network goes away for A.
    gateA.goOffline()
    await flush()
    expect(clientA.getStatus().get()).toBe("connecting")

    setProps(a, id, { w: 111 }) // offline work on A
    a.update(id, (shape) => ({ ...shape, x: 3 }))
    setProps(b, id, { h: 222 }) // and on B, which still thinks it is alone
    b.update(id, (shape) => ({ ...shape, rotation: 1 }))
    await flush()

    expect(propsOf(a, id)?.h).toBe(10) // nothing crossed while it was down
    expect(propsOf(b, id)?.w).toBe(10)

    gateA.goOnline()
    await flush()

    expect(clientA.getStatus().get()).toBe("online")
    for (const store of [a, b]) {
      expect(store.get(id)).toMatchObject({ x: 3, rotation: 1, props: { w: 111, h: 222 } })
    }
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("carries a delete made offline across the reconnect", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    const gateA = gated(hub.join())
    const gateB = gated(hub.join())
    join(a, gateA.transport, "a")
    join(b, gateB.transport, "b")
    await flush()

    const id = createShapeId("offline-delete")
    a.put([makeShape(id, 0)])
    await flush()
    expect(b.get(id)).toBeDefined()

    gateA.goOffline()
    await flush()
    a.remove([id])
    await flush()
    expect(b.get(id)).toBeDefined()

    gateA.goOnline()
    await flush()
    expect(a.get(id)).toBeUndefined()
    expect(b.get(id)).toBeUndefined()
    expect(documentBytes(a)).toBe(documentBytes(b))
  })
})

/* -------------------------------------------------------------------------- */
/* edits that happen while the client is not connected at all                 */
/* -------------------------------------------------------------------------- */

describe("work done while disconnected", () => {
  let clients: SyncClient[] = []

  afterEach(() => {
    for (const client of clients) client.dispose()
    clients = []
  })

  function make(store: EditorStore, transport: Transport<EditorRecord>, clientId: string): SyncClient {
    const client = createSyncClient<EditorRecord>({ store, roomId: "room", transport, clientId })
    clients.push(client)
    return client
  }

  it("survives disconnect() and reconnect, on both sides", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    make(a, hub.join(), "a").connect()
    const clientB = make(b, hub.join(), "b")
    clientB.connect()
    await flush()

    const id = createShapeId("offline-edit")
    a.put([makeShape(id, 0)])
    await flush()
    expect(b.get(id)).toBeDefined()

    // Not "the socket went away": the client itself is put down and taken up
    // again, which is what a page does when it stops and restarts syncing.
    clientB.disconnect()
    await flush()

    setProps(b, id, { w: 111 }) // done with no client listening at all
    b.update(id, (shape) => ({ ...shape, y: 9 }))
    const created = createShapeId("made-offline")
    b.put([makeShape(created, 5)])
    a.update(id, (shape) => ({ ...shape, x: 7 })) // and the room keeps moving
    await flush()

    clientB.connect()
    await flush()

    // Everything survives: B's offline edits are stamped when they happen, so
    // the room's snapshot merges with them instead of replacing them.
    for (const store of [a, b]) {
      expect(store.get(id)).toMatchObject({ x: 7, y: 9, props: { w: 111 } })
      expect(store.get(created)).toBeDefined()
    }
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("survives a delete made while disconnected", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    make(a, hub.join(), "a").connect()
    const clientB = make(b, hub.join(), "b")
    clientB.connect()
    await flush()

    const id = createShapeId("offline-delete")
    a.put([makeShape(id, 0)])
    await flush()

    clientB.disconnect()
    await flush()
    b.remove([id])
    await flush()
    expect(a.get(id)).toBeDefined()

    clientB.connect()
    await flush()
    expect(a.get(id)).toBeUndefined()
    expect(b.get(id)).toBeUndefined()
    expect(documentBytes(a)).toBe(documentBytes(b))
  })

  it("keeps records made before the client ever connected", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    make(a, hub.join(), "a").connect()
    const clientB = make(b, hub.join(), "b")
    await flush()

    const fromA = createShapeId("from-a")
    a.put([makeShape(fromA, 1)])
    const madeFirst = createShapeId("made-before-connecting")
    b.put([makeShape(madeFirst, 2)]) // B is not connected yet
    await flush()

    clientB.connect()
    await flush()

    for (const store of [a, b]) {
      expect(store.get(madeFirst)).toBeDefined()
      expect(store.get(fromA)).toBeDefined()
    }
    expect(documentBytes(a)).toBe(documentBytes(b))
  })
})

/* -------------------------------------------------------------------------- */
/* a store that rewrites what it is handed                                    */
/* -------------------------------------------------------------------------- */

describe("a side effect that rewrites a merged record", () => {
  let clients: SyncClient[] = []

  afterEach(() => {
    for (const client of clients) client.dispose()
    clients = []
  })

  it("is stamped and sent, so it does not live on one replica only", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()

    // B clamps widths. Nothing tells A about that, so without feeding the
    // rewrite back into the CRDT the two stores drift apart for good.
    b.sideEffects.registerBeforeChangeHandler("shape", (_prev, next) => {
      const props = next.props as { w?: number }
      if (typeof props.w === "number" && props.w > 50) {
        return { ...next, props: { ...props, w: 50 } } as typeof next
      }
      return next
    })

    for (const [store, id] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const client = createSyncClient<EditorRecord>({ store, roomId: "room", transport: hub.join(), clientId: id })
      clients.push(client)
      client.connect()
    }
    await flush()

    const id = createShapeId("clamped")
    a.put([makeShape(id, 0)])
    await flush()

    setProps(a, id, { w: 400 })
    await flush(12)

    expect(propsOf(b, id)?.w).toBe(50)
    expect(propsOf(a, id)?.w).toBe(50) // the rewrite came back as a stamped write
    expect(documentBytes(a)).toBe(documentBytes(b))
  })
})
