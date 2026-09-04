import { describe, expect, it } from "vitest"
import { createEmptyRecordsDiff, type RecordId, type RecordsDiff } from "@mocanvas/store"
import { createCrdt, stampedDiffFromSnapshot, type Crdt, type CrdtState, type StampedDiff } from "./crdt"

/**
 * Convergence properties that the fuzzer in `fuzz.test.ts` found the hard way,
 * pinned down one at a time. Each one is a schedule the merge used to get
 * wrong, written so it fails loudly on the old behaviour.
 */

interface Doc {
  readonly id: RecordId<Doc>
  readonly typeName: "doc"
  x: number
  props: { w: number; h: number }
  meta: Record<string, unknown>
}

const docId = (name: string) => `doc:${name}` as RecordId<Doc>

function makeDoc(name: string, over: Partial<Omit<Doc, "id" | "typeName">> = {}): Doc {
  return {
    id: docId(name),
    typeName: "doc",
    x: 0,
    props: { w: 10, h: 10 },
    meta: {},
    ...over,
  }
}

/** Key-order-independent bytes: two replicas "agree" only if the values match. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

type Message = { kind: "diff"; diff: StampedDiff<Doc> } | { kind: "snapshot"; records: Doc[]; state: CrdtState }

interface Replica {
  readonly id: string
  readonly crdt: Crdt<Doc>
  readonly records: Map<string, Doc>
  /** Everything this replica minted while merging, waiting to be delivered. */
  readonly outbox: Message[]
  put(doc: Doc): Message
  remove(name: string): Message
  receive(message: Message): void
  snapshot(): Message
  get(name: string): Doc | undefined
  dump(): string
}

/** Messages cross a JSON wire, exactly as the transports send them. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function makeReplica(id: string, options: { tombstoneLimit?: number; now?: () => number } = {}): Replica {
  const records = new Map<string, Doc>()
  const outbox: Message[] = []
  const crdt = createCrdt<Doc>({
    clientId: id,
    getRecord: (rid) => records.get(rid),
    ...(options.tombstoneLimit !== undefined ? { tombstoneLimit: options.tombstoneLimit } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  })

  const apply = (diff: RecordsDiff<Doc>) => {
    for (const rid in diff.added) records.set(rid, diff.added[rid as RecordId<Doc>]!)
    for (const rid in diff.updated) records.set(rid, diff.updated[rid as RecordId<Doc>]![1])
    for (const rid in diff.removed) records.delete(rid)
  }

  const collect = () => {
    const minted = crdt.takeOutgoing()
    if (minted) outbox.push({ kind: "diff", diff: wire(minted) })
  }

  return {
    id,
    crdt,
    records,
    outbox,
    put(doc) {
      const diff = createEmptyRecordsDiff<Doc>()
      const before = records.get(doc.id)
      if (before) diff.updated[doc.id] = [before, doc]
      else diff.added[doc.id] = doc
      apply(diff)
      return { kind: "diff", diff: wire(crdt.stampLocal(diff)) }
    },
    remove(name) {
      const diff = createEmptyRecordsDiff<Doc>()
      const before = records.get(docId(name))
      if (before) diff.removed[docId(name)] = before
      apply(diff)
      return { kind: "diff", diff: wire(crdt.stampLocal(diff)) }
    },
    receive(message) {
      if (message.kind === "diff") {
        apply(crdt.mergeRemote(wire(message.diff)))
        collect()
        return
      }
      apply(crdt.mergeRemote(stampedDiffFromSnapshot(wire(message.records), wire(message.state))))
      collect()
    },
    snapshot: () => wire({ kind: "snapshot", records: [...records.values()], state: crdt.getState() }) as Message,
    get: (name) => records.get(docId(name)),
    dump: () =>
      canonical(
        [...records.keys()].sort().map((rid) => records.get(rid)),
      ),
  }
}

/** Deliver everything anybody minted, then swap snapshots until nothing moves. */
function quiesce(replicas: Replica[]): void {
  for (let round = 0; round < 6; round++) {
    const pending: { from: Replica; message: Message }[] = []
    for (const replica of replicas) {
      for (const message of replica.outbox.splice(0)) pending.push({ from: replica, message })
    }
    for (const { from, message } of pending) {
      for (const to of replicas) if (to !== from) to.receive(message)
    }
    const before = replicas.map((r) => r.dump()).join("|")
    for (const from of replicas) {
      const snapshot = from.snapshot()
      for (const to of replicas) if (to !== from) to.receive(snapshot)
    }
    const after = replicas.map((r) => r.dump()).join("|")
    if (after === before && replicas.every((r) => r.outbox.length === 0)) return
  }
}

