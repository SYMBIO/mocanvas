import type { Editor } from "@mocanvas/editor"
import { parseTldrFile, serializeTldrFile, type ParseTldrFileResult } from "@mocanvas/store"

/** Serialize the editor's document to `.tldr` JSON text. */
export function serializeMocanvasFile(editor: Editor): string {
  const snapshot = editor.store.getStoreSnapshot("document")
  return serializeTldrFile(snapshot.schema, Object.values(snapshot.store))
}

/** Load a `.tldr` file (text or parsed JSON) into the editor, replacing the document. */
export function loadMocanvasFile(editor: Editor, json: unknown): ParseTldrFileResult {
  const parsed = parseTldrFile(json)
  if (!parsed.ok) return parsed
  const store: Record<string, unknown> = {}
  for (const r of parsed.records) store[r.id] = r
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
  return parsed
}
