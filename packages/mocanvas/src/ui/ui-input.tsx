import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react"
import { TldrawUiIcon } from "./ui-icon"

/**
 * The text field the chrome uses: a page name, a link, a numeric style value.
 *
 * Uncontrolled in the React sense — it keeps its own draft and reports it —
 * because the values it edits are committed to the document, and committing
 * every keystroke would fill the undo stack with one entry per letter. The
 * three callbacks are the seam for that: `onValueChange` while typing,
 * `onComplete` on Enter or blur, `onCancel` on Escape.
 */
export interface TLUiInputProps {
  /** The value to start from. Changing it replaces the draft. */
  value?: string
  defaultValue?: string
  placeholder?: string
  label?: string
  icon?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Select the whole value when it takes focus. */
  autoSelect?: boolean
  className?: string
  style?: CSSProperties
  id?: string
  ref?: Ref<HTMLInputElement>
  onValueChange?(value: string): void
  /** Enter, or losing focus: the value is final. */
  onComplete?(value: string): void
  /** Escape: put the original value back. */
  onCancel?(value: string): void
  onFocus?(): void
  onBlur?(): void
}

/** A labelled text input that commits on Enter and reverts on Escape. */
export function TldrawUiInput({
  value,
  defaultValue,
  placeholder,
  label,
  icon,
  disabled,
  autoFocus,
  autoSelect,
  className,
  style,
  id,
  ref,
  onValueChange,
  onComplete,
  onCancel,
  onFocus,
  onBlur,
}: TLUiInputProps) {
  const [draft, setDraft] = useState(value ?? defaultValue ?? "")
  const committed = useRef(draft)

  useEffect(() => {
    if (value === undefined) return
    setDraft(value)
    committed.current = value
  }, [value])

  return (
    <div className={["mocanvas-input", className].filter(Boolean).join(" ")} style={style}>
      {icon ? <TldrawUiIcon icon={icon} small /> : null}
      <input
        ref={ref}
        id={id}
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        {...(label ? { "aria-label": label } : {})}
        onFocus={(event) => {
          if (autoSelect) event.currentTarget.select()
          onFocus?.()
        }}
        onBlur={() => {
          onComplete?.(draft)
          committed.current = draft
          onBlur?.()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          onValueChange?.(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.stopPropagation()
            committed.current = draft
            onComplete?.(draft)
            event.currentTarget.blur()
          } else if (event.key === "Escape") {
            event.stopPropagation()
            setDraft(committed.current)
            onCancel?.(committed.current)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
