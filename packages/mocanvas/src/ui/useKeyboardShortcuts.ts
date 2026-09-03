import { useEffect } from "react"
import type { Editor } from "@mocanvas/editor"

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

let clipboardFallback = ""

/** Default keyboard shortcuts: tool switching, undo/redo, select all, zoom, clipboard. */
export function useKeyboardShortcuts(editor: Editor | null): void {
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
      if (e.altKey) return
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
        case "q":
          editor.updateInstanceState({ isToolLocked: !editor.getInstanceState().isToolLocked })
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor])
}
