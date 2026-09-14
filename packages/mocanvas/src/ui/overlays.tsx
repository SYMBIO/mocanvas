/**
 * Floating layers shared by the default UI: the tooltip and the popover.
 *
 * Both are `position: fixed` and clamped to the viewport. Absolutely positioned
 * versions cannot do either job: a tooltip on the leftmost zoom button runs off
 * the left edge of the window, and anything anchored inside the style panel is
 * clipped by that panel's own scroll container.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"

/** Gap between an anchor and the layer floating beside it. */
const GAP = 8
/** Smallest distance a floating layer keeps from the viewport edge. */
const EDGE = 8

export interface Placement {
  left: number
  top: number
}

/**
 * Place `box` next to `anchor`, on the preferred side if it fits there and on
 * the other side if it does not, then clamp the result inside the viewport.
 *
 * `"above"` and `"below"` centre the box on the anchor — what a menu hanging
 * off a button wants. `"side"` puts it beside the anchor and aligns their top
 * edges, which is what a *submenu* wants: opening downwards in the parent's
 * own column pushes the rest of the menu out of the way and grows towards the
 * bottom of the screen, where a long submenu runs out of room.
 */
export function placeNear(anchor: DOMRect, box: { width: number; height: number }, prefer: "above" | "below" | "side", vw: number, vh: number): Placement {
  if (prefer === "side") {
    // To the right of the row, or to its left when the right would overflow —
    // the flip every platform menu does near the edge of a screen.
    const toRight = anchor.right + GAP
    const toLeft = anchor.left - box.width - GAP
    let x = toRight
    if (toRight + box.width > vw - EDGE && toLeft >= EDGE) x = toLeft
    x = Math.min(Math.max(x, EDGE), Math.max(EDGE, vw - box.width - EDGE))
    // Tops aligned, then clamped: a submenu longer than the room below its row
    // slides up rather than running off the bottom.
    const y = Math.min(Math.max(anchor.top, EDGE), Math.max(EDGE, vh - box.height - EDGE))
    return { left: x, top: y }
  }
  const above = anchor.top - box.height - GAP
  const below = anchor.bottom + GAP
  let top = prefer === "above" ? above : below
  if (prefer === "above" && above < EDGE && below + box.height <= vh - EDGE) top = below
  if (prefer === "below" && below + box.height > vh - EDGE && above >= EDGE) top = above
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, vh - box.height - EDGE))
  let left = anchor.left + anchor.width / 2 - box.width / 2
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, vw - box.width - EDGE))
  return { left, top }
}

function useClamped(getAnchor: () => DOMRect | null, prefer: "above" | "below" | "side", deps: unknown[]): [RefObject<HTMLDivElement | null>, Placement | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Placement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const anchor = getAnchor()
    if (!el || !anchor) {
      setPos(null)
      return
    }
    const box = el.getBoundingClientRect()
    setPos(placeNear(anchor, box, prefer, window.innerWidth, window.innerHeight))
    // getAnchor is recreated per render on purpose; the caller's deps drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [ref, pos]
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TipState {
  label: string
  shortcut: string | null
  anchor: DOMRect
}

/** How long the pointer must rest on a control before its tooltip appears. */
const HOVER_DELAY = 500

/**
 * The single tooltip for the whole UI. Mount it once; it labels any element
 * carrying `data-tooltip` (and, optionally, `data-shortcut`) by delegation, so
 * buttons stay plain buttons.
 */
export function UiTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clear = useCallback(() => {
    clearTimeout(timer.current)
    setTip(null)
  }, [])

  useEffect(() => {
    const read = (el: HTMLElement): TipState | null => {
      const label = el.dataset["tooltip"]
      if (!label) return null
      return { label, shortcut: el.dataset["shortcut"] ?? null, anchor: el.getBoundingClientRect() }
    }
    const target = (e: Event): HTMLElement | null => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tooltip]")
      if (!el || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null
      return el
    }
    const onOver = (e: PointerEvent) => {
      const el = target(e)
      clearTimeout(timer.current)
      if (!el) {
        setTip(null)
        return
      }
      timer.current = setTimeout(() => setTip(read(el)), HOVER_DELAY)
    }
    // Keyboard focus is deliberate, so it skips the hover delay.
    const onFocus = (e: FocusEvent) => {
      const el = target(e)
      clearTimeout(timer.current)
      setTip(el && el.matches(":focus-visible") ? read(el) : null)
    }
    document.addEventListener("pointerover", onOver, true)
    document.addEventListener("pointerdown", clear, true)
    document.addEventListener("focusin", onFocus, true)
    document.addEventListener("focusout", clear, true)
    window.addEventListener("scroll", clear, true)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener("pointerover", onOver, true)
      document.removeEventListener("pointerdown", clear, true)
      document.removeEventListener("focusin", onFocus, true)
      document.removeEventListener("focusout", clear, true)
      window.removeEventListener("scroll", clear, true)
    }
  }, [clear])

  // Above the control by default, so the tooltip never covers what it names.
  const [ref, pos] = useClamped(() => tip?.anchor ?? null, "above", [tip])
  if (!tip) return null
  return (
    <div
      ref={ref}
      className="mocanvas-tooltip mocanvas-layer"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.label}
      {tip.shortcut ? <kbd>{tip.shortcut}</kbd> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

export interface PopoverProps {
  /** The control the popover belongs to; also the click target that keeps it open. */
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  label: string
  /** Columns in the popover grid. */
  cols?: number
  prefer?: "above" | "below"
  children: ReactNode
}

/** A dismissable floating grid anchored to a button. */
export function Popover({ anchorRef, open, onClose, label, cols = 5, prefer = "above", children }: PopoverProps) {
  const [ref, pos] = useClamped(() => anchorRef.current?.getBoundingClientRect() ?? null, prefer, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open, onClose, anchorRef, ref])

  if (!open) return null
  return (
    <div
      ref={ref}
      className="mocanvas-popover mocanvas-layer"
      role="menu"
      aria-label={label}
      style={{
        ["--mocanvas-popover-cols" as string]: cols,
        ...(pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" as const }),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
