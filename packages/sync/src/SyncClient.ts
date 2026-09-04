import { atom, type Signal } from "@mocanvas/state"
import { isRecordsDiffEmpty, uniqueId, type Store, type UnknownRecord } from "@mocanvas/store"
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
 * Document changes made locally by the user are broadcast as diffs; incoming
 * diffs are applied as remote changes so they neither echo back nor land in
 * the undo stack. Conflicts are resolved last-writer-wins per record.
 */
export function createSyncClient<R extends UnknownRecord = UnknownRecord>(
  options: SyncClientOptions<R>,
): SyncClient {
  const { store, roomId, transport } = options
  const clientId = options.clientId ?? uniqueId(12)
  const status = atom<SyncStatus>(`sync.status:${roomId}`, "offline")
  const room = new PresenceRoom<R>(store, options.presenceTimeoutMs ?? DEFAULT_PRESENCE_TIMEOUT_MS)

  const unsubscribes: (() => void)[] = []
  let presence: PresenceSync | null = null
  let seq = 0
  /** True between joining and either receiving a snapshot or serving one. */
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

  const handle = (message: SyncMessage<R>) => {
    if (disposed) return
    switch (message.type) {
      case "hello": {
        if (message.clientId === clientId) return
        if (message.version !== PROTOCOL_VERSION) {
          options.onError?.(
            new Error(`Peer ${message.clientId} speaks protocol ${message.version}, we speak ${PROTOCOL_VERSION}`),
          )
          return
        }
        // A newcomer needs the document; every established peer answers and the
        // newcomer keeps the first answer. Answering also makes us established,
        // so a snapshot meant for that newcomer cannot overwrite what we have.
        awaitingSnapshot = false
        send({ type: "snapshot", records: Object.values(store.serialize("document")) as R[] })
        // Re-announce our presence so the newcomer sees us immediately.
        presence?.poke()
        return
      }
      case "snapshot": {
        // Only a newcomer applies a snapshot; otherwise a late peer would
        // clobber work done since we joined.
        if (!awaitingSnapshot) return
        awaitingSnapshot = false
        store.mergeRemoteChanges(() => {
          store.put(message.records)
        })
        return
      }
      case "diff": {
        if (message.clientId === clientId) return
        if (isRecordsDiffEmpty(message.diff)) return
        store.mergeRemoteChanges(() => {
          store.applyDiff(message.diff)
        })
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
    presence?.poke()
  }

  const onClose = () => {
    if (disposed || !connected) return
    // The transport reconnects on its own; from here it is just "not online".
    status.set("connecting")
  }

  return {
    clientId,
    roomId,

    connect() {
      if (disposed || connected) return
      connected = true
      awaitingSnapshot = true
      status.set("connecting")

      unsubscribes.push(transport.onMessage(handle))
      if (transport.onOpen) unsubscribes.push(transport.onOpen(onOpen))
      if (transport.onClose) unsubscribes.push(transport.onClose(onClose))

      // Outgoing document changes: only what this user did, never what we
      // applied from a peer (those arrive with source "remote").
      unsubscribes.push(
        store.listen(
          (entry) => {
            if (isRecordsDiffEmpty(entry.changes)) return
            send({ type: "diff", clientId, seq: seq++, diff: entry.changes })
          },
          { source: "user", scope: "document" },
        ),
      )

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
      awaitingSnapshot = false
      status.set("offline")
    },

    getStatus() {
      return status
    },

    dispose() {
      if (disposed) return
      this.disconnect()
      disposed = true
      transport.close()
    },
  }
}
