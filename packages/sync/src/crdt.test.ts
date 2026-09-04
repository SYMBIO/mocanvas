import { describe, expect, it } from "vitest"
import { createEmptyRecordsDiff, type RecordId, type RecordsDiff } from "@mocanvas/store"
import {
  changedPaths,
  compareStamps,
  createCrdt,
  createLamportClock,
  leafPaths,
  stampedDiffFromSnapshot,
  type Crdt,
  type CrdtState,
  type Stamp,
  type StampedDiff,
} from "./crdt"

/* -------------------------------------------------------------------------- */
/* a record type and a replica, with no store and no transport in sight        */
/* -------------------------------------------------------------------------- */

interface Box {
  readonly id: RecordId<Box>
  readonly typeName: "box"
  x: number
  y: number
  props: { w: number; h: number; points: number[] }
  meta: Record<string, unknown>
}

const boxId = (name: string) => `box:${name}` as RecordId<Box>

function makeBox(name: string, over: Partial<Omit<Box, "id" | "typeName">> = {}): Box {
  return Object.freeze({
    id: boxId(name),
    typeName: "box",
    x: 0,
    y: 0,
    props: Object.freeze({ w: 10, h: 10, points: [1, 2] }) as Box["props"],
    meta: Object.freeze({}) as Box["meta"],
    ...over,
  })
}

interface Replica {
  readonly clientId: string
  readonly crdt: Crdt<Box>
  readonly records: Map<string, Box>
  /** Make a local change and return the message it would broadcast. */
  put(record: Box): StampedDiff<Box>
  remove(id: string): StampedDiff<Box>
  /** Merge a peer's message. Returns the diff that was applied locally. */
  receive(message: StampedDiff<Box>): RecordsDiff<Box>
  snapshot(): { records: Box[]; state: CrdtState }
  get(name: string): Box | undefined
  dump(): string
}

