import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { FloatingLayer } from "./ui-floating"
import { TldrawUiButtonCheck } from "./ui-button"
import { TldrawUiIcon } from "./ui-icon"

/**
 * The dropdown menu: root, trigger, content, and the rows that go in it.
 *
 * Ten components because a menu is genuinely ten things — a checkbox row is
 * not a link row is not a submenu trigger, and each has a different ARIA role.
 * Collapsing them into one `<MenuItem type="checkbox">` would move that
 * distinction into a prop and make it easy to get wrong.
 */

interface MenuContextValue {
  id: string
  open: boolean
  setOpen(open: boolean): void
  anchorRef: RefObject<HTMLElement | null>
}

const DropdownContext = createContext<MenuContextValue | null>(null)

function useDropdown(component: string): MenuContextValue {
  const value = useContext(DropdownContext)
  if (!value) throw new Error(`${component}: render inside <TldrawUiDropdownMenuRoot>.`)
  return value
}

export interface TLUiDropdownMenuRootProps {
  id?: string
  open?: boolean
  onOpenChange?(open: boolean): void
  /** Sets `modal` on the content: a modal menu traps focus until dismissed. */
  modal?: boolean
  children?: ReactNode
}

/** The pair's root. Owns the open state unless the caller controls it. */
export function TldrawUiDropdownMenuRoot({ id, open: controlled, onOpenChange, children }: TLUiDropdownMenuRootProps) {
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
  const value = useMemo<MenuContextValue>(() => ({ id: id ?? generated, open, setOpen, anchorRef }), [id, generated, open, setOpen])
  return <DropdownContext.Provider value={value}>{children}</DropdownContext.Provider>
}

export interface TLUiDropdownMenuTriggerProps {
  className?: string
  /** Accessible name, when the trigger's content is an icon alone. */
  label?: string
  children?: ReactNode
}

/** The control that opens the menu. */
export function TldrawUiDropdownMenuTrigger({ className, label, children }: TLUiDropdownMenuTriggerProps) {
  const { id, open, setOpen, anchorRef } = useDropdown("TldrawUiDropdownMenuTrigger")
  return (
    <button
      ref={(node) => {
        anchorRef.current = node
      }}
      type="button"
      className={["mocanvas-btn", className].filter(Boolean).join(" ")}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={`${id}-content`}
      {...(label ? { "aria-label": label, "data-tooltip": label } : {})}
      onClick={() => setOpen(!open)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && !open) {
          event.preventDefault()
          setOpen(true)
        }
      }}
    >
      {children}
    </button>
  )
}

export interface TLUiDropdownMenuContentProps {
  label?: string
  className?: string
  side?: "above" | "below"
  /** Alignment against the trigger. Kept for API parity; layers are centred. */
  align?: "start" | "center" | "end"
  /** Distance from the trigger, in px. Kept for API parity. */
  sideOffset?: number
  alignOffset?: number
  children?: ReactNode
}

/** The menu panel. */
export function TldrawUiDropdownMenuContent({ label, className, side = "below", children }: TLUiDropdownMenuContentProps) {
  const ctx = useDropdown("TldrawUiDropdownMenuContent")
  const close = useCallback(() => ctx.setOpen(false), [ctx])
  return (
    <FloatingLayer
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      onClose={close}
      prefer={side}
      role="menu"
      className={["mocanvas-menu", className].filter(Boolean).join(" ")}
      {...(label ? { label } : {})}
    >
      <div id={`${ctx.id}-content`} className="mocanvas-menu-list">
        {children}
      </div>
    </FloatingLayer>
  )
}

export interface TLUiDropdownMenuGroupProps {
  label?: string
  className?: string
  children?: ReactNode
}

/**
 * A run of related rows.
 *
 * `role="group"` with a label, so a screen reader says which section it is in
 * rather than reading twenty undifferentiated rows.
 */
export function TldrawUiDropdownMenuGroup({ label, className, children }: TLUiDropdownMenuGroupProps) {
  return (
    <div className={["mocanvas-menu-group", className].filter(Boolean).join(" ")} role="group" {...(label ? { "aria-label": label } : {})}>
      {children}
    </div>
  )
}

