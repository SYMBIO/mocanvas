import { atom, type Signal } from "@mocanvas/state"
import {
  createEmptyRecordsDiff,
  isRecordsDiffEmpty,
  uniqueId,
  type IdOf,
  type RecordsDiff,
  type Store,
  type UnknownRecord,
} from "@mocanvas/store"
import { createCrdt, deepEqual, isStampedDiffEmpty, stampedDiffFromSnapshot, type Crdt, type StampedDiff } from "./crdt"
import {
  createPresenceSync,
  DEFAULT_PRESENCE_TIMEOUT_MS,
  PresenceRoom,
  type PresenceEditor,
  type PresenceSync,
} from "./presence"
import { PROTOCOL_VERSION, type SyncMessage } from "./protocol"
import type { Transport } from "./transport"

export type SyncStatus = "offline" | "connecting" | "online"

export interface SyncClientOptions<R extends UnknownRecord = UnknownRecord> {
  store: Store<R, any>
  /** Identifies the document. The transport is expected to be scoped to it too. */
  roomId: string
  transport: Transport<R>
  /** Turn on cursor/selection sharing for an editor. */
  presence?: { editor: PresenceEditor } | undefined
  /** Defaults to a fresh random id; one per tab, not per user. */
  clientId?: string | undefined
  /** Drop a collaborator after this long without a presence message. Default 10s. */
  presenceTimeoutMs?: number | undefined
  /** Upper bound on presence send rate. Default 34ms (~30 Hz). */
  presenceThrottleMs?: number | undefined
  presenceHeartbeatMs?: number | undefined
  /** How many tombstones for vanished records to keep. See `crdt.ts`. */
  tombstoneLimit?: number | undefined
  /** How long such a tombstone lives, in ms. */
  tombstoneMaxAgeMs?: number | undefined
  /** Called for protocol-level problems (a peer on another version, say). */
  onError?: ((error: Error) => void) | undefined
}

export interface SyncClient {
  readonly clientId: string
  readonly roomId: string
  connect(): void
  disconnect(): void
  /** A signal, so React and reactors can follow the connection. */
  getStatus(): Signal<SyncStatus>
  dispose(): void
}

/**
 * Joins one room over `transport` and keeps `store` in step with its peers.
 *
 * Document changes made locally by the user are stamped by the CRDT (see
 * `crdt.ts`) and broadcast; incoming messages are merged field by field and
 * only the fields that won are applied, as remote changes, so they neither
 * echo back nor land in the undo stack. Concurrent edits to different fields
 * of one record all survive, and replicas converge whatever order messages
 * arrive in.
 */
