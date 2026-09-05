/**
 * Clipboard and export, as the menus and the keyboard reach them.
 *
 * There are two ways a copy can happen and they arrive differently. A *native*
 * copy comes with a `ClipboardEvent`, which is the only moment a browser lets a
 * page write several flavours of the same content synchronously. A *menu* copy
 * has no event at all and has to go through the async Clipboard API. These
 * hooks hide that split: a menu item calls `copy()` and does not care which
 * path it took.
 *
 * Everything here is a hook because the work needs the editor, the toasts and
 * the translator, all of which are React contexts — which is also why the plain
 * functions in `ui-clipboard.ts` take an editor and say nothing to the user.
 */

import { useCallback, useEffect } from "react"
import { Vec, useEditor, type Editor, type ShapeId } from "@mocanvas/editor"
import type { ExportFormat } from "../export"
import { copyAs, cutSelectionToClipboard, copySelectionToClipboard, getClipboardTextForShapes, pasteFromClipboard, exportAs, type CopyAsOptions, type ExportAsOptions } from "./ui-clipboard"
import { useToasts } from "./ui-toasts"
import { useTranslation } from "./ui-translation"

/** The formats "copy as" can write. `"json"` is mocanvas's own content format. */
export type TLCopyType = "svg" | "png" | "jpeg" | "json"

/** The MIME type mocanvas's own clipboard content is written under. */
const MOCANVAS_HTML_MARKER = "data-mocanvas"

/**
 * Write the current selection to the clipboard, from either a native copy event
 * or a menu item.
 *
 * With an event, the content is written synchronously in every flavour at once:
 * the HTML flavour carries mocanvas's own serialized content inside a marker
 * element (so a paste back into the canvas is lossless), and the plain-text
 * flavour carries the text of the copied shapes (so a paste into anything else
 * is readable). Without an event, only the async path is available and only the
 * text flavour is written.
 *
 * Returns whether anything was copied — an empty selection is not a failure,
 * but the caller usually wants to skip the "copied" toast.
 */
export async function handleNativeOrMenuCopy(editor: Editor, event?: ClipboardEvent, ids: readonly ShapeId[] = editor.getSelectedShapeIds()): Promise<boolean> {
  const serialized = getClipboardTextForShapes(editor, ids)
  if (!serialized) return false

  const plainText = ids
    .map((id) => {
      const shape = editor.getShape(id)
      return shape ? (editor.getShapeUtil(shape).getText?.(shape) ?? "") : ""
    })
    .filter(Boolean)
    .join("\n")

  if (event?.clipboardData) {
    // A `ClipboardEvent` is the one place several flavours can be written at
    // once, and only synchronously — awaiting anything here loses the window.
    event.preventDefault()
    event.clipboardData.setData("text/html", `<div ${MOCANVAS_HTML_MARKER}>${escapeForHtmlComment(serialized)}</div>`)
    event.clipboardData.setData("text/plain", plainText || serialized)
    return true
  }

  return await copySelectionToClipboard(editor, ids)
}

