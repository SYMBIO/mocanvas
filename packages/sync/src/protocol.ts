import type { RecordsDiff, UnknownRecord } from "@mocanvas/store"

/** Bumped when the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1

/**
 * Every message is one JSON object with a `type` discriminator.
 *
 * ```
 * hello     a client joined; existing peers answer with a snapshot
 * snapshot  the document-scope records as the sender currently sees them
 * diff      one squashed store diff, in document scope
 * presence  one presence record (cursor, camera, selection)
 * bye       the client is leaving; drop its presence
 * ```
 */
export type SyncMessage<R extends UnknownRecord = UnknownRecord> =
  | HelloMessage
  | SnapshotMessage<R>
  | DiffMessage<R>
  | PresenceMessage<R>
  | ByeMessage

export interface HelloMessage {
  type: "hello"
  clientId: string
  version: number
}

export interface SnapshotMessage<R extends UnknownRecord = UnknownRecord> {
  type: "snapshot"
  records: R[]
}

export interface DiffMessage<R extends UnknownRecord = UnknownRecord> {
  type: "diff"
  clientId: string
  /** Per-client counter; only used for logging and de-duplication. */
  seq: number
  diff: RecordsDiff<R>
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

export function encodeMessage<R extends UnknownRecord>(message: SyncMessage<R>): string {
  return JSON.stringify(message)
}

/**
 * Parse a message off the wire. Returns `null` for anything malformed: a peer
 * on a newer protocol must never be able to crash this one.
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
  switch (message["type"]) {
    case "hello":
      if (typeof message["clientId"] !== "string") return null
      if (typeof message["version"] !== "number") return null
      return { type: "hello", clientId: message["clientId"], version: message["version"] }
    case "snapshot": {
      const records = message["records"]
      if (!Array.isArray(records)) return null
      if (!records.every(isRecordLike)) return null
      return { type: "snapshot", records: records as R[] }
    }
    case "diff": {
      if (typeof message["clientId"] !== "string") return null
      if (typeof message["seq"] !== "number") return null
      if (!isDiffLike(message["diff"])) return null
      return {
        type: "diff",
        clientId: message["clientId"],
        seq: message["seq"],
        diff: message["diff"] as RecordsDiff<R>,
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

function isDiffLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const diff = value as Record<string, unknown>
  for (const key of ["added", "updated", "removed"]) {
    const part = diff[key]
    if (typeof part !== "object" || part === null || Array.isArray(part)) return false
  }
  return true
}