/** Every ordering of `messages`, as a list of index permutations. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail])
  }
  return out
}

/* -------------------------------------------------------------------------- */

describe("paths are a tree, not a flat namespace", () => {
  it("converges when a key is deleted while its child is edited, in either order", () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { meta: { note: { text: "hi" } } }))

    const deleter = makeReplica("deleter")
    const editor = makeReplica("editor")
    for (const replica of [deleter, editor]) replica.receive(create)

    // One drops the whole `meta.note` object; the other edits `meta.note.text`.
    const dropped = deleter.put({ ...deleter.get("s")!, meta: {} })
    const edited = editor.put({
      ...editor.get("s")!,
      meta: { note: { text: "rewritten" } },
    })

    const results = new Set<string>()
    for (const order of permutations([dropped, edited])) {
      const replica = makeReplica("witness")
      replica.receive(create)
      for (const message of order) replica.receive(message)
      results.add(replica.dump())
    }
    expect(results.size).toBe(1)
  })

  it("keeps a child written later than the parent that was dropped", () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { meta: { note: { text: "hi" } } }))
    const deleter = makeReplica("deleter")
    deleter.receive(create)
    const dropped = deleter.put({ ...deleter.get("s")!, meta: {} })

    // The editor has seen the delete, so its write is unambiguously later.
    const editor = makeReplica("editor")
    editor.receive(create)
    editor.receive(dropped)
    editor.receive(create) // idempotent, and it must not bring `note` back
    expect(editor.get("s")!.meta).toEqual({})
  })
})

describe("a record revived by an edit that outranks a delete", () => {
  /**
   * The tombstone takes the provenance of every field it outranks, so the
   * fields that came from *before* the delete have no stamp to settle them.
   * Whoever keeps the record alive re-claims its whole body under a fresh
   * stamp; without that, each replica simply kept its own leftovers and no
   * later message could tell them apart.
   */
  function scenario() {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { x: 1, props: { w: 1, h: 1 } }))

    // An edit made without having seen the delete that is about to happen.
    const slow = makeReplica("slow")
    slow.receive(create)
    const staleEdit = slow.put({ ...slow.get("s")!, props: { ...slow.get("s")!.props, h: 41 } })

    const deleter = makeReplica("deleter")
    deleter.receive(create)
    deleter.receive(staleEdit) // so the delete is the greater stamp
    const remove = deleter.remove("s")

    // An edit that outranks the delete without having seen it: the reviver has
    // heard something else the deleter said afterwards, so its clock is past
    // the tombstone, and it still holds the record it is editing.
    const reviver = makeReplica("reviver")
    reviver.receive(create)
    reviver.receive(deleter.put(makeDoc("elsewhere")))
    const revivingEdit = reviver.put({ ...reviver.get("s")!, x: 9 })
    return { create, staleEdit, remove, revivingEdit }
  }

  it("ends with one agreed body whatever order the messages arrive in", () => {
    const { create, staleEdit, remove, revivingEdit } = scenario()

    // `left` holds the stale edit when the delete lands; `right` never saw it.
    const left = makeReplica("left")
    for (const message of [create, staleEdit, revivingEdit, remove]) left.receive(message)
    const right = makeReplica("right")
    for (const message of [create, revivingEdit, remove, staleEdit]) right.receive(message)
    // `rebuilt` lost the record to the delete and put it back from a body.
    const rebuilt = makeReplica("rebuilt")
    for (const message of [create, remove, staleEdit, revivingEdit]) rebuilt.receive(message)

    expect(left.get("s")).toBeDefined()
    quiesce([left, right, rebuilt])
    expect(right.dump()).toBe(left.dump())
    expect(rebuilt.dump()).toBe(left.dump())
  })

  it("stays deleted when nothing outranks the tombstone", () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s"))
    const editor = makeReplica("editor")
    editor.receive(create)
    const edit = editor.put({ ...editor.get("s")!, x: 5 })

    const deleter = makeReplica("deleter")
    deleter.receive(create)
    deleter.receive(edit) // sees the edit, so its delete is the greater stamp
    const remove = deleter.remove("s")

    for (const order of permutations([edit, remove])) {
      const replica = makeReplica("witness")
      replica.receive(create)
      for (const message of order) replica.receive(message)
      expect(replica.get("s")).toBeUndefined()
      expect(replica.outbox).toEqual([]) // nothing was revived, so nothing is sent
    }
  })
})