export function createSyncClient<R extends UnknownRecord = UnknownRecord>(
  options: SyncClientOptions<R>,
): SyncClient {
  const { store, roomId, transport } = options
  const clientId = options.clientId ?? uniqueId(12)
  const status = atom<SyncStatus>(`sync.status:${roomId}`, "offline")
  const room = new PresenceRoom<R>(store, options.presenceTimeoutMs ?? DEFAULT_PRESENCE_TIMEOUT_MS)

  const crdt: Crdt<R> = createCrdt<R>({
    clientId,
    getRecord: (id) => store.unsafeGetWithoutCapture(id as IdOf<R>) as R | undefined,
    ...(options.tombstoneLimit !== undefined ? { tombstoneLimit: options.tombstoneLimit } : {}),
    ...(options.tombstoneMaxAgeMs !== undefined ? { tombstoneMaxAgeMs: options.tombstoneMaxAgeMs } : {}),
  })

  const unsubscribes: (() => void)[] = []
  const reportedVersions = new Set<number>()
  let presence: PresenceSync | null = null
  let seq = 0
  /**
   * True while this replica is waiting to be handed the room, which only a
   * replica holding no stamps at all ever is: one that has just loaded the
   * page has nothing to lose by taking a peer's document whole, and nothing
   * worth pushing at anyone either. A replica with stamps — including one that
   * edited while it was disconnected — merges instead.
   */
  let awaitingSnapshot = false
  let connected = false
  let disposed = false

  const send = (message: SyncMessage<R>) => {
    try {
      transport.send(message)
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const broadcast = (stamped: StampedDiff<R>) => {
    if (isStampedDiffEmpty(stamped)) return
    send({ type: "diff", clientId, seq: seq++, diff: stamped })
  }

  /**
   * Writes the CRDT minted while merging — a record revived by an edit that
   * outranks a delete — go out like any other local diff.
   */
  const flushCrdt = () => {
    const outgoing = crdt.takeOutgoing()
    if (outgoing) broadcast(outgoing)
  }

  const sendSnapshot = () => {
    send({
      type: "snapshot",
      records: Object.values(store.serialize("document")) as R[],
      state: crdt.getState(),
    })
  }

  const applyRemote = (diff: RecordsDiff<R>) => {
    if (isRecordsDiffEmpty(diff)) return
    const actual = store.extractingChanges(() => {
      store.mergeRemoteChanges(() => {
        store.applyDiff(diff)
      })
    })
    reportRewrites(diff, actual)
  }

  /**
   * What the store actually did, minus what we asked it to do. A validator or
   * a side effect that rewrites a merged record — or touches another one —
   * changes this replica only: the change is reported as `remote`, so the
   * listener below never sees it, and no peer would ever hear about it. Stamp
   * that difference as a local write and send it, so the rewrite is one more
   * write everyone can agree on rather than a private divergence.
   *
   * A side effect that is a function of the record and the document rewrites
   * the same way everywhere, so this settles in one round: the peers apply a
   * value they already hold and produce nothing further. A side effect that is
   * not a function of its inputs cannot converge, here or anywhere.
   */
  const reportRewrites = (asked: RecordsDiff<R>, actual: RecordsDiff<R>) => {
    const rewrite = createEmptyRecordsDiff<R>()
    const intended = (id: IdOf<R>): R | undefined => asked.added[id] ?? asked.updated[id]?.[1]
    const isDocument = (record: R) => store.getScope(record.typeName) === "document"

    for (const key in actual.added) {
      const id = key as IdOf<R>
      const after = actual.added[id]
      if (!after || !isDocument(after)) continue
      const want = intended(id)
      if (!want) rewrite.added[id] = after
      else if (!deepEqual(want, after)) rewrite.updated[id] = [want, after]
    }
    for (const key in actual.updated) {
      const id = key as IdOf<R>
      const pair = actual.updated[id]
      if (!pair || !isDocument(pair[1])) continue
      const want = intended(id)
      if (!want) rewrite.updated[id] = pair
      else if (!deepEqual(want, pair[1])) rewrite.updated[id] = [want, pair[1]]
    }
    for (const key in actual.removed) {
      const id = key as IdOf<R>
      const before = actual.removed[id]
      if (!before || !isDocument(before)) continue
      if (!asked.removed[id]) rewrite.removed[id] = before
    }
    if (isRecordsDiffEmpty(rewrite)) return
    broadcast(crdt.stampLocal(rewrite))
  }

  /**
   * Outgoing document changes: only what this user did, never what we applied
   * from a peer (those arrive with source "remote"). It is wired up when the
   * client is built and stays wired until `dispose`, so an edit made before
   * `connect()` or after `disconnect()` is stamped when it happens rather than
   * when the socket is up. That is what carries offline work through a
   * reconnect: unstamped, it would lose to every stamped write in the room.
   */
  const stopListening = store.listen(
    (entry) => {
      if (isRecordsDiffEmpty(entry.changes)) return
      const stamped = crdt.stampLocal(entry.changes)
      if (connected) broadcast(stamped)
    },
    { source: "user", scope: "document" },
  )

  const handle = (message: SyncMessage<R>) => {
    if (disposed) return
    switch (message.type) {
      case "unsupported": {
        if (reportedVersions.has(message.version)) return
        reportedVersions.add(message.version)
        options.onError?.(
          new Error(`A peer speaks protocol ${message.version}, we speak ${PROTOCOL_VERSION}`),
        )
        return
      }
      case "hello": {
        if (message.clientId === clientId) return
        if (message.version !== PROTOCOL_VERSION) {
          options.onError?.(
            new Error(`Peer ${message.clientId} speaks protocol ${message.version}, we speak ${PROTOCOL_VERSION}`),
          )
          return
        }
        // A newcomer needs the document; every established peer answers with
        // its records and its stamps. Answering also makes us established: we
        // hold state of our own now, so nobody's snapshot can start us blank.
        awaitingSnapshot = false
        sendSnapshot()
        // Re-announce our presence so the newcomer sees us immediately.
        presence?.poke()
        return
      }
      case "snapshot": {
        // Wholesale adoption is only safe with nothing of our own to lose:
        // one stamp means one edit that would be overwritten by the sender's
        // body, so `crdt.size()` and not just the flag decides.
        if (awaitingSnapshot && crdt.size() === 0) {
          // We have no stamps at all. Take the sender's records and its clock
          // wholesale, so our own later writes sort after everything already
          // in the room instead of racing it from zero.
          awaitingSnapshot = false
          const removals = crdt.applyState(message.state)
          const actual = store.extractingChanges(() => {
            store.mergeRemoteChanges(() => {
              store.put(message.records)
              store.applyDiff(removals)
            })
          })
          const asked = createEmptyRecordsDiff<R>()
          for (const record of message.records) asked.added[record.id as IdOf<R>] = record
          reportRewrites(asked, actual)
          flushCrdt()
          return
        }
        // Otherwise this is a reconciliation (a peer reconnected, or answered
        // someone else's hello), or we hold edits of our own: merge it field
        // by field. Nothing we hold a newer stamp for can be overwritten, so
        // it is always safe to apply.
        awaitingSnapshot = false
        applyRemote(crdt.mergeRemote(stampedDiffFromSnapshot(message.records, message.state)))
        flushCrdt()
        return
      }
      case "diff": {
        if (message.clientId === clientId) return
        if (isStampedDiffEmpty(message.diff)) return
        applyRemote(crdt.mergeRemote(message.diff))
        flushCrdt()
        return
      }
      case "presence": {
        if (message.clientId === clientId) return
        room.receive(message.clientId, message.record)
        return
      }
      case "bye": {
        if (message.clientId === clientId) return
        room.remove(message.clientId)
        return
      }
    }
  }

  const onOpen = () => {
    if (disposed || !connected) return
    status.set("online")
    send({ type: "hello", clientId, version: PROTOCOL_VERSION })
    // On a reconnect we already hold stamps, possibly for work done while the
    // transport was down. Push them: the peers merge field by field, so
    // neither side of the split loses anything.
    if (!awaitingSnapshot) sendSnapshot()
    presence?.poke()
  }

  const onClose = () => {
    if (disposed || !connected) return
    // The transport reconnects on its own; from here it is just "not online".
    // Local edits keep flowing into the CRDT and go out on the next open.
    status.set("connecting")
  }

  return {
    clientId,
    roomId,

    connect() {
      if (disposed || connected) return
      connected = true
      // Only a replica holding no stamps at all is a newcomer. One that edited
      // before it ever connected, or while it was disconnected, has work of
      // its own and merges the room's snapshot instead of taking it whole.
      awaitingSnapshot = crdt.size() === 0
      status.set("connecting")

      unsubscribes.push(transport.onMessage(handle))
      if (transport.onOpen) unsubscribes.push(transport.onOpen(onOpen))
      if (transport.onClose) unsubscribes.push(transport.onClose(onClose))

      if (options.presence) {
        presence = createPresenceSync({
          editor: options.presence.editor,
          clientId,
          send: (record) => send({ type: "presence", clientId, record: record as unknown as R }),
          ...(options.presenceThrottleMs !== undefined ? { throttleMs: options.presenceThrottleMs } : {}),
          ...(options.presenceHeartbeatMs !== undefined ? { heartbeatMs: options.presenceHeartbeatMs } : {}),
        })
        presence.start()
      }
      room.startSweeping()

      if (!transport.onOpen) onOpen()
    },

    disconnect() {
      if (!connected) return
      connected = false
      send({ type: "bye", clientId })
      presence?.stop()
      presence = null
      room.stopSweeping()
      room.clear()
      for (const off of unsubscribes.splice(0)) off()
      status.set("offline")
    },

    getStatus() {
      return status
    },

    dispose() {
      if (disposed) return
      this.disconnect()
      disposed = true
      stopListening()
      transport.close()
    },
  }
}
