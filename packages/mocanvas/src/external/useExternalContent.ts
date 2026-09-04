import type { Editor } from "@mocanvas/editor"
import { useEffect, type RefObject } from "react"
import { classifyExternalText, registerDefaultExternalContentHandlers, type ExternalContentOptions } from "./defaultExternalContentHandlers"

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

/**
 * Drop and paste support for the canvas container: files, images, svg markup,
 * urls and plain text are routed to `editor.putExternalContent`. Plain text is
 * only taken when nothing is being edited and it is not our own
 * `application/mocanvas` clipboard JSON (the keyboard shortcuts handle that).
 * Also installs the default handlers for any content type without one.
 */
export function useExternalContent(editor: Editor | null, containerRef: RefObject<HTMLElement | null>, options?: ExternalContentOptions): void {
  useEffect(() => {
    if (!editor) return
    const unregister = registerDefaultExternalContentHandlers(editor, options ?? {})
    return unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    const el = containerRef.current
    if (!editor || !el) return

    const pagePoint = (e: MouseEvent) => editor.screenToPage({ x: e.clientX, y: e.clientY })

    const handleText = (text: string | undefined, point?: { x: number; y: number }) => {
      if (!text || isEditableContext()) return false
      const info = classifyExternalText(text, point)
      if (!info) return false
      void editor.putExternalContent(info)
      return true
    }

    const isEditableContext = () => !!editor.getEditingShapeId() || isEditable(document.activeElement)

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }

    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt) return
      e.preventDefault()
      const point = pagePoint(e)
      const files = Array.from(dt.files)
      if (files.length) {
        void editor.putExternalContent({ type: "files", files, point })
        return
      }
      const url = dt.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#"))
      if (url) {
        void editor.putExternalContent({ type: "url", url, point })
        return
      }
      handleText(dt.getData("text/plain"), point)
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || isEditableContext()) return
      const cd = e.clipboardData
      if (!cd) return
      const files = Array.from(cd.files)
      if (files.length) {
        e.preventDefault()
        void editor.putExternalContent({ type: "files", files })
        return
      }
      if (handleText(cd.getData("text/plain"))) e.preventDefault()
    }

    // The default shortcuts call preventDefault on ⌘V (to paste our own JSON),
    // which suppresses the `paste` event. When that happened, read the clipboard
    // through the async API instead; images are the main thing gained here.
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? "")
      const accel = isMac ? e.metaKey : e.ctrlKey
      if (!accel || e.key.toLowerCase() !== "v" || isEditable(e.target) || isEditableContext()) return
      setTimeout(() => {
        if (!e.defaultPrevented || !navigator.clipboard?.read) return
        navigator.clipboard.read().then(
          async (items) => {
            const files: File[] = []
            let text: string | undefined
            for (const item of items) {
              const imageType = item.types.find((t) => t.startsWith("image/"))
              if (imageType) {
                const blob = await item.getType(imageType)
                files.push(new File([blob], `pasted.${imageType.split("/")[1] ?? "png"}`, { type: imageType }))
              } else if (item.types.includes("text/plain") && text === undefined) {
                text = await (await item.getType("text/plain")).text()
              }
            }
            if (files.length) void editor.putExternalContent({ type: "files", files })
            else handleText(text)
          },
          () => {
            // clipboard permission denied or unsupported; nothing to paste
          },
        )
      }, 0)
    }

    el.addEventListener("dragover", onDragOver)
    el.addEventListener("drop", onDrop)
    window.addEventListener("paste", onPaste)
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      el.removeEventListener("dragover", onDragOver)
      el.removeEventListener("drop", onDrop)
      window.removeEventListener("paste", onPaste)
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [editor, containerRef])
}
