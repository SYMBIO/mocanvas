import type { Editor, ShapeId } from "@mocanvas/editor"
import { copyBlobToClipboard, downloadBlob, exportToBlob, getSvgString, type ExportFormat } from "../export"

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

/** Whether there is anything on the current page to print. */
export function canPrint(editor: Editor): boolean {
  return editor.getCurrentPageShapeIds().size > 0
}

/**
 * Print the drawing: the selection if there is one, otherwise the page.
 *
 * Not `window.print()`. The editor is a component on somebody's page, and the
 * host window's print view is that whole page — headers, navigation, the
 * article the canvas is embedded in, and a canvas element that a print
 * stylesheet cannot usefully lay out. What the user asked to print is the
 * drawing, so the drawing is what is rendered: the same SVG the exporter
 * produces, alone in a hidden same-origin frame that is printed and then
 * thrown away.
 *
 * Returns `false` when there was nothing to print or no DOM to print it in;
 * the menu item disables itself on the same condition, so this is the
 * belt-and-braces case rather than the normal one.
 */
export function printSelection(editor: Editor, ids?: readonly ShapeId[]): boolean {
  const doc = editor.getContainerDocument()
  if (!doc?.body) return false

  const rendered = getSvgString(editor, ids, {
    background: editor.getInstanceState().exportBackground,
    darkMode: false,
  })
  if (!rendered) return false

  const title = editor.getCurrentPage()?.name ?? "Drawing"
  const frame = doc.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.setAttribute("title", `Print ${title}`)
  // Off-screen rather than `display: none`: a frame with no layout box does
  // not paint, and a frame that does not paint prints blank.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0"

  const cleanUp = () => frame.remove()
  frame.addEventListener("load", () => {
    const view = frame.contentWindow
    if (!view) {
      cleanUp()
      return
    }
    view.addEventListener("afterprint", cleanUp, { once: true })
    // Chrome fires `afterprint`; some browsers do not fire it at all, so the
    // frame is also swept up on a timer. Removing it twice is harmless.
    view.setTimeout(cleanUp, 60_000)
    view.focus()
    view.print()
  })

  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html,body{margin:0;padding:0;background:#fff}
svg{display:block;width:100%;height:auto;max-width:100%}
@page{margin:12mm}
</style></head><body>${rendered.svg}</body></html>`
  doc.body.appendChild(frame)
  return true
}

/** Minimal escaping for the one interpolated value in the print document. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"))
}