function makeReplica(
  clientId: string,
  options: { tombstoneLimit?: number; tombstoneMaxAgeMs?: number; now?: () => number } = {},
): Replica {
  const records = new Map<string, Box>()
  const crdt = createCrdt<Box>({
    clientId,
    getRecord: (id) => records.get(id),
    ...(options.tombstoneLimit !== undefined ? { tombstoneLimit: options.tombstoneLimit } : {}),
    ...(options.tombstoneMaxAgeMs !== undefined ? { tombstoneMaxAgeMs: options.tombstoneMaxAgeMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  })

  const apply = (diff: RecordsDiff<Box>) => {
    for (const id in diff.added) records.set(id, diff.added[id as RecordId<Box>]!)
    for (const id in diff.updated) records.set(id, diff.updated[id as RecordId<Box>]![1])
    for (const id in diff.removed) records.delete(id)
  }

  return {
    clientId,
    crdt,
    records,
    put(record) {
      const diff = createEmptyRecordsDiff<Box>()
      const before = records.get(record.id)
      if (before) diff.updated[record.id] = [before, record]
      else diff.added[record.id] = record
      apply(diff)
      return crdt.stampLocal(diff)
    },
    remove(id) {
      const diff = createEmptyRecordsDiff<Box>()
      const before = records.get(id)
      if (!before) return crdt.stampLocal(diff)
      diff.removed[id as RecordId<Box>] = before
      apply(diff)
      return crdt.stampLocal(diff)
    },
    receive(message) {
      // Messages cross a wire: they are always plain JSON on the far side.
      const decoded = JSON.parse(JSON.stringify(message)) as StampedDiff<Box>
      const diff = crdt.mergeRemote(decoded)
      apply(diff)
      return diff
    },
    snapshot() {
      return JSON.parse(JSON.stringify({ records: [...records.values()], state: crdt.getState() })) as {
        records: Box[]
        state: CrdtState
      }
    },
    get: (name) => records.get(boxId(name)),
    dump: () => stableStringify([...records.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  }
}

/** Key-order-independent serialization, so "identical" means identical values. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

const edit = (replica: Replica, name: string, change: (box: Box) => Box): StampedDiff<Box> => {
  const before = replica.get(name)
  if (!before) throw new Error(`no such box ${name}`)
  return replica.put(change(before))
}

const withProps = (box: Box, props: Partial<Box["props"]>): Box => ({ ...box, props: { ...box.props, ...props } })

/* -------------------------------------------------------------------------- */

describe("stamps", () => {
  it("is a total order: lamport first, client id as the tiebreak", () => {
    expect(compareStamps({ lamport: 1, client: "a" }, { lamport: 2, client: "a" })).toBe(-1)
    expect(compareStamps({ lamport: 2, client: "a" }, { lamport: 1, client: "z" })).toBe(1)
    expect(compareStamps({ lamport: 1, client: "a" }, { lamport: 1, client: "b" })).toBe(-1)
    expect(compareStamps({ lamport: 1, client: "b" }, { lamport: 1, client: "a" })).toBe(1)
    expect(compareStamps({ lamport: 1, client: "a" }, { lamport: 1, client: "a" })).toBe(0)
  })

  it("is antisymmetric and transitive over a spread of stamps", () => {
    const stamps: Stamp[] = []
    for (const lamport of [0, 1, 2, 17]) {
      for (const client of ["a", "b", "zz", "A"]) stamps.push({ lamport, client })
    }
    for (const a of stamps) {
      for (const b of stamps) {
        expect(compareStamps(a, b)).toBe(-compareStamps(b, a) + 0)
        for (const c of stamps) {
          if (compareStamps(a, b) < 0 && compareStamps(b, c) < 0) expect(compareStamps(a, c)).toBeLessThan(0)
        }
      }
    }
  })
})

describe("lamport clock", () => {
  it("ticks locally and jumps past anything it observes", () => {
    const clock = createLamportClock()
    expect(clock.get()).toBe(0)
    expect(clock.tick()).toBe(1)
    clock.observe(9)
    expect(clock.get()).toBe(10) // max(1, 9) + 1
    clock.observe(3)
    expect(clock.get()).toBe(11) // max(10, 3) + 1
    expect(clock.tick()).toBe(12)
  })
})

describe("field paths", () => {
  it("walks into plain objects and stops at arrays", () => {
    expect(leafPaths(makeBox("a")).sort()).toEqual([
      "id",
      "meta", // an empty plain object is a leaf, not a subtree
      "props.h",
      "props.points",
      "props.w",
      "typeName",
      "x",
      "y",
    ])
  })

  it("treats an empty object as one leaf", () => {
    expect(leafPaths({ meta: {} })).toEqual(["meta"])
  })

  it("reports only what changed", () => {
    const before = makeBox("a")
    expect(changedPaths(before, withProps(before, { w: 20 }))).toEqual(["props.w"])
    expect(changedPaths(before, { ...before, x: 1, y: 2 })).toEqual(["x", "y"])
    // An array is one register: any change to it stamps the whole array.
    expect(changedPaths(before, withProps(before, { points: [1, 2, 3] }))).toEqual(["props.points"])
    expect(changedPaths(before, before)).toEqual([])
  })

  it("reports added and removed keys", () => {
    const before = { ...makeBox("a"), meta: { keep: 1, drop: 2 } }
    const after = { ...before, meta: { keep: 1, added: 3 } }
    expect(changedPaths(before, after).sort()).toEqual(["meta.added", "meta.drop"])
  })
})

describe("concurrent edits", () => {
  it("keeps both when they touch different fields of one record", () => {
    const a = makeReplica("a")
    const b = makeReplica("b")
    const created = a.put(makeBox("s"))
    b.receive(created)

    const fromA = edit(a, "s", (box) => withProps(box, { w: 20 }))
    const fromB = edit(b, "s", (box) => withProps(box, { h: 30 }))
    b.receive(fromA)
    a.receive(fromB)

    expect(a.get("s")?.props).toEqual({ w: 20, h: 30, points: [1, 2] })
    expect(b.get("s")?.props).toEqual({ w: 20, h: 30, points: [1, 2] })
    expect(a.dump()).toBe(b.dump())
  })

  it("keeps edits to different top-level fields of one record", () => {
    const a = makeReplica("a")
    const b = makeReplica("b")
    b.receive(a.put(makeBox("s")))

    const fromA = edit(a, "s", (box) => ({ ...box, x: 100 }))
    const fromB = edit(b, "s", (box) => ({ ...box, y: 200 }))
    a.receive(fromB)
    b.receive(fromA)

    expect(a.get("s")?.x).toBe(100)
    expect(a.get("s")?.y).toBe(200)
    expect(a.dump()).toBe(b.dump())
  })

  it("picks the same winner on both sides when they touch the same field", () => {
    const a = makeReplica("a")
    const z = makeReplica("z")
    z.receive(a.put(makeBox("s")))

    const fromA = edit(a, "s", (box) => ({ ...box, x: 1 }))
    const fromZ = edit(z, "s", (box) => ({ ...box, x: 2 }))
    a.receive(fromZ)
    z.receive(fromA)

    // Same lamport, so the client id decides: "z" > "a".
    expect(a.get("s")?.x).toBe(2)
    expect(z.get("s")?.x).toBe(2)
  })

  it("merges a record created with the same id on two peers, field by field", () => {
    const a = makeReplica("a")
    const z = makeReplica("z")
    // Two peers invent the same id at the same time, then each edits one field.
    const createA = a.put(makeBox("same", { x: 1 }))
    const createZ = z.put(makeBox("same", { y: 2 }))
    const editA = edit(a, "same", (box) => ({ ...box, x: 11 }))
    const editZ = edit(z, "same", (box) => withProps(box, { w: 99 }))

    for (const message of [createZ, editZ]) a.receive(message)
    for (const message of [createA, editA]) z.receive(message)

    expect(a.dump()).toBe(z.dump())
    // A creation writes every field, so the tied creations go to "z" whole;
    // the two later edits are newer and each keeps its own field.
    expect(a.get("same")).toMatchObject({ x: 11, y: 2, props: { w: 99, h: 10 } })
  })
})

describe("merge algebra", () => {
  it("is idempotent: the same message twice changes nothing the second time", () => {
    const a = makeReplica("a")
    const b = makeReplica("b")
    const created = a.put(makeBox("s"))
    const changed = edit(a, "s", (box) => ({ ...box, x: 5 }))

    expect(b.receive(created).added).not.toEqual({})
    const before = b.dump()
    expect(Object.keys(b.receive(created).added)).toHaveLength(0)
    expect(b.dump()).toBe(before)

    b.receive(changed)
    const after = b.dump()
    const again = b.receive(changed)
    expect(again.added).toEqual({})
    expect(again.updated).toEqual({})
    expect(again.removed).toEqual({})
    expect(b.dump()).toBe(after)
  })

  it("is commutative: two messages in either order reach the same state", () => {
    const source = makeReplica("a")
    const other = makeReplica("b")
    const create = source.put(makeBox("s"))
    other.receive(create)
    const m1 = edit(source, "s", (box) => withProps(box, { w: 20 }))
    const m2 = edit(other, "s", (box) => ({ ...box, x: 7 }))

    const forwards = makeReplica("x")
    forwards.receive(create)
    forwards.receive(m1)
    forwards.receive(m2)

    const backwards = makeReplica("y")
    backwards.receive(create)
    backwards.receive(m2)
    backwards.receive(m1)

    expect(forwards.dump()).toBe(backwards.dump())
  })

  it("converges under every ordering, with duplicates, over a mixed message set", () => {
    // Build a set of messages from two peers that never hear each other.
    const a = makeReplica("a")
    const b = makeReplica("b")
    const seed = makeBox("seed")
    for (const replica of [a, b]) {
      replica.records.set(seed.id, seed) // present everywhere before anyone connects
    }
    const messages: StampedDiff<Box>[] = []
    messages.push(a.put(makeBox("s1", { x: 1 })))
    messages.push(edit(a, "s1", (box) => ({ ...box, x: 50 })))
    messages.push(b.put(makeBox("s1", { x: 2, props: { w: 3, h: 4, points: [9] } })))
    messages.push(edit(b, "s1", (box) => withProps(box, { w: 99 })))
    messages.push(a.remove(seed.id))
    messages.push(edit(b, "seed", (box) => ({ ...box, y: 7 })))
    messages.push(b.remove(boxId("s1")))

    const orderings: number[][] = [
      [0, 1, 2, 3, 4, 5, 6],
      [6, 5, 4, 3, 2, 1, 0],
      [3, 0, 5, 2, 6, 1, 4, 3, 5],
      [4, 4, 6, 2, 1, 0, 3, 5, 0],
      [5, 2, 3, 1, 6, 0, 4],
    ]
    const dumps = orderings.map((order, index) => {
      const replica = makeReplica(`r${index}`)
      replica.records.set(seed.id, seed)
      for (const i of order) replica.receive(messages[i]!)
      return replica.dump()
    })
    for (const dump of dumps) expect(dump).toBe(dumps[0])
  })
})

describe("deletes", () => {
  it("wins over an older edit whichever order they arrive in", () => {
    const author = makeReplica("a")
    const created = author.put(makeBox("s"))
    const edited = edit(author, "s", (box) => ({ ...box, x: 5 }))
    // A later delete, from a peer whose clock has seen the edit.
    const deleter = makeReplica("b")
    deleter.receive(created)
    deleter.receive(edited)
    const deleted = deleter.remove(boxId("s"))

    const forwards = makeReplica("x")
    forwards.receive(created)
    forwards.receive(edited)
    forwards.receive(deleted)

    const backwards = makeReplica("y")
    backwards.receive(created)
    backwards.receive(deleted)
    backwards.receive(edited) // arrives late; the tombstone holds it off

    expect(forwards.get("s")).toBeUndefined()
    expect(backwards.get("s")).toBeUndefined()
    expect(forwards.dump()).toBe(backwards.dump())
  })

  it("loses to a concurrent edit with a greater stamp, in both arrival orders", () => {
    const a = makeReplica("a")
    const z = makeReplica("z")
    const created = a.put(makeBox("s"))
    z.receive(created)

    // Concurrent: neither has seen the other. "z" already folded in the
    // creation, so its edit outranks the delete.
    const deleted = a.remove(boxId("s"))
    const edited = edit(z, "s", (box) => ({ ...box, x: 42 }))

    const forwards = makeReplica("x")
    forwards.receive(created)
    forwards.receive(deleted)
    forwards.receive(edited)

    const backwards = makeReplica("y")
    backwards.receive(created)
    backwards.receive(edited)
    backwards.receive(deleted)

    expect(forwards.get("s")?.x).toBe(42)
    expect(backwards.get("s")?.x).toBe(42)
    expect(forwards.dump()).toBe(backwards.dump())

    // And the two originals converge on the same answer once they swap.
    a.receive(edited)
    z.receive(deleted)
    expect(a.dump()).toBe(z.dump())
    expect(a.get("s")?.x).toBe(42)
  })

  it("keeps the record deleted when the delete is the greater stamp", () => {
    // Both peers learn of the record from a third, so their clocks are level
    // and the concurrent delete and edit tie on lamport: the client id decides.
    const maker = makeReplica("m")
    const created = maker.put(makeBox("s"))
    const a = makeReplica("a")
    const z = makeReplica("z")
    a.receive(created)
    z.receive(created)

    const edited = edit(a, "s", (box) => ({ ...box, x: 1 })) // (3, "a")
    const deleted = z.remove(boxId("s")) // (3, "z"): same lamport, greater client

    const peer = makeReplica("p")
    peer.receive(created)
    peer.receive(edited)
    peer.receive(deleted)
    expect(peer.get("s")).toBeUndefined()

    const reversed = makeReplica("q")
    reversed.receive(created)
    reversed.receive(deleted)
    reversed.receive(edited)
    expect(reversed.get("s")).toBeUndefined()
  })
})

describe("tombstones", () => {
  it("keeps a bounded number and lets an edit older than a collected one resurrect", () => {
    let time = 1000
    const replica = makeReplica("a", { tombstoneLimit: 2, now: () => time })
    const author = makeReplica("b")

    const created = author.put(makeBox("s"))
    replica.receive(created)
    const edited = edit(author, "s", (box) => ({ ...box, x: 3 }))

    // Three deletes of other records push the tombstone for "s" past the cap.
    replica.remove(boxId("s"))
    expect(replica.get("s")).toBeUndefined()
    for (const name of ["t1", "t2", "t3"]) {
      time += 1
      replica.put(makeBox(name))
      replica.remove(boxId(name))
    }

    // The tombstone for "s" was the oldest, so it went first: the late edit now
    // has nothing to lose against and brings the record back.
    replica.receive(edited)
    expect(replica.get("s")?.x).toBe(3)
  })

  it("keeps a tombstone that is inside both bounds", () => {
    const replica = makeReplica("a", { tombstoneLimit: 100, tombstoneMaxAgeMs: 100_000 })
    const author = makeReplica("b")
    replica.receive(author.put(makeBox("s")))
    const edited = edit(author, "s", (box) => ({ ...box, x: 3 }))
    replica.remove(boxId("s"))
    replica.receive(edited)
    expect(replica.get("s")).toBeUndefined()
  })
})

describe("snapshots", () => {
  it("lets a blank replica adopt a peer's stamps instead of racing them from zero", () => {
    const established = makeReplica("a")
    established.put(makeBox("s", { x: 1 }))
    const shared = established.snapshot()

    const joiner = makeReplica("z")
    // What the client does for a first snapshot: take the records, take the stamps.
    for (const record of shared.records) joiner.records.set(record.id, record)
    joiner.crdt.applyState(shared.state)

    // Now the joiner edits. Its clock started after the room's, so its write
    // wins over the established peer's older one rather than tying with it.
    const fromJoiner = edit(joiner, "s", (box) => ({ ...box, x: 2 }))
    established.receive(fromJoiner)
    expect(established.get("s")?.x).toBe(2)
    expect(joiner.dump()).toBe(established.dump())
  })

  it("merges a snapshot field by field when the receiver already has state", () => {
    const a = makeReplica("a")
    const b = makeReplica("b")
    b.receive(a.put(makeBox("s")))

    // Both edit while apart, then exchange snapshots in both directions.
    edit(a, "s", (box) => withProps(box, { w: 77 }))
    edit(b, "s", (box) => ({ ...box, y: 88 }))
    const fromA = a.snapshot()
    const fromB = b.snapshot()
    b.receive(stampedDiffFromSnapshot(fromA.records, fromA.state))
    a.receive(stampedDiffFromSnapshot(fromB.records, fromB.state))

    expect(a.get("s")).toMatchObject({ y: 88, props: { w: 77 } })
    expect(a.dump()).toBe(b.dump())
  })

  it("carries tombstones, so a snapshot does not resurrect a deleted record", () => {
    const a = makeReplica("a")
    const b = makeReplica("b")
    b.receive(a.put(makeBox("s")))
    a.remove(boxId("s"))
    const fromA = a.snapshot()
    b.receive(stampedDiffFromSnapshot(fromA.records, fromA.state))
    expect(b.get("s")).toBeUndefined()
  })
})
