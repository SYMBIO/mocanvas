import { describe, expect, it } from "vitest"
import { createEmptyRecordsDiff, type RecordId, type RecordsDiff } from "@mocanvas/store"
import { createCrdt, stampedDiffFromSnapshot, type Crdt, type CrdtState, type StampedDiff } from "./crdt"

/* -------------------------------------------------------------------------- */
/* a seeded PRNG, so a failing schedule replays from its seed alone           */
/* -------------------------------------------------------------------------- */

function makeRandom(seed: number): {
  int(n: number): number
  pick<T>(xs: readonly T[]): T
  chance(p: number): boolean
} {
  let state = (seed >>> 0) || 1
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    int: (n) => Math.floor(next() * n),
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
    chance: (p) => next() < p,
  }
}

/* -------------------------------------------------------------------------- */
/* the record under test: primitives, an array, and two levels of objects     */
/* -------------------------------------------------------------------------- */

interface Doc {
  readonly id: RecordId<Doc>
  readonly typeName: "doc"
  x: number
  y: number
  props: Record<string, unknown>
  meta: Record<string, unknown>
}

const docId = (name: string) => `doc:${name}` as RecordId<Doc>

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

/* -------------------------------------------------------------------------- */
/* replicas over a network the test drives by hand                            */
/* -------------------------------------------------------------------------- */

type Wire = { kind: "diff"; from: string; body: string } | { kind: "snapshot"; from: string; body: string }

interface Peer {
  id: string
  crdt: Crdt<Doc>
  records: Map<string, Doc>
  inbox: Wire[]
  online: boolean
  /** True until it has adopted the room's state, exactly like `SyncClient`. */
  awaitingSnapshot: boolean
}

function makePeer(id: string, awaitingSnapshot: boolean): Peer {
  const records = new Map<string, Doc>()
  const crdt = createCrdt<Doc>({ clientId: id, getRecord: (rid) => records.get(rid) })
  return { id, crdt, records, inbox: [], online: true, awaitingSnapshot }
}

function applyToRecords(peer: Peer, diff: RecordsDiff<Doc>): void {
  for (const id in diff.added) peer.records.set(id, diff.added[id as RecordId<Doc>]!)
  for (const id in diff.updated) peer.records.set(id, diff.updated[id as RecordId<Doc>]![1])
  for (const id in diff.removed) peer.records.delete(id)
}

function isEmpty(diff: RecordsDiff<Doc>): boolean {
  return (
    Object.keys(diff.added).length === 0 &&
    Object.keys(diff.updated).length === 0 &&
    Object.keys(diff.removed).length === 0
  )
}

function documentOf(peer: Peer): string {
  const ids = [...peer.records.keys()].sort()
  return canonical(ids.map((id) => peer.records.get(id)))
}

