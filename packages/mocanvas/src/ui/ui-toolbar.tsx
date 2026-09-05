import { createContext, useContext, useRef, type CSSProperties, type ReactNode, type Ref } from "react"
import { TldrawUiOrientationProvider, useTldrawUiOrientation } from "./ui-orientation"

/**
 * The toolbar primitive, and the buttons that go in it.
 *
 * A toolbar is not a list of buttons: it is one tab stop, and the arrow keys
 * move within it. Browsers give you none of that for free, so the roving
 * tabindex lives here — a caller composing `TldrawUiToolbarButton`s gets the
 * keyboard behaviour without writing any of it.
 */

export interface TLUiToolbarProps {
  label: string
  orientation?: "horizontal" | "vertical"
  className?: string | undefined
  style?: CSSProperties | undefined
  ref?: Ref<HTMLDivElement> | undefined
  children?: ReactNode
}

/** A `role="toolbar"` container with roving focus. */
export function TldrawUiToolbar({ label, orientation = "horizontal", className, style, ref, children }: TLUiToolbarProps) {
  const own = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const root = own.current
    if (!root) return
    const horizontal = orientation === "horizontal"
    const next = horizontal ? "ArrowRight" : "ArrowDown"
    const prev = horizontal ? "ArrowLeft" : "ArrowUp"
    if (event.key !== next && event.key !== prev && event.key !== "Home" && event.key !== "End") return
    const items = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]),[role='radio']:not([aria-disabled='true'])"))
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(root.ownerDocument.activeElement as HTMLElement)
    if (event.key === "Home") items[0]?.focus()
    else if (event.key === "End") items[items.length - 1]?.focus()
    else if (event.key === next) items[(index + 1) % items.length]?.focus()
    else items[(index - 1 + items.length) % items.length]?.focus()
  }

  return (
    <TldrawUiOrientationProvider orientation={orientation}>
      <div
        ref={(node) => {
          own.current = node
          if (typeof ref === "function") ref(node)
          else if (ref) (ref as { current: HTMLDivElement | null }).current = node
        }}
        role="toolbar"
        aria-label={label}
        aria-orientation={orientation}
        className={["mocanvas-panel", "mocanvas-toolbar", className].filter(Boolean).join(" ")}
        style={style}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </TldrawUiOrientationProvider>
  )
}

export interface TLUiToolbarButtonProps {
  type?: "icon" | "tool" | "menu" | "normal"
  isActive?: boolean
  disabled?: boolean
  title?: string
  "aria-label"?: string
  className?: string
  ref?: Ref<HTMLButtonElement>
  onClick?(): void
  children?: ReactNode
}

/** A button inside a {@link TldrawUiToolbar}. */
export function TldrawUiToolbarButton({ type = "icon", isActive, disabled, title, className, ref, onClick, children, ...rest }: TLUiToolbarButtonProps) {
  const label = rest["aria-label"] ?? title
  return (
    <button
      ref={ref}
      type="button"
      className={["mocanvas-btn", `mocanvas-btn--${type}`, className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...(label ? { "aria-label": label, "data-tooltip": title ?? label } : {})}
      {...(isActive === undefined ? {} : { "aria-pressed": isActive })}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface ToggleGroupValue {
  value: string | undefined
  onValueChange: ((value: string) => void) | undefined
  type: "single" | "multiple"
  values: readonly string[]
}

const ToggleGroupContext = createContext<ToggleGroupValue | null>(null)

export interface TLUiToolbarToggleGroupProps {
  label: string
  /** `"single"` behaves as a radio group, `"multiple"` as a set of toggles. */
  type?: "single" | "multiple"
  value?: string
  values?: readonly string[]
  onValueChange?(value: string): void
  className?: string
  children?: ReactNode
}

/**
 * A run of mutually-exclusive (or multi-select) toolbar buttons.
 *
 * `role="radiogroup"` for the single case: the difference matters to a screen
 * reader, which announces "2 of 4" for a radio and "pressed" for a toggle.
 */
export function TldrawUiToolbarToggleGroup({ label, type = "single", value, values = [], onValueChange, className, children }: TLUiToolbarToggleGroupProps) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange: onValueChange ?? undefined, type, values }}>
      <div className={["mocanvas-seg", className].filter(Boolean).join(" ")} role={type === "single" ? "radiogroup" : "group"} aria-label={label}>
        {children}
      </div>
    </ToggleGroupContext.Provider>
  )
}

export interface TLUiToolbarToggleItemProps {
  value: string
  type?: "icon" | "tool" | "normal"
  disabled?: boolean
  title?: string
  className?: string
  children?: ReactNode
}

/** One entry in a {@link TldrawUiToolbarToggleGroup}. */
export function TldrawUiToolbarToggleItem({ value, type = "icon", disabled, title, className, children }: TLUiToolbarToggleItemProps) {
  const group = useContext(ToggleGroupContext)
  const { prevKey, nextKey } = useTldrawUiOrientation()
  const single = group?.type !== "multiple"
  const checked = single ? group?.value === value : (group?.values ?? []).includes(value)
  return (
    <button
      type="button"
      role={single ? "radio" : "checkbox"}
      aria-checked={checked}
      // In a radio group only the checked item is a tab stop; the arrows move
      // between the rest. Without this, Tab walks every swatch in the panel.
      tabIndex={single ? (checked ? 0 : -1) : 0}
      className={["mocanvas-btn", `mocanvas-btn--${type}`, className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...(title ? { "aria-label": title, "data-tooltip": title } : {})}
      onClick={() => group?.onValueChange?.(value)}
      onKeyDown={(event) => {
        if (event.key !== prevKey && event.key !== nextKey) return
        event.preventDefault()
        const parent = event.currentTarget.parentElement
        const items = Array.from(parent?.querySelectorAll<HTMLElement>("[role='radio'],[role='checkbox']") ?? [])
        const index = items.indexOf(event.currentTarget)
        const target = items[(index + (event.key === nextKey ? 1 : -1) + items.length) % items.length]
        target?.focus()
        target?.click()
      }}
    >
      {children}
    </button>
  )
}
