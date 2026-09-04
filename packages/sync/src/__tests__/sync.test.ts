import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createShapeId,
  createStore,
  InstancePresenceRecordType,
  PageRecordType,
  ShapeRecordType,
  type EditorRecord,
  type EditorStore,
  type PageId,
  type ShapeId,
} from "@mocanvas/editor"
import { ZERO_INDEX_KEY, type HistoryEntry } from "@mocanvas/store"
import { createSyncClient, type SyncClient } from "../SyncClient"
import { createMemoryHub, createMemoryTransportPair, type Transport } from "../transport"
import { decodeMessage, encodeMessage, PROTOCOL_VERSION, type SyncMessage } from "../protocol"
import { createEmptyCrdtState } from "../crdt"
import { createPresenceSync, presenceIdForClient, type PresenceEditor } from "../presence"

/** Let every queued microtask (the in-memory transport's delivery) run. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

const PAGE_ID = PageRecordType.createId("test") as PageId

function makeStore(): EditorStore {
  const store = createStore()
  store.put([PageRecordType.create({ id: PAGE_ID, name: "Page 1", index: ZERO_INDEX_KEY })])
  return store
}

function makeShape(id: ShapeId, x: number): EditorRecord {
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

describe("protocol", () => {
  it("round trips every message kind", () => {
    const shape = makeShape(createShapeId("a"), 1)
    const presence = InstancePresenceRecordType.create({
      id: presenceIdForClient("c1"),
      userId: "user:1",
      currentPageId: PAGE_ID,
    })
    const messages: SyncMessage<EditorRecord>[] = [
      { type: "hello", clientId: "c1", version: PROTOCOL_VERSION },
      { type: "snapshot", records: [shape], state: createEmptyCrdtState() },
      {
        type: "diff",
        clientId: "c1",
        seq: 3,
        diff: { puts: [{ record: shape, fields: { x: { lamport: 1, client: "c1" } } }], removes: [] },
      },
      { type: "presence", clientId: "c1", record: presence },
      { type: "bye", clientId: "c1" },
    ]
    for (const message of messages) {
      expect(decodeMessage<EditorRecord>(encodeMessage(message))).toEqual(message)
    }
  })

  it("rejects malformed input instead of throwing", () => {
    expect(decodeMessage("not json")).toBeNull()
    expect(decodeMessage("null")).toBeNull()
    expect(decodeMessage(JSON.stringify({ type: "nope" }))).toBeNull()
    expect(decodeMessage(JSON.stringify({ type: "hello", clientId: 7, version: PROTOCOL_VERSION }))).toBeNull()
    expect(decodeMessage(JSON.stringify({ type: "diff", clientId: "c", seq: 0, diff: null }))).toBeNull()
    expect(
      decodeMessage(JSON.stringify({ type: "diff", clientId: "c", seq: 0, diff: { puts: [{}], removes: [] } })),
    ).toBeNull()
    expect(decodeMessage(JSON.stringify({ type: "snapshot", records: [{ id: "x" }] }))).toBeNull()
    // records fine, state missing
    expect(decodeMessage(JSON.stringify({ type: "snapshot", records: [] }))).toBeNull()
  })

  it("reports a peer on another protocol version instead of misparsing it", () => {
    const older = JSON.stringify({ type: "diff", clientId: "c1", seq: 0, diff: { added: {} }, version: 1 })
    expect(decodeMessage(older)).toEqual({ type: "unsupported", version: 1, clientId: "c1" })
    const newer = JSON.stringify({ type: "snapshot", records: [], version: PROTOCOL_VERSION + 1 })
    expect(decodeMessage(newer)).toEqual({ type: "unsupported", version: PROTOCOL_VERSION + 1 })
  })
})

describe("document sync", () => {
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

  it("sends a put on A to B", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, ta, "a")
    join(b, tb, "b")
    await flush()

    const id = createShapeId("shared")
    a.put([makeShape(id, 42)])
    await flush()

    expect(b.get(id)?.id).toBe(id)
    expect(b.get(id)?.x).toBe(42)
  })

  it("reports the connection status as a signal", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const client = createSyncClient<EditorRecord>({ store: a, roomId: "room", transport: ta, clientId: "a" })
    clients.push(client)
    expect(client.getStatus().get()).toBe("offline")
    client.connect()
    expect(client.getStatus().get()).toBe("connecting")
    await flush()
    expect(client.getStatus().get()).toBe("online")
    client.disconnect()
    expect(client.getStatus().get()).toBe("offline")
    tb.close()
  })

  it("does not echo a remote change back as a user change", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, ta, "a")
    join(b, tb, "b")
    await flush()

    const userEntries: HistoryEntry<EditorRecord>[] = []
    const remoteEntries: HistoryEntry<EditorRecord>[] = []
    a.listen((entry) => userEntries.push(entry), { source: "user", scope: "document" })
    a.listen((entry) => remoteEntries.push(entry), { source: "remote", scope: "document" })

    const id = createShapeId("from-b")
    b.put([makeShape(id, 7)])
    await flush()

    expect(a.get(id)).toBeDefined()
    expect(remoteEntries).toHaveLength(1)
    expect(userEntries).toHaveLength(0)
  })

  it("hands a late joiner the document as a snapshot", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const id = createShapeId("early")
    a.put([makeShape(id, 5)])
    join(a, hub.join(), "a")
    await flush()

    const b = makeStore()
    expect(b.get(id)).toBeUndefined()
    join(b, hub.join(), "b")
    await flush()

    expect(b.get(id)).toBeDefined()
    expect(b.get(id)?.x).toBe(5)
  })

  it("does not let a snapshot meant for a newcomer clobber an established peer", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    join(a, hub.join(), "a")
    join(b, hub.join(), "b")
    await flush()

    const id = createShapeId("late-edit")
    a.put([makeShape(id, 1)])
    await flush()

    // A third peer joins; both A and B answer with a snapshot.
    const c = makeStore()
    join(c, hub.join(), "c")
    await flush()

    expect(c.get(id)).toBeDefined()
    expect(a.get(id)).toBeDefined()
    expect(b.get(id)).toBeDefined()
  })
})

/* -------------------------------------------------------------------------- */
/* presence                                                                   */
/* -------------------------------------------------------------------------- */