/** Every message crosses a JSON wire, like the real transports. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

class Network {
  readonly peers: Peer[] = []
  /** Anything that broke an invariant mid-run: idempotence, mostly. */
  readonly problems: string[] = []
  readonly rng: ReturnType<typeof makeRandom>

  constructor(seed: number) {
    this.rng = makeRandom(seed)
  }

  add(id: string, awaitingSnapshot = false): Peer {
    const peer = makePeer(id, awaitingSnapshot)
    this.peers.push(peer)
    return peer
  }

  broadcast(from: Peer, message: Wire): void {
    if (!from.online) return
    for (const peer of this.peers) {
      if (peer === from || !peer.online) continue
      peer.inbox.push(message)
    }
  }

  sendDiff(from: Peer, diff: StampedDiff<Doc>): void {
    if (diff.puts.length === 0 && diff.removes.length === 0) return
    this.broadcast(from, { kind: "diff", from: from.id, body: JSON.stringify(diff) })
  }

  snapshotOf(peer: Peer): Wire {
    return {
      kind: "snapshot",
      from: peer.id,
      body: JSON.stringify({ records: [...peer.records.values()], state: peer.crdt.getState() }),
    }
  }

  /** Deliver one message. `again` re-delivers it instead of consuming it. */
  deliverOne(peer: Peer, index: number, again: boolean): void {
    const message = peer.inbox[index]
    if (!message) return
    if (!again) peer.inbox.splice(index, 1)
    this.receive(peer, message)
  }

  receive(peer: Peer, message: Wire): void {
    if (message.kind === "diff") {
      const stamped = wire(JSON.parse(message.body) as StampedDiff<Doc>)
      applyToRecords(peer, peer.crdt.mergeRemote(stamped))
      this.flushOutgoing(peer)
      // Idempotence, checked on every merge the fuzzer performs.
      const twice = peer.crdt.mergeRemote(wire(JSON.parse(message.body) as StampedDiff<Doc>))
      const extra = peer.crdt.takeOutgoing()
      if (!isEmpty(twice) || extra) {
        this.problems.push(`merge was not idempotent at ${peer.id}: ${JSON.stringify(twice)}`)
        applyToRecords(peer, twice)
      }
      return
    }
    const snapshot = JSON.parse(message.body) as { records: Doc[]; state: CrdtState }
    // Wholesale adoption is only safe for a replica that holds nothing of its
    // own, exactly as in `SyncClient`.
    if (peer.awaitingSnapshot && peer.crdt.size() === 0) {
      peer.awaitingSnapshot = false
      const removals = peer.crdt.applyState(wire(snapshot.state))
      for (const record of wire(snapshot.records)) peer.records.set(record.id, record)
      applyToRecords(peer, removals)
      this.flushOutgoing(peer)
      return
    }
    const diff = peer.crdt.mergeRemote(stampedDiffFromSnapshot(wire(snapshot.records), wire(snapshot.state)))
    applyToRecords(peer, diff)
    this.flushOutgoing(peer)
  }

  /** Writes the CRDT minted while merging go out like any other local diff. */
  private flushOutgoing(peer: Peer): void {
    const out = peer.crdt.takeOutgoing()
    if (out) this.sendDiff(peer, out)
  }

  /** A local change: apply it to the replica, then broadcast the stamped diff. */
  local(peer: Peer, mutate: (records: Map<string, Doc>) => RecordsDiff<Doc>): void {
    const diff = mutate(peer.records)
    if (isEmpty(diff)) return
    applyToRecords(peer, diff)
    this.sendDiff(peer, peer.crdt.stampLocal(diff))
  }

  /** Reconnect: snapshots both ways, as `SyncClient` does on open. */
  reconnect(peer: Peer): void {
    peer.online = true
    this.broadcast(peer, this.snapshotOf(peer))
    for (const other of this.peers) {
      if (other === peer || !other.online) continue
      peer.inbox.push(this.snapshotOf(other))
    }
  }

  private drain(): void {
    let guard = 0
    while (this.peers.some((p) => p.inbox.length > 0)) {
      if (guard++ > 50000) throw new Error("delivery did not terminate")
      for (const peer of this.peers) {
        while (peer.inbox.length > 0) this.deliverOne(peer, 0, false)
      }
    }
  }

  /** Deliver everything, then exchange snapshots all round until nothing moves. */
  quiesce(): void {
    for (const peer of this.peers) {
      peer.online = true
      peer.awaitingSnapshot = false
    }
    let before = this.documents().join(" ")
    for (let round = 0; round < 12; round++) {
      this.drain()
      for (const from of this.peers) this.broadcast(from, this.snapshotOf(from))
      this.drain()
      const after = this.documents().join(" ")
      if (after === before) break
      before = after
    }
  }

  documents(): string[] {
    return this.peers.map(documentOf)
  }
}

/* -------------------------------------------------------------------------- */
/* the operations the fuzzer can schedule                                     */
/* -------------------------------------------------------------------------- */

const NAMES = ["a", "b", "c"]
const META_KEYS = ["one", "two"]
const PROP_KEYS = ["w", "h"]

function diffFor(records: Map<string, Doc>, next: Doc): RecordsDiff<Doc> {
  const diff = createEmptyRecordsDiff<Doc>()
  const before = records.get(next.id)
  if (before) diff.updated[next.id] = [before, next]
  else diff.added[next.id] = next
  return diff
}

function removeDiff(records: Map<string, Doc>, id: string): RecordsDiff<Doc> {
  const diff = createEmptyRecordsDiff<Doc>()
  const before = records.get(id)
  if (before) diff.removed[id as RecordId<Doc>] = before
  return diff
}

