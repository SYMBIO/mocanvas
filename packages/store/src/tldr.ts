import { isRecordLike, type IdOf, type UnknownRecord } from "./ids"
import type { SerializedSchema, SerializedStore } from "./migrate"

/**
 * `.tldr` file envelope. Schema-agnostic: this module does not know or care
 * what record types the file holds.
 */
export const TLDR_FILE_FORMAT_VERSION = 1

export interface TldrFile {
  tldrawFileFormatVersion: number
  schema: SerializedSchema
  records: UnknownRecord[]
}

export type TldrFileParseError = "notATldrFile" | "v1File" | "invalidRecords" | "futureVersion"

export type ParseTldrFileResult =
  | { ok: true; schema: SerializedSchema; records: UnknownRecord[] }
  | { ok: false; error: TldrFileParseError; cause?: unknown }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSerializedSchema(value: unknown): value is SerializedSchema {
  return isPlainObject(value) && typeof value["schemaVersion"] === "number"
}

/**
 * Parse a `.tldr` file. Accepts either the JSON text or the already-parsed
 * value. Never throws.
 */
export function parseTldrFile(json: unknown): ParseTldrFileResult {
  let data: unknown = json
  if (typeof json === "string") {
    try {
      data = JSON.parse(json)
    } catch (cause) {
      return { ok: false, error: "notATldrFile", cause }
    }
  }

  if (!isPlainObject(data)) return { ok: false, error: "notATldrFile" }

  if (!("tldrawFileFormatVersion" in data)) {
    // The legacy (pre-envelope) format stored a whole document object.
    const legacyDocument = data["document"]
    if (isPlainObject(legacyDocument) && ("pages" in legacyDocument || "version" in legacyDocument)) {
      return { ok: false, error: "v1File" }
    }
    return { ok: false, error: "notATldrFile" }
  }

  const version = data["tldrawFileFormatVersion"]
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "notATldrFile" }
  }
  if (version > TLDR_FILE_FORMAT_VERSION) return { ok: false, error: "futureVersion" }

  if (!isSerializedSchema(data["schema"])) return { ok: false, error: "notATldrFile" }

  const records = data["records"]
  if (!Array.isArray(records)) return { ok: false, error: "invalidRecords" }
  const seen = new Set<string>()
  for (const record of records) {
    if (!isRecordLike(record)) return { ok: false, error: "invalidRecords" }
    if (seen.has(record.id)) return { ok: false, error: "invalidRecords" }
    seen.add(record.id)
  }

  return { ok: true, schema: data["schema"], records: records as UnknownRecord[] }
}

/**
 * JSON.stringify with object keys sorted recursively so that identical data
 * always produces identical text. Arrays keep their order.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = value[key]
      if (v !== undefined) out[key] = sortKeysDeep(v)
    }
    return out
  }
  return value
}

/**
 * Serialize records and their schema into the `.tldr` envelope
 * (pretty-printed, stable key order). Records are written in the given order.
 */
export function serializeTldrFile(schema: SerializedSchema, records: readonly UnknownRecord[]): string {
  const envelope = {
    tldrawFileFormatVersion: TLDR_FILE_FORMAT_VERSION,
    schema: sortKeysDeep(schema),
    records: records.map(sortKeysDeep),
  }
  return JSON.stringify(envelope, null, 2)
}

/** Convert a parsed file into a `{ store, schema }` snapshot. */
export function tldrFileToStoreSnapshot(file: { schema: SerializedSchema; records: readonly UnknownRecord[] }): {
  store: SerializedStore<UnknownRecord>
  schema: SerializedSchema
} {
  const store = {} as SerializedStore<UnknownRecord>
  for (const record of file.records) store[record.id as IdOf<UnknownRecord>] = record
  return { store, schema: file.schema }
}

/** Convert a `{ store, schema }` snapshot into `.tldr` text. Records are ordered by id. */
export function storeSnapshotToTldrFile(snapshot: {
  store: SerializedStore<UnknownRecord>
  schema: SerializedSchema
}): string {
  const records = Object.values(snapshot.store).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return serializeTldrFile(snapshot.schema, records)
}