function makePresenceEditor(store: EditorStore, userId: string): PresenceEditor & { cursor: { x: number; y: number } } {
  const cursor = { x: 0, y: 0 }
  return {
    cursor,
    store,
    inputs: { currentPagePoint: cursor },
    user: { getId: () => userId, getName: () => "Ada", getColor: () => "#3f86d8" },
    getCurrentPageId: () => PAGE_ID,
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    getSelectedShapeIds: () => [],
    getInstanceState: () => ({
      cursor: { type: "default", rotation: 0 },
      brush: null,
      scribbles: [],
      followingUserId: null,
    }),
  }
}

describe("presence", () => {
  let clients: SyncClient[] = []

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const client of clients) client.dispose()
    clients = []
    vi.useRealTimers()
  })

  it("collapses a burst of updates into one send", async () => {
    const store = makeStore()
    const editor = makePresenceEditor(store, "user:burst")
    const sent: unknown[] = []
    const presence = createPresenceSync({
      editor,
      clientId: "c1",
      send: (record) => sent.push(record),
      throttleMs: 34,
      heartbeatMs: 100_000,
    })

    presence.start()
    expect(sent).toHaveLength(1) // the initial state

    for (let i = 1; i <= 100; i++) {
      editor.cursor.x = i
      presence.poke()
    }
    expect(sent).toHaveLength(1) // nothing sent yet: all 100 pokes collapsed

    vi.advanceTimersByTime(34)
    expect(sent).toHaveLength(2)
    expect((sent[1] as { cursor: { x: number } }).cursor.x).toBe(100)

    // A poke with nothing new to say does not send.
    presence.poke()
    vi.advanceTimersByTime(34)
    expect(sent).toHaveLength(2)

    presence.dispose()
  })

  it("shares presence records, drops them on bye and sweeps stale ones", async () => {
    const [ta, tb] = createMemoryTransportPair<EditorRecord>()
    const a = makeStore()
    const b = makeStore()

    const clientA = createSyncClient<EditorRecord>({
      store: a,
      roomId: "room",
      transport: ta,
      clientId: "a",
      presence: { editor: makePresenceEditor(a, "user:a") },
      presenceThrottleMs: 34,
      presenceHeartbeatMs: 100_000,
      presenceTimeoutMs: 10_000,
    })
    const clientB = createSyncClient<EditorRecord>({
      store: b,
      roomId: "room",
      transport: tb,
      clientId: "b",
      presence: { editor: makePresenceEditor(b, "user:b") },
      presenceThrottleMs: 34,
      presenceHeartbeatMs: 100_000,
      presenceTimeoutMs: 10_000,
    })
    clients.push(clientA, clientB)
    clientA.connect()
    clientB.connect()
    await flush()

    const presenceOfB = presenceIdForClient("b")
    const presenceOfA = presenceIdForClient("a")
    expect(a.get(presenceOfB)).toBeDefined()
    expect(b.get(presenceOfA)).toBeDefined()
    expect(a.get(presenceOfB)?.userId).toBe("user:b")

    // A presence record is never a document record.
    expect(a.serialize("document")[presenceOfB]).toBeUndefined()

    // Saying goodbye removes it right away.
    clientB.disconnect()
    await flush()
    expect(a.get(presenceOfB)).toBeUndefined()
  })

  it("sweeps a collaborator that goes quiet", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeStore()
    const b = makeStore()
    const clientA = createSyncClient<EditorRecord>({
      store: a,
      roomId: "room",
      transport: hub.join(),
      clientId: "a",
      presenceTimeoutMs: 10_000,
    })
    const transportB = hub.join()
    const clientB = createSyncClient<EditorRecord>({
      store: b,
      roomId: "room",
      transport: transportB,
      clientId: "b",
      presence: { editor: makePresenceEditor(b, "user:b") },
      presenceThrottleMs: 34,
      presenceHeartbeatMs: 100_000,
      presenceTimeoutMs: 10_000,
    })
    clients.push(clientA, clientB)
    clientA.connect()
    clientB.connect()
    await flush()

    const presenceOfB = presenceIdForClient("b")
    expect(a.get(presenceOfB)).toBeDefined()

    // B stops talking without saying goodbye (its tab was closed hard). The
    // sweeper runs every 2.5s, so the first tick past the 10s timeout is 12.5s.
    transportB.close()
    await vi.advanceTimersByTimeAsync(13_000)
    await flush()

    expect(a.get(presenceOfB)).toBeUndefined()
  })
})
