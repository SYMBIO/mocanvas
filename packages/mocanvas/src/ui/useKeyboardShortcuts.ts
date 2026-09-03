import { useEffect } from "react"
import type { Editor } from "@mocanvas/editor"

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

/** Default keyboard shortcuts: tool switching, undo/redo, select all, zoom. */
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
