import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { FloatingLayer } from "./ui-floating"
import { TldrawUiIcon } from "./ui-icon"

/**
 * A value picker: a trigger showing the current choice, and a list to change
 * it from.
 *
 * Not a native `<select>`, because the options carry icons and swatches that
 * an option element cannot hold. That means the ARIA has to be supplied by
 * hand, which is what these five components are for — a `listbox` of `option`s
 * behind a `combobox` trigger.
 */

interface SelectContextValue<T = string> {
  id: string
  open: boolean
  setOpen(open: boolean): void
  value: T | undefined
  onValueChange: ((value: T) => void) | undefined
  anchorRef: RefObject<HTMLElement | null>
  /** The label of whichever item matches `value`, registered by the items. */
  labels: Map<T, ReactNode>
}

const SelectContext = createContext<SelectContextValue<never> | null>(null)

function useSelect<T>(component: string): SelectContextValue<T> {
  const value = useContext(SelectContext) as SelectContextValue<T> | null
  if (!value) throw new Error(`${component}: render inside <TldrawUiSelect>.`)
  return value
}

export interface TLUiSelectProps<T = string> {
  id?: string
  value?: T
  onValueChange?(value: T): void
  open?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
}

/** The picker's root. */
export function TldrawUiSelect<T = string>({ id, value, onValueChange, open: controlled, onOpenChange, children }: TLUiSelectProps<T>) {
  const generated = useId()
  const [uncontrolled, setUncontrolled] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const labels = useRef(new Map<T, ReactNode>()).current
  const open = controlled ?? uncontrolled
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange],
  )
  const ctx = useMemo<SelectContextValue<T>>(
    () => ({ id: id ?? generated, open, setOpen, value, onValueChange, anchorRef, labels }),
    [id, generated, open, setOpen, value, onValueChange, labels],
  )
  return <SelectContext.Provider value={ctx as unknown as SelectContextValue<never>}>{children}</SelectContext.Provider>
}

export interface TLUiSelectTriggerProps {
  label?: string
  className?: string
  disabled?: boolean
  children?: ReactNode
}

/** The control showing the current value. */
export function TldrawUiSelectTrigger({ label, className, disabled, children }: TLUiSelectTriggerProps) {
  const ctx = useSelect<string>("TldrawUiSelectTrigger")
  return (
    <button
      ref={(node) => {
        ctx.anchorRef.current = node
      }}
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      aria-controls={`${ctx.id}-listbox`}
      className={["mocanvas-picker", className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...(label ? { "aria-label": label } : {})}
      onClick={() => ctx.setOpen(!ctx.open)}
    >
      {children}
      <TldrawUiIcon icon="chevron-down" small />
    </button>
  )
}

export interface TLUiSelectValueProps {
  /** Shown when nothing is selected. */
  placeholder?: ReactNode
  className?: string
}

/** The current value, rendered from whichever item registered it. */
export function TldrawUiSelectValue({ placeholder, className }: TLUiSelectValueProps) {
  const ctx = useSelect<string>("TldrawUiSelectValue")
  const label = ctx.value === undefined ? undefined : ctx.labels.get(ctx.value)
  return <span className={["mocanvas-select-value", className].filter(Boolean).join(" ")}>{label ?? placeholder ?? ctx.value ?? ""}</span>
}

export interface TLUiSelectContentProps {
  label?: string
  className?: string
  side?: "above" | "below"
  children?: ReactNode
}

/** The option list. */
export function TldrawUiSelectContent({ label, className, side = "below", children }: TLUiSelectContentProps) {
  const ctx = useSelect<string>("TldrawUiSelectContent")
  const close = useCallback(() => ctx.setOpen(false), [ctx])
  return (
    <FloatingLayer
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      onClose={close}
      prefer={side}
      role="listbox"
      className={["mocanvas-menu", "mocanvas-select-list", className].filter(Boolean).join(" ")}
      {...(label ? { label } : {})}
    >
      <div id={`${ctx.id}-listbox`}>{children}</div>
    </FloatingLayer>
  )
}

export interface TLUiSelectItemProps<T = string> {
  value: T
  disabled?: boolean
  className?: string
  children?: ReactNode
}

/**
 * One option.
 *
 * Registers its own rendered label against its value on every render, so
 * {@link TldrawUiSelectValue} can show the trigger's current choice with the
 * same markup the list uses — icon included — instead of the bare value.
 */
export function TldrawUiSelectItem<T = string>({ value, disabled, className, children }: TLUiSelectItemProps<T>) {
  const ctx = useSelect<T>("TldrawUiSelectItem")
  ctx.labels.set(value, children)
  const selected = ctx.value === value
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={["mocanvas-menu-item", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={() => {
        ctx.onValueChange?.(value)
        ctx.setOpen(false)
      }}
    >
      {children}
    </button>
  )
}
