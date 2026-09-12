import { EditorPortal } from "@mocanvas/editor"
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
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

/**
 * How a layer learns about the layers opened from inside it.
 *
 * Every floating layer is portalled to the same place, so a submenu is a
 * *sibling* of the menu that opened it, not a descendant. A dismiss check
 * written as "did the press land inside me?" therefore answers no for a press
 * on the submenu's own rows — and closes the whole menu on pointer-down,
 * before the click that would have chosen the row ever happens. Every submenu
 * item in the chrome was unreachable for exactly this reason.
 *
 * A layer registers its element with the layer it was opened from (and, up
 * the chain, with that layer's own parent), so "inside me" can mean "inside
 * me or anything I opened".
 */
export interface TLUiLayerNesting {
  /** Register a nested layer's element. Returns the un-register. */
  register(node: HTMLElement): () => void
  /** Whether `target` is inside a layer opened from this one. */
  containsNested(target: Node): boolean
}

const LayerNestingContext = createContext<TLUiLayerNesting | null>(null)

/** The nesting handle a layer publishes to whatever it renders inside it. */
function useLayerNesting(): TLUiLayerNesting {
  const parent = useContext(LayerNestingContext)
  const nested = useRef<Set<HTMLElement>>(new Set())
  return useMemo<TLUiLayerNesting>(
    () => ({
      register(node) {
        nested.current.add(node)
        // Forward upwards, so a press two submenus deep still counts as
        // inside the menu at the top.
        const releaseParent = parent?.register(node)
        return () => {
          nested.current.delete(node)
          releaseParent?.()
        }
      },
      containsNested(target) {
        for (const node of nested.current) if (node.contains(target)) return true
        return false
      },
    }),
    [parent],
  )
}

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
  /** Also treat these as "inside": the layers this one opened. */
  containsNested?: (target: Node) => boolean,
): void {
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (layerRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      if (containsNested?.(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Escape inside a field reverts the field. The layer only closes once
      // there is nothing left in it that owns the key.
      if (isTypingTarget(event.target)) return
      // Escape closes the innermost layer only: one press should back out of
      // a submenu, not out of the menu it lives in.
      if (containsNested?.(event.target as Node)) return
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
  }, [open, layerRef, anchorRef, onClose, containsNested])
}

/** Everything inside a floating layer that the keyboard can reach. */
const FOCUSABLE = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],button:not([disabled]),a[href],input:not([disabled])'

/**
 * Whether a key press is being typed into a field.
 *
 * A menu that holds a text field — the page menu's rename row — has to stop
 * being a menu for as long as the caret is in it: Home, End and the arrows
 * belong to the text, and Escape means "undo this edit" rather than "close
 * everything". Without this the field is unusable inside the layer that
 * contains it.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== "string") return false
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true
}

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
      if (isTypingTarget(event.target)) return
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
  const parent = useContext(LayerNestingContext)
  const nesting = useLayerNesting()
  useDismissable(open, ref, anchorRef, onClose, nesting.containsNested)
  useMenuKeyboard(keyboardNav && open, ref)
  // Tell the layer we were opened from that we exist, so a press on our rows
  // does not read to it as a press outside itself.
  useEffect(() => {
    const node = ref.current
    if (!open || !node || !parent) return
    return parent.register(node)
  }, [open, parent, ref])
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
        <LayerNestingContext.Provider value={nesting}>{children}</LayerNestingContext.Provider>
      </div>
    </EditorPortal>
  )
}
