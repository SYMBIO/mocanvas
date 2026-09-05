import type { Editor, ShapeId } from "@mocanvas/editor"
import { copyBlobToClipboard, downloadBlob, exportToBlob, type ExportFormat } from "../export"

/**
 * Cut, copy, paste and "copy as" for the menus.
 *
 * The keyboard shortcuts do the same work from their own handler; this is the
 * same behaviour reached from a menu, where there is no `ClipboardEvent` to
 * hang off. Both go through the async Clipboard API and both fall back to an
 * in-page buffer, so copy/paste still works in a browser that has not granted
 * clipboard permission — within the one tab, which is where it matters most.
 */

/** The MIME-ish tag mocanvas content is written under. */
export const MOCANVAS_CLIPBOARD_TYPE = "application/mocanvas"

/** Set when the real clipboard is unavailable, so paste still works in-page. */
let fallbackBuffer = ""

/** Serialize the given shapes (default: the selection) as clipboard text. */
export function getClipboardTextForShapes(editor: Editor, ids: readonly ShapeId[] = editor.getSelectedShapeIds()): string | null {
  if (ids.length === 0) return null
  const content = editor.getContentFromCurrentPage(ids)
  if (!content) return null
  return JSON.stringify({ type: MOCANVAS_CLIPBOARD_TYPE, ...content })
}

/** Copy the selection. Resolves once the write has been attempted. */
export async function copySelectionToClipboard(editor: Editor, ids: readonly ShapeId[] = editor.getSelectedShapeIds()): Promise<boolean> {
  const text = getClipboardTextForShapes(editor, ids)
  if (!text) return false
  fallbackBuffer = text
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // Permission denied, or no clipboard at all. The fallback buffer stands in.
  }
  return true
}

/** Copy the selection, then delete it. */
export async function cutSelectionToClipboard(editor: Editor, ids: readonly ShapeId[] = editor.getSelectedShapeIds()): Promise<boolean> {
  const copied = await copySelectionToClipboard(editor, ids)
  if (!copied) return false
  editor.markHistoryStoppingPoint("cut")
  editor.deleteShapes([...ids])
  return true
}

/** Put whatever mocanvas content is on the clipboard onto the current page. */
export async function pasteFromClipboard(editor: Editor, point = editor.getViewportPageCenter()): Promise<boolean> {
  let text = ""
  try {
    text = (await navigator.clipboard?.readText()) ?? ""
  } catch {
    text = ""
  }
  if (!text) text = fallbackBuffer
  if (!text) return false
  try {
    const data = JSON.parse(text) as { type?: string; shapes?: unknown[] }
    if (data.type !== MOCANVAS_CLIPBOARD_TYPE || !Array.isArray(data.shapes)) return false
    editor.markHistoryStoppingPoint("paste")
    editor.putContentOntoCurrentPage(data as never, { point })
    return true
  } catch {
    return false
  }
}

export interface CopyAsOptions {
  /** Page units of padding around the shapes. */
  padding?: number
  /** Paint the theme's background behind the shapes. */
  background?: boolean
  scale?: number
  darkMode?: boolean
}

export interface ExportAsOptions extends CopyAsOptions {
  /** Filename, without extension. Defaults to the current page's name. */
  name?: string
  quality?: number
  pixelRatio?: number
}

/**
 * Put a rendered copy of the shapes on the system clipboard.
 *
 * `"json"` writes mocanvas's own content format, which is what paste reads;
 * the image formats write a blob, which is what another application reads.
 */
export async function copyAs(
  editor: Editor,
  format: ExportFormat | "json" = "svg",
  ids: readonly ShapeId[] = editor.getSelectedShapeIds(),
  opts: CopyAsOptions = {},
): Promise<void> {
  if (format === "json") {
    await copySelectionToClipboard(editor, ids)
    return
  }
  const blob = await exportToBlob(editor, { ...opts, format, ids: [...ids] })
  await copyBlobToClipboard(blob)
}

/** Render the shapes and hand the file to the browser's downloader. */
export async function exportAs(
  editor: Editor,
  format: ExportFormat = "png",
  ids: readonly ShapeId[] = editor.getSelectedShapeIds(),
  opts: ExportAsOptions = {},
): Promise<void> {
  const { name, ...rest } = opts
  const blob = await exportToBlob(editor, { ...rest, format, ids: [...ids] })
  const page = editor.getCurrentPage()
  downloadBlob(blob, `${name ?? page?.name ?? "drawing"}.${format}`)
}

/**
 * Print the current page.
 *
 * Delegates to the browser's own print dialog rather than rendering a print
 * sheet: the page's stylesheet is what decides how the editor prints, and an
 * app that cares will have written one.
 */
export function printSelection(editor: Editor): void {
  editor.getContainerWindow()?.print()
}
