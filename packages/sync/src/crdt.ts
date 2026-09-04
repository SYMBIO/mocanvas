import { createEmptyRecordsDiff, type IdOf, type RecordsDiff, type UnknownRecord } from "@mocanvas/store"

/**
 * A state-based CRDT over record fields.
 *
 * Every leaf field of every record is its own last-writer-wins register,
 * keyed by a dotted path (`x`, `props.w`, `meta.notes.title`). A write carries
 * a Lamport stamp; the greater stamp wins, and equal Lamport values are broken
 * by client id so that both sides of a race reach the same answer from the
 * same pair. Deletion is a stamped tombstone rather than a removal, so a late
 * message cannot resurrect a record that was deleted after it was written.
 *
 * Consequences worth knowing before reading the code:
 *
 * - Arrays are opaque. `props.points` is one register holding the whole array,
 *   not one register per element. Two concurrent edits to one array pick a
 *   winner instead of merging; splitting arrays into elements would need
 *   element identity, which record data does not carry.
 * - A stamp covers a whole subtree. Writing `meta` (setting it, or deleting
 *   the key) dominates `meta.a`: the claim loses to any stamp at or above its
 *   own path, and dropping a subtree keeps descendants stamped later than the
 *   write. Without that, `delete meta` racing `set meta.a` lands differently
 *   depending on arrival order.
 * - A record also has one `base` register: the stamp at which some sender's
 *   whole record body was current. Fields nobody holds a stamp for — a record
 *   materialized without its creation message, or one that came back from
 *   under a tombstone, which erases field stamps — are governed by that single
 *   register, so every replica takes its body from the same message instead of
 *   from whichever one happened to arrive first.
 * - Merging is idempotent (the same message twice is a no-op the second time)
 *   and commutative (per path the result is the maximum stamp, which does not
 *   depend on arrival order).
 * - The merge is a pure function of the stamps; values only ever ride along.
 */

/** Version of the `CrdtState` blob on the wire. */
export const CRDT_STATE_VERSION = 1

/** How many collected-and-gone records keep a tombstone before it is dropped. */
export const DEFAULT_TOMBSTONE_LIMIT = 5000
/** How long a tombstone for a vanished record is kept. */
export const DEFAULT_TOMBSTONE_MAX_AGE_MS = 60 * 60 * 1000

/* -------------------------------------------------------------------------- */
/* stamps                                                                     */
/* -------------------------------------------------------------------------- */

/** A point in the partial order of writes, made total by the client tiebreak. */
export interface Stamp {
  readonly lamport: number
  readonly client: string
}

/**
 * A total order on stamps: Lamport first, then client id. Two peers holding
 * the same pair always agree, which is what makes the merge deterministic.
 */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport < b.lamport ? -1 : 1
  if (a.client === b.client) return 0
  return a.client < b.client ? -1 : 1
}

export function isStamp(value: unknown): value is Stamp {
  if (typeof value !== "object" || value === null) return false
  const stamp = value as { lamport?: unknown; client?: unknown }
  return typeof stamp.lamport === "number" && Number.isFinite(stamp.lamport) && typeof stamp.client === "string"
}

export interface LamportClock {
  /** The current value. */
  get(): number
  /** Advance for a local write and return the new value. */
  tick(): number
  /** Fold in a stamp seen from a peer: `max(local, remote) + 1`. */
  observe(remote: number): void
}

export function createLamportClock(start = 0): LamportClock {
  let value = start
  return {
    get: () => value,
    tick: () => (value += 1),
    observe(remote: number) {
      if (!Number.isFinite(remote)) return
      value = Math.max(value, remote) + 1
    },
  }
}

/* -------------------------------------------------------------------------- */
/* wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One record's changed fields. `record` is the whole record as the sender saw
 * it after the change; `fields` says which paths this message actually claims.
 * A receiver that already has the record takes only the winning paths out of
 * `record`; a receiver that does not have it materializes from `record` whole.
 */
