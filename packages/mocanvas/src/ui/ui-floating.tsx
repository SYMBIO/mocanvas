import { EditorPortal } from "@mocanvas/editor"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { placeNear, type Placement } from "./overlays"

/**
 * The mechanics every floating layer in the chrome shares: position beside an
 * anchor, stay inside the viewport, close on Escape or an outside click, and
 * hand focus back to the anchor when it closes.
 *
 * Factored out because getting any one of those wrong is invisible in the
 * common case and infuriating in the uncommon one — a menu that opens off the
 * bottom of a short window, or that drops focus into the void when dismissed.
 */

export type Side = "above" | "below"

/** Position an element beside `anchor` once it has been measured. */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  prefer: Side,
): [RefObject<HTMLDivElement | null>, Placement | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Placement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const anchor = anchorRef.current?.getBoundingClientRect() ?? null
    if (!open || !el || !anchor) {
      setPos(null)
      return
    }
    const box = el.getBoundingClientRect()
    setPos(placeNear(anchor, box, prefer, window.innerWidth, window.innerHeight))
  }, [open, prefer, anchorRef])
  return [ref, pos]
}

/**
 * Close on Escape or on a pointer press outside both the layer and its anchor.
 *
 * Listens in the capture phase so it wins against a canvas handler that would
 * otherwise start a gesture on the same press.
 */
export function useDismissable(
  open: boolean,
  layerRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (layerRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
      anchorRef.current?.focus()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open, layerRef, anchorRef, onClose])
}

/** Everything inside a floating layer that the keyboard can reach. */
const FOCUSABLE = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],button:not([disabled]),a[href],input:not([disabled])'

/**
 * Roving focus inside a menu: Up/Down move, Home/End jump, and focus lands on
 * the first item when the menu opens.
 *
 * A menu whose items cannot be reached with the arrow keys is not a menu — it
 * is a set of buttons that happen to be in a box — so this is wired into every
 * floating layer rather than left to each one.
 */
export function useMenuKeyboard(open: boolean, layerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return
    const layer = layerRef.current
    if (!layer) return
    const items = () => Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = items()[0]
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      const list = items()
      if (list.length === 0) return
      const index = list.indexOf(layer.ownerDocument.activeElement as HTMLElement)
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault()
        list[(index + 1) % list.length]?.focus()
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault()
        list[(index - 1 + list.length) % list.length]?.focus()
      } else if (event.key === "Home") {
        event.preventDefault()
        list[0]?.focus()
      } else if (event.key === "End") {
        event.preventDefault()
        list[list.length - 1]?.focus()
      }
    }
    layer.addEventListener("keydown", onKey)
    return () => layer.removeEventListener("keydown", onKey)
  }, [open, layerRef])
}

export interface FloatingLayerProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose(): void
  prefer?: Side
  role?: string
  label?: string
  className?: string
  /** Wire up arrow-key navigation. Off for a layer that is not a menu. */
  keyboardNav?: boolean
  children?: ReactNode
}

/**
 * A positioned, dismissable layer portalled into the editor's container.
 *
 * Portalled rather than rendered in place so it escapes the `overflow: hidden`
 * of whatever panel opened it, while staying inside the container that carries
 * the theme's CSS custom properties.
 */
export function FloatingLayer({
  anchorRef,
  open,
  onClose,
  prefer = "below",
  role = "menu",
  label,
  className,
  keyboardNav = true,
  children,
}: FloatingLayerProps) {
  const [ref, pos] = useAnchoredPosition(anchorRef, open, prefer)
  useDismissable(open, ref, anchorRef, onClose)
  useMenuKeyboard(keyboardNav && open, ref)
  if (!open) return null
  return (
    <EditorPortal>
      <div
        ref={ref}
        className={["mocanvas-layer", className].filter(Boolean).join(" ")}
        role={role}
        {...(label ? { "aria-label": label } : {})}
        style={pos ? { position: "fixed", left: pos.left, top: pos.top } : { position: "fixed", left: 0, top: 0, visibility: "hidden" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </EditorPortal>
  )
}