function escapeForHtmlComment(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** What both clipboard hooks hand back. */
export interface TLUiClipboardEvents {
  copy: () => Promise<void>
  cut: () => Promise<void>
  paste: (data?: DataTransfer | ClipboardItem[], point?: { x: number; y: number }) => Promise<void>
}

/**
 * Cut, copy and paste for the menus and the action list.
 *
 * The three functions do the same work the keyboard shortcuts do; what differs
 * is that there is no event to hang off, so paste has to ask the browser for
 * the clipboard and may be refused. A refusal falls back to an in-page buffer,
 * which keeps copy and paste working within one tab even where the permission
 * was denied — which is where it matters most.
 */
export function useMenuClipboardEvents(): TLUiClipboardEvents {
  const editor = useEditor()

  const copy = useCallback(async () => {
    await handleNativeOrMenuCopy(editor)
  }, [editor])

  const cut = useCallback(async () => {
    await cutSelectionToClipboard(editor)
  }, [editor])

  const paste = useCallback(
    async (_data?: DataTransfer | ClipboardItem[], point?: { x: number; y: number }) => {
      await pasteFromClipboard(editor, point ? new Vec(point.x, point.y) : editor.getViewportPageCenter())
    },
    [editor],
  )

  return { copy, cut, paste }
}

/**
 * The native `copy`, `cut` and `paste` listeners on the container.
 *
 * Installed for their side effect; the returned functions are the same three
 * as {@link useMenuClipboardEvents} so a component can use either without
 * knowing which path it is on. The listeners ignore events that originated in a
 * text input or a contenteditable — a copy inside a label being edited belongs
 * to the label, not to the canvas.
 */
export function useNativeClipboardEvents(): TLUiClipboardEvents {
  const editor = useEditor()
  const menu = useMenuClipboardEvents()

  useEffect(() => {
    const container = editor.getContainerDocument?.()
    if (!container) return

    const isInTextField = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (!element || typeof element.closest !== "function") return false
      return element.closest("input, textarea, [contenteditable=true], [contenteditable='']") !== null
    }

    const onCopy = (event: Event) => {
      if (isInTextField(event.target)) return
      void handleNativeOrMenuCopy(editor, event as ClipboardEvent)
    }

    const onCut = (event: Event) => {
      if (isInTextField(event.target)) return
      const ids = editor.getSelectedShapeIds()
      void handleNativeOrMenuCopy(editor, event as ClipboardEvent).then((copied) => {
        if (!copied) return
        editor.markHistoryStoppingPoint("cut")
        editor.deleteShapes([...ids])
      })
    }

    const onPaste = (event: Event) => {
      if (isInTextField(event.target)) return
      void menu.paste()
    }

    container.addEventListener("copy", onCopy)
    container.addEventListener("cut", onCut)
    container.addEventListener("paste", onPaste)
    return () => {
      container.removeEventListener("copy", onCopy)
      container.removeEventListener("cut", onCut)
      container.removeEventListener("paste", onPaste)
    }
  }, [editor, menu])

  return menu
}

/**
 * "Copy as PNG/SVG/JSON", with the toast the menu item is expected to raise.
 *
 * The toast is the reason this is a hook rather than a call to `copyAs`: a copy
 * that produces no visible change on the canvas looks like nothing happened.
 */
export function useCopyAs(): (ids: readonly ShapeId[], format?: TLCopyType, opts?: CopyAsOptions) => Promise<void> {
  const editor = useEditor()
  const toasts = useToasts()
  const msg = useTranslation()

  return useCallback(
    async (ids: readonly ShapeId[], format: TLCopyType = "svg", opts: CopyAsOptions = {}) => {
      try {
        await copyAs(editor, format === "json" ? "json" : (format as ExportFormat), ids, opts)
      } catch (error) {
        toasts.addToast({ title: msg("toast.error.copy-fail.title"), description: String(error), severity: "error" })
      }
    },
    [editor, toasts, msg],
  )
}

/**
 * "Export as PNG/SVG", with the same error toast.
 *
 * Takes the ids first and the format in the options object, which is the shape
 * the action list calls it with.
 */
export function useExportAs(): (ids: readonly ShapeId[], opts?: ExportAsOptions & { format?: ExportFormat }) => Promise<void> {
  const editor = useEditor()
  const toasts = useToasts()
  const msg = useTranslation()

  return useCallback(
    async (ids: readonly ShapeId[], opts: ExportAsOptions & { format?: ExportFormat } = {}) => {
      const { format = "png", ...rest } = opts
      try {
        await exportAs(editor, format, ids, rest)
      } catch (error) {
        toasts.addToast({ title: msg("toast.error.export-fail.title"), description: String(error), severity: "error" })
      }
    },
    [editor, toasts, msg],
  )
}