export interface StampedPut<R extends UnknownRecord = UnknownRecord> {
  record: R
  fields: Record<string, Stamp>
  /**
   * The stamp at which `record` was the sender's whole view of that record.
   * Paths the receiver holds no stamp for are taken from `record` when this is
   * the greatest such stamp it has seen, and left alone otherwise.
   */
  base?: Stamp
}

export interface StampedRemove {
  id: string
  stamp: Stamp
}

/** What a `diff` message carries: puts and removes, each field stamped. */
export interface StampedDiff<R extends UnknownRecord = UnknownRecord> {
  puts: StampedPut<R>[]
  removes: StampedRemove[]
}

export function createEmptyStampedDiff<R extends UnknownRecord = UnknownRecord>(): StampedDiff<R> {
  return { puts: [], removes: [] }
}

export function isStampedDiffEmpty<R extends UnknownRecord>(diff: StampedDiff<R>): boolean {
  return diff.puts.length === 0 && diff.removes.length === 0
}

/** Structural check used by `decodeMessage`; deliberately shallow but strict. */
export function isStampedDiffLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const diff = value as { puts?: unknown; removes?: unknown }
  if (!Array.isArray(diff.puts) || !Array.isArray(diff.removes)) return false
  for (const put of diff.puts) {
    if (typeof put !== "object" || put === null) return false
    const { record, fields, base } = put as { record?: unknown; fields?: unknown; base?: unknown }
    if (typeof record !== "object" || record === null) return false
    if (typeof (record as { id?: unknown }).id !== "string") return false
    if (typeof (record as { typeName?: unknown }).typeName !== "string") return false
    if (!isStampMap(fields)) return false
    if (base !== undefined && !isStamp(base)) return false
  }
  for (const remove of diff.removes) {
    if (typeof remove !== "object" || remove === null) return false
    const { id, stamp } = remove as { id?: unknown; stamp?: unknown }
    if (typeof id !== "string" || !isStamp(stamp)) return false
  }
  return true
}

/** What one record's registers look like once serialized. */
export interface CrdtRecordState {
  fields: Record<string, Stamp>
  /** The stamp of the message this record's unstamped fields came from. */
  base?: Stamp
  deleted?: Stamp
  /** Local wall clock at the time the tombstone was taken, for collection. */
  deletedAt?: number
}

/** The whole replica's stamps, as carried by a `snapshot` message. */
export interface CrdtState {
  version: number
  clock: number
  records: Record<string, CrdtRecordState>
}

export function createEmptyCrdtState(): CrdtState {
  return { version: CRDT_STATE_VERSION, clock: 0, records: {} }
}

export function isCrdtStateLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const state = value as { version?: unknown; clock?: unknown; records?: unknown }
  if (typeof state.version !== "number") return false
  if (typeof state.clock !== "number") return false
  if (typeof state.records !== "object" || state.records === null || Array.isArray(state.records)) return false
  for (const key of Object.keys(state.records as Record<string, unknown>)) {
    const record = (state.records as Record<string, unknown>)[key]
    if (typeof record !== "object" || record === null) return false
    const { fields, deleted, base } = record as { fields?: unknown; deleted?: unknown; base?: unknown }
    if (!isStampMap(fields)) return false
    if (deleted !== undefined && !isStamp(deleted)) return false
    if (base !== undefined && !isStamp(base)) return false
  }
  return true
}

function isStampMap(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!isStamp((value as Record<string, unknown>)[key])) return false
  }
  return true
}

/* -------------------------------------------------------------------------- */
/* the CRDT                                                                   */
/* -------------------------------------------------------------------------- */

export interface CrdtOptions<R extends UnknownRecord = UnknownRecord> {
  /** Identifies this replica; also the tiebreak in `compareStamps`. */
  clientId: string
  /**
   * Read the replica's current value for a record. The CRDT owns the stamps,
   * never the values: the store stays the source of truth and a merge is
   * expressed as a diff against whatever `getRecord` reports.
   */
  getRecord?: ((id: string) => R | undefined) | undefined
  /** Tombstones kept for records that are gone. Default 5000. */
  tombstoneLimit?: number | undefined
  /** How long such a tombstone lives. Default one hour. */
  tombstoneMaxAgeMs?: number | undefined
  /** Injectable wall clock, for tests. */
  now?: (() => number) | undefined
}

