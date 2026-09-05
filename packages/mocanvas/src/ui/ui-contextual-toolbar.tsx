import { EditorPortal, useEditor, useValue } from "@mocanvas/editor"
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { TldrawUiToolbar } from "./ui-toolbar"

/**
 * A toolbar that follows a thing on the canvas: the bar over a selected image,
 * the rich-text bar over a text shape being edited.
 *
 * The hard part is not the buttons, it is staying put. The bar is positioned
 * from page-space bounds converted to screen space on every camera change, and
 * flips below its subject when there is no room above — otherwise it sits off
 * the top of the viewport exactly when the user has scrolled their subject to
 * the top edge to work on it.
 */

/** Gap between the subject's bounds and the bar. */
const GAP = 12

export interface TLUiContextualToolbarProps {
  label: string
  /** Page-space box the bar hangs off. Omit to hide the bar. */
  getSelectionBounds?(): { x: number; y: number; w: number; h: number } | undefined
  /** Hide while the user is dragging, so the bar does not chase the pointer. */
  hidden?: boolean
  className?: string
  children?: ReactNode
}

/** A floating toolbar anchored to a page-space box. */
export function TldrawUiContextualToolbar({ label, getSelectionBounds, hidden, className, children }: TLUiContextualToolbarProps) {
  const editor = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const bounds = useValue("contextual toolbar bounds", () => getSelectionBounds?.() ?? editor.getSelectionPageBounds() ?? undefined, [editor, getSelectionBounds])
  const camera = useValue("contextual toolbar camera", () => editor.getCamera(), [editor])
  const viewport = useValue("contextual toolbar viewport", () => editor.getViewportScreenBounds(), [editor])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize((current) => (current.w === rect.width && current.h === rect.height ? current : { w: rect.width, h: rect.height }))
  }, [bounds, children])

  if (hidden || !bounds) return null

  const left = (bounds.x + bounds.w / 2 + camera.x) * camera.z - size.w / 2
  const above = (bounds.y + camera.y) * camera.z - size.h - GAP
  const below = (bounds.y + bounds.h + camera.y) * camera.z + GAP
  const top = above < 0 ? below : above
  const clampedLeft = Math.max(GAP, Math.min(left, Math.max(GAP, viewport.w - size.w - GAP)))

  return (
    <EditorPortal>
      <div className="mocanvas-contextual-toolbar" style={{ position: "absolute", left: clampedLeft, top, zIndex: 20 }}>
        <TldrawUiToolbar ref={ref} label={label} className={className} style={{ position: "relative", left: 0, right: 0, bottom: 0, margin: 0 }}>
          {children}
        </TldrawUiToolbar>
      </div>
    </EditorPortal>
  )
}
