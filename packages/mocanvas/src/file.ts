import type { TldrFile } from "@mocanvas/store"
import { normalizeLoadedRecords, type Editor } from "@mocanvas/editor"
import { parseTldrFile, serializeTldrFile, type ParseTldrFileResult } from "@mocanvas/store"

/** Serialize the editor's document to `.tldr` JSON text. */
/**
 * A parsed `.tldr` file: the schema it was written under, and its records.
 *
 * The documented name for what `serializeMocanvasFile` produces and
 * `loadMocanvasFile` accepts.
 */
export type TldrawFile = TldrFile

export function serializeMocanvasFile(editor: Editor): string {
  const snapshot = editor.store.getStoreSnapshot("document")
  return serializeTldrFile(snapshot.schema, Object.values(snapshot.store))
}

/**
 * The parse result plus whatever the load could not read cleanly.
 *
 * `warnings` is always present (empty when the file needed nothing unusual)
 * and is worth surfacing: it names shapes whose props were repaired, segments
 * that had to be dropped, and shape types with no registered util.
 */
export type LoadMocanvasFileResult = ParseTldrFileResult & { warnings: string[] }

/**
 * Load a `.tldr` file (text or parsed JSON) into the editor, replacing the
 * document.
 *
 * Records are normalized before they reach the store, so shapes written by
 * another generation of the format — a rich-text label, a packed freehand
 * path, a prop this build did not exist for — arrive in the form the shape
 * utils expect. `records` in the result are the normalized ones.
 */
export function loadMocanvasFile(editor: Editor, json: unknown): LoadMocanvasFileResult {
  const parsed = parseTldrFile(json)
  if (!parsed.ok) return { ...parsed, warnings: [] }
  const { records, warnings } = normalizeLoadedRecords(parsed.records, { shapeUtils: editor.shapeUtils })
  const store: Record<string, unknown> = {}
  for (const r of records) store[r.id] = r
  editor.run(
    () => {
      editor.store.loadStoreSnapshot({ schema: parsed.schema, store: store as never })
    },
    { history: "ignore" },
  )
  editor.history.clear()
  // The instance record may point at a page that no longer exists.
  const pages = editor.getPages()
  const current = editor.getCurrentPageId()
  if (pages.length && !pages.some((p) => p.id === current)) editor.setCurrentPage(pages[0]!.id)
  else editor.setCurrentPage(editor.getCurrentPageId())
  editor.zoomToFit()
  for (const warning of warnings) console.warn(`mocanvas: ${warning}`)
  return { ...parsed, records, warnings }
}

// ---------------------------------------------------------------------------
// The documented `.tldr` surface
// ---------------------------------------------------------------------------
// The same three operations as above under the names the file format is
// documented by, plus the error shape a parse failure reports. They are aliases
// rather than reimplementations: one parser, one serializer, two spellings.

/** The extension a saved document is written under, including the dot. */
export const TLDRAW_FILE_EXTENSION = ".tldr"

/**
 * Why a file could not be read.
 *
 * A discriminated union rather than an `Error` because every case calls for a
 * different response: a v1 file can be converted, a file from a newer build can
 * be reported by version, and invalid records can name what was wrong. Each
 * variant carries only what its own case needs.
 */
export type TldrawFileParseError =
  | { type: "notATldrawFile"; cause: unknown }
  | { type: "v1File"; data: unknown }
  | { type: "invalidRecords"; cause: unknown }
  | { type: "migrationFailed"; reason: string }
  | { type: "fileFormatVersionTooNew"; version: number }

/** Either the records a file held, or why it could not be read. */
export type ParseTldrawJsonFileResult =
  | { ok: true; value: { schema: TldrawFile["schema"]; records: TldrawFile["records"] } }
  | { ok: false; error: TldrawFileParseError }

/**
 * Parse `.tldr` JSON text without loading it into an editor.
 *
 * The step before {@link loadMocanvasFile} for anything that wants to inspect a
 * file first — a document picker showing a thumbnail, a migration script, a
 * server validating an upload. `schema` is accepted so a caller can say which
 * schema the records should be read against; it is not consulted for a file
 * that carries its own, which every file written since the format gained an
 * envelope does.
 */
export function parseTldrawJsonFile({ json, schema }: { json: string; schema?: unknown }): ParseTldrawJsonFileResult {
  void schema
  const parsed = parseTldrFile(json)
  if (parsed.ok) return { ok: true, value: { schema: parsed.schema, records: parsed.records } }
  switch (parsed.error) {
    case "v1File":
      return { ok: false, error: { type: "v1File", data: parsed.cause ?? null } }
    case "invalidRecords":
      return { ok: false, error: { type: "invalidRecords", cause: parsed.cause ?? null } }
    case "futureVersion":
      return { ok: false, error: { type: "fileFormatVersionTooNew", version: Number.NaN } }
    default:
      return { ok: false, error: { type: "notATldrawFile", cause: parsed.cause ?? null } }
  }
}

/**
 * The editor's document as `.tldr` JSON text.
 *
 * Asynchronous by contract even though nothing here awaits: an app that
 * resolves assets to data URLs before saving needs the same signature, and
 * changing a synchronous function to an asynchronous one later would break
 * every call site.
 */
export async function serializeTldrawJson(editor: Editor): Promise<string> {
  return serializeMocanvasFile(editor)
}

/** The same document as a `Blob`, ready to hand to a downloader or an upload. */
export async function serializeTldrawJsonBlob(editor: Editor): Promise<Blob> {
  return new Blob([await serializeTldrawJson(editor)], { type: "application/json" })
}