export interface Crdt<R extends UnknownRecord = UnknownRecord> {
  readonly clientId: string
  readonly clock: LamportClock
  /**
   * Stamp a diff the local user just made and return the message to send.
   * The whole diff shares one stamp: it was one operation.
   */
  stampLocal(diff: RecordsDiff<R>): StampedDiff<R>
  /**
   * Merge a peer's message. The returned diff holds only the fields that won,
   * as whole records the store can apply — never a blind overwrite.
   */
  mergeRemote(stamped: StampedDiff<R>): RecordsDiff<R>
  /** This replica's stamps, for a `snapshot` message. */
  getState(): CrdtState
  /**
   * Adopt a peer's stamps wholesale. This is what a replica that is joining
   * with no state of its own does, together with that peer's records: it takes
   * the peer's stamps instead of starting blank, so its own later writes sort
   * after everything already in the room. The returned diff removes whatever
   * the peer has tombstoned and we still hold. Only for a replica holding no
   * stamps at all: the caller adopts the peer's records wholesale alongside it,
   * so a replica with work of its own must merge the snapshot through
   * `stampedDiffFromSnapshot` instead of taking it.
   */
  applyState(state: CrdtState): RecordsDiff<R>
  /**
   * Writes this replica minted while merging, which the caller must broadcast.
   * A record kept alive by an edit that outranks a delete is re-claimed whole
   * under a fresh stamp: the tombstone leaves the fields it dominates with no
   * provenance at all, and only a stamped body can put every replica on the
   * same one. Empty when there is nothing to send.
   */
  takeOutgoing(): StampedDiff<R> | null
  /** Number of records the state currently tracks (tests and diagnostics). */
  size(): number
  /** Drop tombstones past the count or age bound. Called after every merge. */
  collectTombstones(): void
}

interface RecordState {
  fields: Map<string, Stamp>
  /** The stamp of the message this record's unstamped fields came from. */
  base?: Stamp | undefined
  deleted?: Stamp | undefined
  deletedAt?: number | undefined
}

/** The greater of two stamps, either of which may be missing. */
function maxStamp(a: Stamp | undefined, b: Stamp | undefined): Stamp | undefined {
  if (!a) return b
  if (!b) return a
  return compareStamps(a, b) >= 0 ? a : b
}

/** The greatest stamp a put claims, which is what its body is current as of. */
function greatestStamp(fields: Record<string, Stamp>): Stamp | undefined {
  let best: Stamp | undefined
  for (const path of Object.keys(fields)) best = maxStamp(best, fields[path])
  return best
}

/** Every proper ancestor of a dotted path, outermost first. */
function ancestorPaths(path: string): string[] {
  const out: string[] = []
  let index = path.indexOf(".")
  while (index !== -1) {
    out.push(path.slice(0, index))
    index = path.indexOf(".", index + 1)
  }
  return out
}

/**
 * Take `path` for `stamp`, unless something at or above it is stamped at least
 * as late — a write to `meta` covers `meta.a`, so the two cannot be compared
 * as if they were unrelated registers. Descendants the write covers are
 * dropped; descendants stamped later than it survive and are returned, because
 * their values have to be put back on top of whatever the write does.
 */
function claimPath(state: RecordState, path: string, stamp: Stamp): string[] | null {
  const own = state.fields.get(path)
  if (own && compareStamps(stamp, own) <= 0) return null
  for (const ancestor of ancestorPaths(path)) {
    const above = state.fields.get(ancestor)
    if (above && compareStamps(stamp, above) <= 0) return null
  }
  const survivors: string[] = []
  const prefix = `${path}.`
  for (const [other, existing] of Array.from(state.fields)) {
    if (!other.startsWith(prefix)) continue
    if (compareStamps(existing, stamp) <= 0) state.fields.delete(other)
    else survivors.push(other)
  }
  state.fields.set(path, stamp)
  return survivors
}

