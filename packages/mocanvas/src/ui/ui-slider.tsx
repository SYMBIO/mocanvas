import { useRef, type CSSProperties } from "react"

/**
 * The chrome's slider — opacity, and anything else an app puts in the style
 * panel.
 *
 * Two callbacks rather than one: `onValueChange` fires continuously while
 * dragging, `onHistoryMark` once when the drag begins. The document mark has
 * to be taken before the first change, or the whole drag lands in the undo
 * stack as one entry per pixel.
 */
export interface TLUiSliderProps {
  /** Current value, in steps. `null` when the selection disagrees. */
  value: number | null
  /** Number of steps. The slider runs `0..steps`. */
  steps: number
  label: string
  title?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
  "data-testid"?: string
  onValueChange(value: number): void
  /** Called once per interaction, before the first `onValueChange`. */
  onHistoryMark?(id: string): void
}

/**
 * A range input.
 *
 * A native `<input type="range">` rather than a div with pointer handlers: it
 * is keyboard-operable, announced correctly, and honours the platform's own
 * "page up jumps by ten" conventions for free.
 */
export function TldrawUiSlider({
  value,
  steps,
  label,
  title,
  disabled,
  className,
  style,
  onValueChange,
  onHistoryMark,
  ...rest
}: TLUiSliderProps) {
  const marked = useRef(false)
  const mark = () => {
    if (marked.current) return
    marked.current = true
    onHistoryMark?.(`slider:${label}`)
  }
  return (
    <input
      type="range"
      className={["mocanvas-slider", className].filter(Boolean).join(" ")}
      style={style}
      min={0}
      max={steps}
      step={1}
      // A slider with no shared value still has to be a valid range input, so
      // it sits at the bottom and says so through `aria-valuetext`.
      value={value ?? 0}
      disabled={disabled}
      aria-label={label}
      {...(title ? { "data-tooltip": title } : {})}
      {...(value === null ? { "aria-valuetext": "Mixed" } : {})}
      {...(rest["data-testid"] ? { "data-testid": rest["data-testid"] } : {})}
      onPointerDown={mark}
      onKeyDown={mark}
      onPointerUp={() => (marked.current = false)}
      onBlur={() => (marked.current = false)}
      onChange={(event) => {
        mark()
        onValueChange(Number(event.target.value))
      }}
    />
  )
}
