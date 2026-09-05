import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, Ref } from "react"
import { TldrawUiIcon } from "./ui-icon"

/**
 * The button every piece of chrome is made of, and the three things that go
 * inside it.
 *
 * Split into four components rather than one with an `icon` and a `label`
 * prop, because the arrangement varies: a toolbar button is icon-only, a menu
 * item is icon-then-label, a checkbox item is label-then-check. Composing
 * covers all three without a prop that means "which layout".
 */

/** How a button reads: its size, its emphasis, and whether it is a menu row. */
export type TLUiButtonType = "normal" | "primary" | "danger" | "low" | "icon" | "menu" | "tool" | "help"

export interface TLUiButtonProps {
  type?: TLUiButtonType
  /** Rendered as `aria-pressed`: a two-state button, not a link. */
  isChecked?: boolean
  /** Marks the active item in a set. Rendered as `aria-current`. */
  isActive?: boolean
  disabled?: boolean
  /** Accessible name. Required when the button's content is an icon alone. */
  title?: string
  /** Explicit accessible name, when it differs from the visible label. */
  "aria-label"?: string
  className?: string
  style?: CSSProperties
  id?: string
  tabIndex?: number
  role?: string
  ref?: Ref<HTMLButtonElement>
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  onPointerDown?(event: PointerEvent<HTMLButtonElement>): void
  onPointerUp?(event: PointerEvent<HTMLButtonElement>): void
  onKeyDown?(event: React.KeyboardEvent<HTMLButtonElement>): void
  onFocus?(event: React.FocusEvent<HTMLButtonElement>): void
  onBlur?(event: React.FocusEvent<HTMLButtonElement>): void
  children?: ReactNode
}

/**
 * A button.
 *
 * `type="submit"` is never what chrome wants — a button inside a form that
 * defaults to submitting is a bug waiting for someone to press Enter — so this
 * always renders `type="button"`.
 */
export function TldrawUiButton({
  type = "normal",
  isChecked,
  isActive,
  disabled,
  title,
  className,
  style,
  id,
  tabIndex,
  role,
  ref,
  onClick,
  onPointerDown,
  onPointerUp,
  onKeyDown,
  onFocus,
  onBlur,
  children,
  ...rest
}: TLUiButtonProps) {
  const label = rest["aria-label"] ?? title
  return (
    <button
      ref={ref}
      type="button"
      id={id}
      role={role}
      tabIndex={tabIndex}
      className={["mocanvas-btn", `mocanvas-btn--${type}`, className].filter(Boolean).join(" ")}
      style={style}
      disabled={disabled}
      {...(label ? { "aria-label": label, "data-tooltip": title ?? label } : {})}
      {...(isChecked === undefined ? {} : { "aria-pressed": isChecked })}
      {...(isActive ? { "aria-current": true as const } : {})}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </button>
  )
}

export interface TLUiButtonIconProps {
  icon: string
  small?: boolean
  invertIcon?: boolean
  className?: string
}

/** The icon slot inside a {@link TldrawUiButton}. Decorative: never labelled. */
export function TldrawUiButtonIcon({ icon, small, invertIcon, className }: TLUiButtonIconProps) {
  return <TldrawUiIcon icon={icon} {...(small ? { small } : {})} {...(invertIcon ? { invertIcon } : {})} className={["mocanvas-btn-icon", className].filter(Boolean).join(" ")} />
}

export interface TLUiButtonLabelProps {
  className?: string
  children?: ReactNode
}

/** The text slot inside a {@link TldrawUiButton}. */
export function TldrawUiButtonLabel({ className, children }: TLUiButtonLabelProps) {
  return <span className={["mocanvas-btn-label", className].filter(Boolean).join(" ")}>{children}</span>
}

export interface TLUiButtonCheckProps {
  checked: boolean
  className?: string
}

/**
 * The tick at the end of a checkbox menu row.
 *
 * Always rendered, invisible when unchecked, so the row's label does not shift
 * sideways as it is toggled. `aria-hidden` because the row itself already
 * carries `aria-checked`.
 */
export function TldrawUiButtonCheck({ checked, className }: TLUiButtonCheckProps) {
  return (
    <span
      className={["mocanvas-btn-check", className].filter(Boolean).join(" ")}
      data-checked={checked}
      aria-hidden="true"
      style={{ visibility: checked ? "visible" : "hidden", display: "inline-flex" }}
    >
      <TldrawUiIcon icon="check" small />
    </span>
  )
}
