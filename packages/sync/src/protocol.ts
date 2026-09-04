import type { UnknownRecord } from "@mocanvas/store"
import { isCrdtStateLike, isStampedDiffLike, type CrdtState, type StampedDiff } from "./crdt"

/**
 * Bumped when the wire format changes incompatibly.
 *
 * 2: `diff` carries a `StampedDiff` (per-field Lamport stamps) instead of a
 *    plain `RecordsDiff`, `snapshot` carries the CRDT state next to the
 *    records, and every message carries `version`.
 * 3: a put carries `base`, the stamp its whole record body is current as of,
 *    and a record kept alive by an edit that outranks a delete is re-claimed
 *    whole under a fresh stamp. A version 2 peer merges the same messages to a
 *    different answer, so the two must not share a room.
 */
export const PROTOCOL_VERSION = 3

/**
 * Every message is one JSON object with a `type` discriminator and a
 * `version`, which `encodeMessage` stamps on and `decodeMessage` checks.
 *
 * ```
 * hello        a client joined; existing peers answer with a snapshot
 * snapshot     the document-scope records plus the sender's CRDT stamps
 * diff         one squashed store diff, stamped field by field
 * presence     one presence record (cursor, camera, selection)
 * bye          the client is leaving; drop its presence
 * unsupported  synthesised locally for a peer on another protocol version
 * ```
 */
export type SyncMessage<R extends UnknownRecord = UnknownRecord> =
  | HelloMessage
  | SnapshotMessage<R>
  | DiffMessage<R>
  | PresenceMessage<R>
  | ByeMessage
  | UnsupportedMessage

export interface HelloMessage {
  type: "hello"
  clientId: string
  version: number
}

export interface SnapshotMessage<R extends UnknownRecord = UnknownRecord> {
  type: "snapshot"
  records: R[]
  /** The stamps that go with those records, so a joiner does not start blank. */
  state: CrdtState
}

export interface DiffMessage<R extends UnknownRecord = UnknownRecord> {
  type: "diff"
  clientId: string
  /** Per-client counter; only used for logging and de-duplication. */
  seq: number
  diff: StampedDiff<R>
}

export interface PresenceMessage<R extends UnknownRecord = UnknownRecord> {
  type: "presence"
  clientId: string
  record: R
}

export interface ByeMessage {
  type: "bye"
  clientId: string
}

/**
 * Never sent: `decodeMessage` returns this instead of guessing at a message
 * whose `version` is not ours, so a peer on another protocol is reported once
 * rather than half-parsed.
 */
export interface UnsupportedMessage {
  type: "unsupported"
  version: number
  clientId?: string
}

export function encodeMessage<R extends UnknownRecord>(message: SyncMessage<R>): string {
  return JSON.stringify({ ...message, version: PROTOCOL_VERSION })
}

/**
 * Parse a message off the wire. Returns `null` for anything malformed and an
 * `unsupported` message for a peer on another protocol version: neither can
 * crash this client, and neither is ever mistaken for a message we understand.
 */
export function decodeMessage<R extends UnknownRecord = UnknownRecord>(data: unknown): SyncMessage<R> | null {
  let value: unknown = data
  if (typeof data === "string") {
    try {
      value = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof value !== "object" || value === null) return null
  const message = value as Record<string, unknown>

  const version = message["version"]
  if (typeof version === "number" && version !== PROTOCOL_VERSION) {
    const clientId = message["clientId"]
    return typeof clientId === "string"
      ? { type: "unsupported", version, clientId }
      : { type: "unsupported", version }
  }

  switch (message["type"]) {
    case "hello":
      if (typeof message["clientId"] !== "string") return null
      if (typeof message["version"] !== "number") return null
      return { type: "hello", clientId: message["clientId"], version: message["version"] }
    case "snapshot": {
      const records = message["records"]
      if (!Array.isArray(records)) return null
      if (!records.every(isRecordLike)) return null
      const state = message["state"]
      if (!isCrdtStateLike(state)) return null
      return { type: "snapshot", records: records as R[], state: state as CrdtState }
    }
    case "diff": {
      if (typeof message["clientId"] !== "string") return null
      if (typeof message["seq"] !== "number") return null
      if (!isStampedDiffLike(message["diff"])) return null
      return {
        type: "diff",
        clientId: message["clientId"],
        seq: message["seq"],
        diff: message["diff"] as StampedDiff<R>,
      }
    }
    case "presence": {
      if (typeof message["clientId"] !== "string") return null
      if (!isRecordLike(message["record"])) return null
      return { type: "presence", clientId: message["clientId"], record: message["record"] as R }
    }
    case "bye":
      if (typeof message["clientId"] !== "string") return null
      return { type: "bye", clientId: message["clientId"] }
    default:
      return null
  }
}

function isRecordLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { typeName?: unknown }).typeName === "string"
  )
}
