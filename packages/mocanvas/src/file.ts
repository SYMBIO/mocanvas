import { normalizeLoadedRecords, type Editor } from "@mocanvas/editor"
import { parseTldrFile, serializeTldrFile, type ParseTldrFileResult } from "@mocanvas/store"

/** Serialize the editor's document to `.tldr` JSON text. */
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