describe("a body that arrives without its stamps", () => {
  it("is repaired by the next snapshot exchange", () => {
    // `late` never receives the creation, only an edit to one field, so the
    // rest of the record arrives with no provenance at all.
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { x: 1, props: { w: 1, h: 1 } }))
    const peer = makeReplica("peer")
    peer.receive(create)
    const wEdit = peer.put({ ...peer.get("s")!, props: { ...peer.get("s")!.props, w: 99 } })

    // Meanwhile the author moves the record; `late` misses that message too.
    const xEdit = author.put({ ...author.get("s")!, x: 7 })
    peer.receive(xEdit)

    const late = makeReplica("late")
    late.receive(wEdit) // materializes the whole record from a body it cannot check
    expect(late.get("s")!.x).toBe(1) // stale: the author's move is not in that body

    quiesce([author, peer, late])
    expect(late.dump()).toBe(author.dump())
    expect(late.dump()).toBe(peer.dump())
  })

  it("loses to a stamped write in either arrival order", () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { x: 1 }))
    const peer = makeReplica("peer")
    peer.receive(create)
    const stamped = author.put({ ...author.get("s")!, x: 7 })
    const bodyOnly = peer.put({ ...peer.get("s")!, props: { w: 3, h: 3 } })

    const results = new Set<string>()
    for (const order of permutations([stamped, bodyOnly])) {
      const late = makeReplica("late")
      for (const message of order) late.receive(message)
      results.add(late.dump())
      expect(late.get("s")!.x).toBe(7)
    }
    expect(results.size).toBe(1)
  })
})

describe("merge algebra, on the paths the fuzzer exercises", () => {
  const build = () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s", { meta: { note: { text: "hi" } } }))
    const peer = makeReplica("peer")
    peer.receive(create)
    return { author, peer, create }
  }

  it("is idempotent for creates, edits, deletes and revivals", () => {
    const { author, peer, create } = build()
    const edit = peer.put({ ...peer.get("s")!, meta: { note: { text: "yo" }, tag: 1 } })
    const remove = author.remove("s")
    const revive = peer.put({ ...peer.get("s")!, x: 3 })

    const replica = makeReplica("witness")
    for (const message of [create, edit, remove, revive]) {
      replica.receive(message)
      const once = replica.dump()
      replica.receive(message)
      replica.receive(message)
      expect(replica.dump()).toBe(once)
    }
  })

  it("is commutative over a mixed message set", () => {
    const { author, peer, create } = build()
    const a1 = author.put({ ...author.get("s")!, x: 4 })
    const b1 = peer.put({ ...peer.get("s")!, meta: { note: { text: "yo" } } })
    const b2 = peer.put({ ...peer.get("s")!, props: { w: 2, h: 2 } })

    const results = new Set<string>()
    for (const order of permutations([a1, b1, b2])) {
      const replica = makeReplica("witness")
      replica.receive(create)
      for (const message of order) replica.receive(message)
      results.add(replica.dump())
    }
    expect(results.size).toBe(1)
  })
})

describe("tombstones are bounded, and the bound is the promise", () => {
  it("blocks an older edit for as long as the tombstone is kept", () => {
    const author = makeReplica("author")
    const create = author.put(makeDoc("s"))
    const editor = makeReplica("editor")
    editor.receive(create)
    const stale = editor.put({ ...editor.get("s")!, x: 5 })

    // The author has seen the edit, so its delete is unambiguously the later
    // write and the edit is a straggler that must not bring the record back.
    author.receive(stale)
    const remove = author.remove("s")

    for (const order of permutations([stale, remove])) {
      const replica = makeReplica("witness", { tombstoneLimit: 10 })
      replica.receive(create)
      for (const message of order) replica.receive(message)
      expect(replica.get("s")).toBeUndefined()
    }
  })

  it("lets an older edit resurrect a record once the tombstone is collected", () => {
    // The documented cost of bounding tombstones, asserted rather than assumed.
    const author = makeReplica("author")
    const create = author.put(makeDoc("s"))
    const editor = makeReplica("editor")
    editor.receive(create)
    const stale = editor.put({ ...editor.get("s")!, x: 5 })

    author.receive(stale)
    const replica = makeReplica("witness", { tombstoneLimit: 0 })
    replica.receive(create)
    replica.receive(author.remove("s"))
    expect(replica.get("s")).toBeUndefined()
    replica.receive(stale)
    expect(replica.get("s")?.x).toBe(5)
  })
})