/** True when this path, or one above it, carries a stamp of its own. */
function isStamped(state: RecordState, path: string): boolean {
  if (state.fields.has(path)) return true
  for (const ancestor of ancestorPaths(path)) {
    if (state.fields.has(ancestor)) return true
  }
  return false
}

/**
 * The highest ancestor of `path` that the body has nothing at and no stamp
 * covers — the level a "this is not here any more" has to be applied at.
 */
function highestAbsent(body: unknown, state: RecordState, path: string): string {
  for (const ancestor of ancestorPaths(path)) {
    if (readPath(body, ancestor) !== ABSENT) continue
    if (isStamped(state, ancestor) || hasStampedDescendant(state, ancestor)) continue
    return ancestor
  }
  return path
}

/** True when something strictly below this path carries a stamp. */
function hasStampedDescendant(state: RecordState, path: string): boolean {
  const prefix = `${path}.`
  for (const other of state.fields.keys()) {
    if (other.startsWith(prefix)) return true
  }
  return false
}

export function createCrdt<R extends UnknownRecord = UnknownRecord>(options: CrdtOptions<R>): Crdt<R> {
  const { clientId } = options
  const getRecord = options.getRecord ?? (() => undefined)
  const tombstoneLimit = options.tombstoneLimit ?? DEFAULT_TOMBSTONE_LIMIT
  const tombstoneMaxAgeMs = options.tombstoneMaxAgeMs ?? DEFAULT_TOMBSTONE_MAX_AGE_MS
  const now = options.now ?? (() => Date.now())
  const clock = createLamportClock()
  const states = new Map<string, RecordState>()
  let outgoing = createEmptyStampedDiff<R>()

  const stateFor = (id: string): RecordState => {
    let state = states.get(id)
    if (!state) {
      state = { fields: new Map() }
      states.set(id, state)
    }
    return state
  }

  /**
   * A merge in progress: `before` remembers what the store had when we first
   * looked at a record, `after` what it should end up with. Keeping both lets
   * one message both remove and re-create a record without contradicting
   * itself in the diff we hand back.
   */
  interface Pass {
    before: Map<string, R | undefined>
    after: Map<string, R | undefined>
  }

  const startPass = (): Pass => ({ before: new Map(), after: new Map() })

  const readBefore = (pass: Pass, id: string): R | undefined => {
    if (!pass.before.has(id)) pass.before.set(id, getRecord(id))
    return pass.before.get(id)
  }

  const readCurrent = (pass: Pass, id: string): R | undefined =>
    pass.after.has(id) ? pass.after.get(id) : readBefore(pass, id)

  const write = (pass: Pass, id: string, value: R | undefined): void => {
    readBefore(pass, id)
    pass.after.set(id, value)
  }

  const finishPass = (pass: Pass): RecordsDiff<R> => {
    const result = createEmptyRecordsDiff<R>()
    for (const [id, next] of pass.after) {
      const prev = pass.before.get(id)
      if (prev === next) continue
      const key = id as IdOf<R>
      if (prev === undefined) {
        if (next !== undefined) result.added[key] = next
      } else if (next === undefined) {
        result.removed[key] = prev
      } else {
        result.updated[key] = [prev, next]
      }
    }
    return result
  }

  /** Record a tombstone. Fields it dominates are dropped; survivors keep the record alive. */
  const applyRemove = (pass: Pass, id: string, stamp: Stamp): void => {
    const state = stateFor(id)
    if (state.deleted && compareStamps(stamp, state.deleted) <= 0) return
    state.deleted = stamp
    state.deletedAt = now()
    // The body older messages carry dies with the fields: only a message that
    // outranks the tombstone may supply one from here on.
    state.base = maxStamp(state.base, stamp)
    let alive = false
    for (const [path, existing] of Array.from(state.fields)) {
      if (compareStamps(existing, stamp) > 0) alive = true
      else state.fields.delete(path)
    }
    // A concurrent edit newer than the delete keeps the record: the delete only
    // wins when its stamp is greater than every field that would survive it.
    if (!alive) {
      if (readCurrent(pass, id) !== undefined) write(pass, id, undefined)
      return
    }
    // It survives — but the tombstone has just taken the provenance of every
    // field it outranks, and each replica is holding a different leftover for
    // those. Re-claim this body whole under a fresh stamp and send it, so the
    // record comes back as one agreed record rather than as a race.
    const record = readCurrent(pass, id)
    if (!record) return
    const revival: Stamp = { lamport: clock.tick(), client: clientId }
    const fields: Record<string, Stamp> = {}
    for (const path of leafPaths(record)) {
      fields[path] = revival
      claimPath(state, path, revival)
    }
    state.base = revival
    outgoing.puts.push({ record, fields, base: revival })
  }

  /**
   * Take every path neither the record nor the sender holds a stamp for from
   * the sender's body. Those are the fields the registers say nothing about,
   * and `base` is the one register that decides them.
   */
  const adoptBody = (record: R, body: R, state: RecordState): R => {
    const paths = new Set<string>([...leafPaths(body), ...leafPaths(record)])
    let next = record
    for (const path of Array.from(paths).sort()) {
      if (path === "id" || path === "typeName") continue
      if (isStamped(state, path) || hasStampedDescendant(state, path)) continue
      const value = readPath(body, path)
      // Take the whole subtree the body does not have, not just the leaf, so
      // dropping the last key of an object does not leave an empty one behind.
      next = writePath(next, value === ABSENT ? highestAbsent(body, state, path) : path, value)
    }
    return next
  }

  const applyPut = (pass: Pass, put: StampedPut<R>): void => {
    const id = put.record.id as string
    const state = stateFor(id)
    const claims: { path: string; survivors: string[] }[] = []
    for (const path of Object.keys(put.fields)) {
      const stamp = put.fields[path]
      if (!stamp) continue
      // A write older than the tombstone cannot resurrect the record.
      if (state.deleted && compareStamps(stamp, state.deleted) <= 0) continue
      // `<= 0` and not `< 0` inside: the same message twice changes nothing.
      const survivors = claimPath(state, path, stamp)
      if (survivors === null) continue
      claims.push({ path, survivors })
    }
    const base = put.base ?? greatestStamp(put.fields)
    const bodyWins = base !== undefined && (state.base === undefined || compareStamps(base, state.base) > 0)
    if (claims.length === 0 && !bodyWins) return

    const current = readCurrent(pass, id)
    if (current === undefined) {
      // Nothing here to merge into. A body alone must never bring a record
      // back: without a claim that outranks the tombstone this is a straggler.
      if (claims.length === 0) return
      write(pass, id, put.record)
      state.base = maxStamp(state.base, base)
      return
    }

    let next = current
    for (const { path, survivors } of claims) {
      if (path === "id") continue // identity is never merged
      const before = next
      next = writePath(next, path, readPath(put.record, path))
      // A subtree stamped later than this write outlives it, so put those
      // values back: `delete meta` racing `set meta.a` must land the same way
      // whichever arrives first.
      for (const survivor of survivors) next = writePath(next, survivor, readPath(before, survivor))
    }
    if (bodyWins) {
      next = adoptBody(next, put.record, state)
      state.base = base
    }
    if (next !== current) write(pass, id, next)
  }

  const observeStamps = (stamped: StampedDiff<R>): void => {
    let max = -1
    for (const put of stamped.puts) {
      for (const path of Object.keys(put.fields)) {
        const stamp = put.fields[path]
        if (stamp && stamp.lamport > max) max = stamp.lamport
      }
      if (put.base && put.base.lamport > max) max = put.base.lamport
    }
    for (const remove of stamped.removes) {
      if (remove.stamp.lamport > max) max = remove.stamp.lamport
    }
    if (max >= 0) clock.observe(max)
  }

  const collectTombstones = (): void => {
    const gone: { id: string; at: number }[] = []
    for (const [id, state] of states) {
      if (state.deleted && state.fields.size === 0) gone.push({ id, at: state.deletedAt ?? 0 })
    }
    if (gone.length === 0) return
    const cutoff = now() - tombstoneMaxAgeMs
    let overflow = gone.length - tombstoneLimit
    if (overflow <= 0 && gone.every((entry) => entry.at >= cutoff)) return
    gone.sort((a, b) => a.at - b.at)
    for (const entry of gone) {
      if (overflow > 0) {
        states.delete(entry.id)
        overflow--
        continue
      }
      if (entry.at < cutoff) states.delete(entry.id)
    }
  }

  return {
    clientId,
    clock,

    stampLocal(diff: RecordsDiff<R>): StampedDiff<R> {
      const stamp: Stamp = { lamport: clock.tick(), client: clientId }
      const result = createEmptyStampedDiff<R>()

      for (const id in diff.added) {
        const record = diff.added[id as IdOf<R>]
        if (!record) continue
        const fields: Record<string, Stamp> = {}
        const state = stateFor(id)
        for (const path of leafPaths(record)) {
          fields[path] = stamp
          claimPath(state, path, stamp)
        }
        // Our record is our whole view of it, as of now.
        state.base = stamp
        result.puts.push({ record, fields, base: stamp })
      }

      for (const id in diff.updated) {
        const pair = diff.updated[id as IdOf<R>]
        if (!pair) continue
        const [from, to] = pair
        const paths = changedPaths(from, to)
        if (paths.length === 0) continue
        const fields: Record<string, Stamp> = {}
        const state = stateFor(id)
        for (const path of paths) {
          fields[path] = stamp
          claimPath(state, path, stamp)
        }
        state.base = stamp
        result.puts.push({ record: to, fields, base: stamp })
      }

      for (const id in diff.removed) {
        const state = stateFor(id)
        state.deleted = stamp
        state.deletedAt = now()
        state.fields.clear()
        state.base = stamp
        result.removes.push({ id, stamp })
      }

      collectTombstones()
      return result
    },

    mergeRemote(stamped: StampedDiff<R>): RecordsDiff<R> {
      observeStamps(stamped)
      const pass = startPass()
      for (const remove of stamped.removes) applyRemove(pass, remove.id, remove.stamp)
      for (const put of stamped.puts) applyPut(pass, put)
      collectTombstones()
      return finishPass(pass)
    },

    getState(): CrdtState {
      const records: Record<string, CrdtRecordState> = {}
      for (const [id, state] of states) {
        const fields: Record<string, Stamp> = {}
        for (const [path, stamp] of state.fields) fields[path] = stamp
        records[id] = {
          fields,
          ...(state.base ? { base: state.base } : {}),
          ...(state.deleted ? { deleted: state.deleted, deletedAt: state.deletedAt ?? 0 } : {}),
        }
      }
      return { version: CRDT_STATE_VERSION, clock: clock.get(), records }
    },

    applyState(state: CrdtState): RecordsDiff<R> {
      const pass = startPass()
      if (state.version !== CRDT_STATE_VERSION) return finishPass(pass)
      clock.observe(state.clock)
      for (const id of Object.keys(state.records)) {
        const incoming = state.records[id]
        if (!incoming) continue
        if (incoming.deleted) applyRemove(pass, id, incoming.deleted)
        const local = stateFor(id)
        for (const path of Object.keys(incoming.fields)) {
          const stamp = incoming.fields[path]
          if (!stamp) continue
          clock.observe(stamp.lamport)
          if (local.deleted && compareStamps(stamp, local.deleted) <= 0) continue
          claimPath(local, path, stamp)
        }
        if (incoming.base) {
          clock.observe(incoming.base.lamport)
          local.base = maxStamp(local.base, incoming.base)
        }
      }
      collectTombstones()
      return finishPass(pass)
    },

    takeOutgoing(): StampedDiff<R> | null {
      if (isStampedDiffEmpty(outgoing)) return null
      const result = outgoing
      outgoing = createEmptyStampedDiff<R>()
      return result
    },

    size: () => states.size,
    collectTombstones,
  }
}

