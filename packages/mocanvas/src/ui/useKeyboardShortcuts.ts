import { useEffect } from "react"
import { atom } from "@mocanvas/state"
import type { Editor } from "@mocanvas/editor"

/** Whether the frame-statistics chip is visible. Toggled with ⌥D. */
export const debugStatsOpen = atom("debugStatsOpen", false)

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

let clipboardFallback = ""

export interface KeyboardShortcutOptions {
  /**
   * Bind the plain-key tool switches (`v`, `h`, `n`, …). Leave it on for an
   * editor with no chrome; turn it OFF whenever `DefaultUi` is mounted, because
   * the UI tool list binds those keys itself — and it is the list an app's
   * `TLUiOverrides.tools` can rewrite, so a binding hard-coded here would
   * survive an override that meant to remove it. Defaults to `true`.
   */
  tools?: boolean
}

/** Default keyboard shortcuts: tool switching, undo/redo, select all, zoom, clipboard. */
export function useKeyboardShortcuts(editor: Editor | null, options: KeyboardShortcutOptions = {}): void {
  const bindTools = options.tools ?? true
  useEffect(() => {
    if (!editor) return
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? "")
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (editor.getEditingShapeId()) return
      const accel = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()
      if (accel) {
        switch (key) {
          case "z":
            e.preventDefault()
            if (e.shiftKey) editor.redo()
            else editor.undo()
            return
          case "y":
            e.preventDefault()
            editor.redo()
            return
          case "a":
            e.preventDefault()
            editor.selectAll()
            return
          case "g": {
            e.preventDefault()
            const ids = editor.getSelectedShapeIds()
            if (!ids.length) return
            editor.markHistoryStoppingPoint(e.shiftKey ? "ungroup" : "group")
            if (e.shiftKey) editor.ungroupShapes(ids)
            else editor.groupShapes(ids)
            return
          }
          case "l": {
            e.preventDefault()
            if (e.shiftKey) {
              editor.markHistoryStoppingPoint("lock")
              editor.toggleLock()
            }
            return
          }
          case "d": {
            e.preventDefault()
            const ids = editor.getSelectedShapeIds()
            if (ids.length) {
              editor.markHistoryStoppingPoint("duplicate")
              const copies = editor.duplicateShapes(ids)
              editor.setSelectedShapes(copies)
            }
            return
          }
          case "c":
          case "x": {
            const ids = editor.getSelectedShapeIds()
            if (!ids.length) return
            e.preventDefault()
            const content = editor.getContentFromCurrentPage(ids)
            if (content) {
              const text = JSON.stringify({ type: "application/mocanvas", ...content })
              navigator.clipboard?.writeText(text).catch(() => {})
              clipboardFallback = text
            }
            if (key === "x") {
              editor.markHistoryStoppingPoint("cut")
              editor.deleteShapes(ids)
            }
            return
          }
          case "v": {
            e.preventDefault()
            const paste = (text: string) => {
              try {
                const data = JSON.parse(text) as { type?: string; shapes?: unknown[]; bindings?: unknown[] }
                if (data.type !== "application/mocanvas" || !Array.isArray(data.shapes)) return
                editor.markHistoryStoppingPoint("paste")
                editor.putContentOntoCurrentPage(data as never, { point: editor.getViewportPageCenter() })
              } catch {
                // not our content
              }
            }
            if (navigator.clipboard?.readText) navigator.clipboard.readText().then(paste, () => clipboardFallback && paste(clipboardFallback))
            else if (clipboardFallback) paste(clipboardFallback)
            return
          }
          case "=":
          case "+":
            e.preventDefault()
            editor.zoomIn()
            return
          case "-":
            e.preventDefault()
            editor.zoomOut()
            return
          case "0":
            e.preventDefault()
            editor.resetZoom()
            return
          case "1":
            e.preventDefault()
            editor.zoomToFit()
            return
          case "2":
            e.preventDefault()
            editor.zoomToSelection()
            return
          case "]":
            e.preventDefault()
            if (e.altKey) editor.bringToFront()
            else editor.bringForward()
            return
          case "[":
            e.preventDefault()
            if (e.altKey) editor.sendToBack()
            else editor.sendBackward()
            return
          default:
            return
        }
      }
      if (e.altKey) {
        // ⌥D toggles the debug stats chip. On macOS Alt+D types "∂", so match the physical key too.
        if (e.code === "KeyD" || key === "d" || key === "\u2202") {
          e.preventDefault()
          debugStatsOpen.set(!debugStatsOpen.get())
        }
        return
      }
      // Tool lock is not a tool switch: it stays bound either way.
      if (key === "q") {
        editor.updateInstanceState({ isToolLocked: !editor.getInstanceState().isToolLocked })
        return
      }
      if (!bindTools) return
      switch (key) {
        case "v":
          editor.setCurrentTool("select")
          break
        case "h":
          editor.setCurrentTool("hand")
          break
        case "r":
          editor.setCurrentTool("geo", { geo: "rectangle" })
          break
        case "o":
          editor.setCurrentTool("geo", { geo: "ellipse" })
          break
        case "d":
        case "p":
        case "b":
          editor.setCurrentTool("draw")
          break
        case "e":
          editor.setCurrentTool("eraser")
          break
        case "n":
          editor.setCurrentTool("note")
          break
        case "t":
          editor.setCurrentTool("text")
          break
        // arrow/line/frame are optional tools: apps may register a smaller set.
        case "a":
          if (editor.root.children?.["arrow"]) editor.setCurrentTool("arrow")
          break
        case "l":
          if (editor.root.children?.["line"]) editor.setCurrentTool("line")
          break
        case "f":
          if (editor.root.children?.["frame"]) editor.setCurrentTool("frame")
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor, bindTools])
}
