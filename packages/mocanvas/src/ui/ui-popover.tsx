import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { FloatingLayer, type Side } from "./ui-floating"

/**
 * A popover: a trigger, and a panel that hangs off it.
 *
 * Three components rather than one with a `content` prop, because the trigger
 * has to be an element the caller controls — a toolbar button, a swatch, a
 * page name — while the panel has to be portalled out of it. Sharing a context
 * is what keeps the pair wired together across that portal.
 */

interface PopoverContextValue {
  id: string
  open: boolean
  setOpen(open: boolean): void
  anchorRef: RefObject<HTMLElement | null>
  side: Side
}

const PopoverContext = createContext<PopoverContextValue | null>(null)

function usePopoverContext(component: string): PopoverContextValue {
  const value = useContext(PopoverContext)
  if (!value) throw new Error(`${component}: render inside <TldrawUiPopover>.`)
  return value
}

export interface TLUiPopoverProps {
  /** Stable id, used for the trigger/panel `aria-controls` pair. */
  id?: string
  /** Controlled open state. Omit to let the popover own it. */
  open?: boolean
  onOpenChange?(open: boolean): void
  /** Which side of the trigger the panel prefers. */
  side?: Side
  children?: ReactNode
}

/** The pair's root. Owns the open state unless the caller controls it. */
export function TldrawUiPopover({ id, open: controlled, onOpenChange, side = "below", children }: TLUiPopoverProps) {
  const generated = useId()
  const [uncontrolled, setUncontrolled] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const open = controlled ?? uncontrolled

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange],
  )

  const value = useMemo<PopoverContextValue>(
    () => ({ id: id ?? generated, open, setOpen, anchorRef, side }),
    [id, generated, open, setOpen, side],
  )
  return <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>
}

export interface TLUiPopoverTriggerProps {
  className?: string
  children?: ReactNode
}

/**
 * The control that opens the panel.
 *
 * Wraps its children in a button rather than cloning them, so a caller can put
 * whatever it likes inside without the trigger having to guess which prop on
 * an unknown element is the click handler.
 */
export function TldrawUiPopoverTrigger({ className, children }: TLUiPopoverTriggerProps) {
  const { id, open, setOpen, anchorRef } = usePopoverContext("TldrawUiPopoverTrigger")
  return (
    <button
      ref={(node) => {
        anchorRef.current = node
      }}
      type="button"
      className={["mocanvas-btn", className].filter(Boolean).join(" ")}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={`${id}-content`}
      onClick={() => setOpen(!open)}
    >
      {children}
    </button>
  )
}

export interface TLUiPopoverContentProps {
  /** Accessible name for the panel. */
  label?: string
  className?: string
  /** Which side to prefer, overriding the root's. */
  side?: Side
  children?: ReactNode
}

/** The panel. Rendered only while open, and portalled into the container. */
export function TldrawUiPopoverContent({ label, className, side, children }: TLUiPopoverContentProps) {
  const ctx = usePopoverContext("TldrawUiPopoverContent")
  const close = useCallback(() => ctx.setOpen(false), [ctx])
  return (
    <FloatingLayer
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      onClose={close}
      prefer={side ?? ctx.side}
      role="dialog"
      keyboardNav={false}
      className={["mocanvas-popover", className].filter(Boolean).join(" ")}
      {...(label ? { label } : {})}
    >
      <div id={`${ctx.id}-content`}>{children}</div>
    </FloatingLayer>
  )
}