/**
 * Turn a peer's snapshot into a message the ordinary merge can eat: its
 * records supply the values, its state supplies the stamps. Paths the state
 * says nothing about are not claimed, so a snapshot can never overwrite a
 * field the receiver has a stamp for.
 */
export function stampedDiffFromSnapshot<R extends UnknownRecord>(
  records: readonly R[],
  state: CrdtState,
): StampedDiff<R> {
  const result = createEmptyStampedDiff<R>()
  for (const record of records) {
    const entry = state.records[record.id as string]
    const fields = entry?.fields ?? {}
    const base = entry?.base ?? greatestStamp(fields)
    result.puts.push(base ? { record, fields, base } : { record, fields })
  }
  for (const id of Object.keys(state.records)) {
    const deleted = state.records[id]?.deleted
    if (deleted) result.removes.push({ id, stamp: deleted })
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* field paths                                                                */
/* -------------------------------------------------------------------------- */

/** A path that is not present at all, as distinct from one holding `undefined`. */
const ABSENT = Symbol("absent")

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/**
 * Every leaf path of a value. Plain objects are recursed into; arrays,
 * primitives, `null` and empty objects are leaves — an array is one register
 * holding the whole array.
 */
export function leafPaths(value: unknown, prefix = ""): string[] {
  const out: string[] = []
  collectLeaves(value, prefix, out)
  return out
}

function collectLeaves(value: unknown, prefix: string, out: string[]): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length > 0) {
      for (const key of keys) collectLeaves(value[key], prefix ? `${prefix}.${key}` : key, out)
      return
    }
  }
  if (prefix !== "") out.push(prefix)
}