export interface TLUiDropdownMenuItemProps {
  /** Close the menu after selecting. Defaults to `true`. */
  closeOnSelect?: boolean
  disabled?: boolean
  className?: string
  onSelect?(): void
  children?: ReactNode
}

/** A plain row. */
export function TldrawUiDropdownMenuItem({ closeOnSelect = true, disabled, className, onSelect, children }: TLUiDropdownMenuItemProps) {
  const ctx = useContext(DropdownContext)
  return (
    <button
      type="button"
      role="menuitem"
      className={["mocanvas-menu-item", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={() => {
        onSelect?.()
        if (closeOnSelect) ctx?.setOpen(false)
      }}
    >
      {children}
    </button>
  )
}

export interface TLUiDropdownMenuCheckboxItemProps {
  checked: boolean
  disabled?: boolean
  title?: string
  className?: string
  onSelect?(): void
  children?: ReactNode
}

/** A row that toggles. Stays open on select, because toggles come in runs. */
export function TldrawUiDropdownMenuCheckboxItem({ checked, disabled, title, className, onSelect, children }: TLUiDropdownMenuCheckboxItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={["mocanvas-menu-item", className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...(title ? { "data-tooltip": title } : {})}
      onClick={() => onSelect?.()}
    >
      {children}
      <TldrawUiButtonCheck checked={checked} />
    </button>
  )
}

/** The dot marking the chosen entry in a radio group. */
export function TldrawUiDropdownMenuIndicator() {
  return <span className="mocanvas-menu-indicator" aria-hidden="true" />
}

const SubContext = createContext<MenuContextValue | null>(null)

export interface TLUiDropdownMenuSubProps {
  id?: string
  open?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
}

/** A nested menu's root. */
export function TldrawUiDropdownMenuSub({ id, open: controlled, onOpenChange, children }: TLUiDropdownMenuSubProps) {
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
  const value = useMemo<MenuContextValue>(() => ({ id: id ?? generated, open, setOpen, anchorRef }), [id, generated, open, setOpen])
  return <SubContext.Provider value={value}>{children}</SubContext.Provider>
}

export interface TLUiDropdownMenuSubTriggerProps {
  label: string
  /** Marks the submenu as containing the active choice. */
  "data-testid"?: string
  disabled?: boolean
  className?: string
  children?: ReactNode
}

/**
 * The row that opens a nested menu.
 *
 * Right arrow opens it and left arrow closes it, which is the convention every
 * platform menu follows — an arrow key that does nothing here reads as the
 * submenu being unreachable.
 */
export function TldrawUiDropdownMenuSubTrigger({ label, disabled, className, children }: TLUiDropdownMenuSubTriggerProps) {
  const ctx = useContext(SubContext)
  return (
    <button
      ref={(node) => {
        if (ctx) ctx.anchorRef.current = node
      }}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={ctx?.open ?? false}
      className={["mocanvas-menu-item", "mocanvas-menu-item--sub", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={() => ctx?.setOpen(!ctx.open)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault()
          event.stopPropagation()
          ctx?.setOpen(true)
        } else if (event.key === "ArrowLeft" && ctx?.open) {
          event.preventDefault()
          event.stopPropagation()
          ctx.setOpen(false)
        }
      }}
    >
      {children ?? label}
      {/* Points where the panel opens: a down chevron on a row that flies out
          to the side reads as "this expands in place". */}
      <TldrawUiIcon icon="chevron-right" small />
    </button>
  )
}

export interface TLUiDropdownMenuSubContentProps {
  label?: string
  className?: string
  alignOffset?: number
  sideOffset?: number
  children?: ReactNode
}

/** A nested menu's panel. */
export function TldrawUiDropdownMenuSubContent({ label, className, children }: TLUiDropdownMenuSubContentProps) {
  const ctx = useContext(SubContext)
  const close = useCallback(() => ctx?.setOpen(false), [ctx])
  if (!ctx) return null
  return (
    <FloatingLayer
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      onClose={close}
      prefer="side"
      role="menu"
      className={["mocanvas-menu", "mocanvas-menu--sub", className].filter(Boolean).join(" ")}
      {...(label ? { label } : {})}
    >
      <div id={`${ctx.id}-content`} className="mocanvas-menu-list">
        {children}
      </div>
    </FloatingLayer>
  )
}