function step(net: Network, peer: Peer): void {
  const r = net.rng
  const id = docId(r.pick(NAMES))
  const existing = peer.records.get(id)

  switch (r.int(14)) {
    case 0: {
      // create, or re-create a record that was deleted
      if (existing) return
      net.local(peer, (records) =>
        diffFor(records, {
          id,
          typeName: "doc",
          x: r.int(5),
          y: r.int(5),
          props: { w: r.int(9), h: r.int(9), points: [r.int(3)], style: { color: "red" } },
          meta: r.chance(0.5) ? {} : { one: r.int(3) },
        }),
      )
      return
    }
    case 1:
    case 2: {
      if (!existing) return
      const key = r.chance(0.5) ? "x" : "y"
      net.local(peer, (records) => diffFor(records, { ...existing, [key]: r.int(20) }))
      return
    }
    case 3:
    case 4: {
      if (!existing) return
      const key = r.pick(PROP_KEYS)
      net.local(peer, (records) =>
        diffFor(records, { ...existing, props: { ...existing.props, [key]: r.int(50) } }),
      )
      return
    }
    case 5: {
      if (!existing) return
      // the opaque array register
      net.local(peer, (records) =>
        diffFor(records, {
          ...existing,
          props: { ...existing.props, points: Array.from({ length: r.int(3) }, () => r.int(9)) },
        }),
      )
      return
    }
    case 6: {
      if (!existing) return
      // a key inside a nested object
      const style = existing.props["style"]
      const base = typeof style === "object" && style !== null ? (style as Record<string, unknown>) : {}
      net.local(peer, (records) =>
        diffFor(records, {
          ...existing,
          props: { ...existing.props, style: { ...base, color: r.pick(["red", "blue", "green"]) } },
        }),
      )
      return
    }
    case 7: {
      if (!existing) return
      // replace a nested object with a leaf: a type change under a live path
      net.local(peer, (records) => diffFor(records, { ...existing, props: { ...existing.props, style: r.int(4) } }))
      return
    }
    case 8: {
      if (!existing) return
      const key = r.pick(META_KEYS)
      const value: unknown = r.chance(0.4) ? { nested: r.int(5) } : r.int(9)
      net.local(peer, (records) => diffFor(records, { ...existing, meta: { ...existing.meta, [key]: value } }))
      return
    }
    case 9: {
      if (!existing) return
      // remove a meta key, which may itself hold an object
      const key = r.pick(META_KEYS)
      if (!(key in existing.meta)) return
      const meta = { ...existing.meta }
      delete meta[key]
      net.local(peer, (records) => diffFor(records, { ...existing, meta }))
      return
    }
    case 10: {
      if (!existing) return
      net.local(peer, (records) => removeDiff(records, id))
      return
    }
    case 11:
    case 12: {
      if (peer.inbox.length === 0) return
      const index = r.int(peer.inbox.length)
      if (r.chance(0.15)) return net.deliverOne(peer, index, true) // a duplicate
      if (r.chance(0.1)) {
        peer.inbox.splice(index, 1) // a drop
        return
      }
      net.deliverOne(peer, index, false)
      return
    }
    case 13: {
      if (peer.online && r.chance(0.5)) {
        peer.online = false
        return
      }
      if (!peer.online) net.reconnect(peer)
      return
    }
  }
}

interface ScheduleResult {
  seed: number
  docs: string[]
  problems: string[]
}

function runSchedule(seed: number, steps = 300, peerCount = 3): ScheduleResult {
  const net = new Network(seed)
  for (let i = 0; i < peerCount; i++) net.add(String.fromCharCode(97 + i))
  const r = net.rng
  for (let i = 0; i < steps; i++) {
    // a fresh replica joining part-way through, snapshot and all
    if (i === Math.floor(steps / 2)) {
      const joiner = net.add("z", true)
      const source = net.peers.find((p) => p !== joiner && p.online)
      if (source) joiner.inbox.push(net.snapshotOf(source))
    }
    step(net, r.pick(net.peers))
  }
  net.quiesce()
  return { seed, docs: net.documents(), problems: net.problems }
}

function describeFailure(result: ScheduleResult): string {
  return [
    `seed ${result.seed} diverged`,
    ...result.problems,
    ...result.docs.map((d, i) => `  [${i}] ${d}`),
  ].join("\n")
}

function failuresIn(seeds: readonly number[]): ScheduleResult[] {
  const failures: ScheduleResult[] = []
  for (const seed of seeds) {
    const result = runSchedule(seed)
    if (result.problems.length > 0 || result.docs.some((d) => d !== result.docs[0])) failures.push(result)
  }
  return failures
}

/* -------------------------------------------------------------------------- */

/**
 * Seeds 1-200 are a standing sweep. The rest are schedules that caught a
 * specific defect and are kept so it cannot come back:
 *
 * - 278, 554: a record body nobody holds a stamp for, settled by `base`.
 * - 2517: an object left empty by taking a body that had dropped its last key.
 *
 * Several thousand further seeds were run while writing this; they are not
 * checked in because they cost seconds rather than milliseconds.
 */
const SEEDS = [...Array.from({ length: 200 }, (_, i) => i + 1), 278, 554, 2517]

describe("fuzz: random schedules over a network the test controls", () => {
  it("converges to byte-identical documents on every seed", () => {
    const failures = failuresIn(SEEDS)
    if (failures.length > 0) throw new Error(`${failures.length} seeds failed\n${describeFailure(failures[0]!)}`)
    expect(failures).toEqual([])
  })
})