/** The paths whose values differ between two versions of a record. */
export function changedPaths(from: unknown, to: unknown): string[] {
  const out: string[] = []
  collectChanges(from, to, "", out)
  return out
}

function collectChanges(from: unknown, to: unknown, prefix: string, out: string[]): void {
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from)) {
      const path = prefix ? `${prefix}.${key}` : key
      // A key that disappeared: stamp the whole subtree as one removal.
      if (!(key in to)) out.push(path)
      else collectChanges(from[key], to[key], path, out)
    }
    for (const key of Object.keys(to)) {
      if (key in from) continue
      collectLeaves(to[key], prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  if (!deepEqual(from, to) && prefix !== "") out.push(prefix)
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split(".")) {
    if (!isPlainObject(current) || !(segment in current)) return ABSENT
    current = current[segment]
  }
  return current
}

/**
 * A copy of `record` with `path` set to `value` (or the key deleted when the
 * path is absent in the source). Every level along the path is cloned, because
 * the store freezes records, their `props` and their `meta`.
 */
function writePath<R extends UnknownRecord>(record: R, path: string, value: unknown): R {
  const current = readPath(record, path)
  if (value === ABSENT) {
    if (current === ABSENT) return record
  } else if (current !== ABSENT && deepEqual(current, value)) {
    return record
  }
  const segments = path.split(".")
  return setIn(record as unknown as Record<string, unknown>, segments, 0, value) as unknown as R
}

function setIn(
  target: Record<string, unknown>,
  segments: string[],
  index: number,
  value: unknown,
): Record<string, unknown> {
  const key = segments[index]
  if (key === undefined) return target
  const next: Record<string, unknown> = { ...target }
  if (index === segments.length - 1) {
    if (value === ABSENT) delete next[key]
    else next[key] = value
    return next
  }
  const child = next[key]
  next[key] = setIn(isPlainObject(child) ? child : {}, segments, index + 1, value)
  return next
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!(key in b)) return false
      if (!deepEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}
