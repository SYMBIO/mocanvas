import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { UiTooltip } from "./overlays"

/**
 * Tooltips, as a wrapper rather than a delegated layer.
 *
 * {@link UiTooltip} already labels anything carrying `data-tooltip` by
 * delegation, and remains what the default chrome uses. This pair exists for
 * the other case: a control that is not a plain button — a slider thumb, a
 * swatch inside a portal — where the caller wants to say explicitly what the
 * tip belongs to.
 */

interface TooltipContextValue {
  /** Suppress every tooltip, e.g. while a menu is open. */
  suppressed: boolean
  setSuppressed(value: boolean): void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

export interface TldrawUiTooltipProviderProps {
  /** Delay before a tip appears, in ms. */
  delayDuration?: number
  children?: ReactNode
}

/**
 * Hosts the shared tooltip layer.
 *
 * One layer for the whole editor: two tooltips on screen at once is always a
 * bug, and a per-control layer makes it easy to have one.
 */
export function TldrawUiTooltipProvider({ children }: TldrawUiTooltipProviderProps) {
  const [suppressed, setSuppressed] = useState(false)
  const value = useMemo<TooltipContextValue>(() => ({ suppressed, setSuppressed }), [suppressed])
  return (
    <TooltipContext.Provider value={value}>
      {children}
      {suppressed ? null : <UiTooltip />}
    </TooltipContext.Provider>
  )
}

export interface TldrawUiTooltipProps {
  /** The tip's text. No tip is shown when this is empty. */
  content?: string
  /** A shortcut shown beside the text. */
  kbd?: string
  side?: "top" | "bottom" | "left" | "right"
  disabled?: boolean
  children?: ReactNode
}

/**
 * Attaches a tooltip to its child.
 *
 * Renders a wrapper carrying the `data-tooltip` attributes the shared layer
 * looks for, so the child stays exactly the element the caller wrote.
 */
export function TldrawUiTooltip({ content, kbd, disabled, children }: TldrawUiTooltipProps) {
  if (!content || disabled) return <>{children}</>
  return (
    <span className="mocanvas-tooltip-anchor" style={{ display: "contents" }} data-tooltip={content} {...(kbd ? { "data-shortcut": kbd } : {})}>
      {children}
    </span>
  )
}

/**
 * Dismiss whatever tooltip is on screen.
 *
 * Needed at the moments a pointer-out never arrives: a menu opening over the
 * button that was hovered, or a shortcut that changes the layout under the
 * pointer. Dispatches the same event the shared layer already listens for,
 * so it works whether or not a provider is mounted.
 */
export function hideAllTooltips(): void {
  if (typeof document === "undefined") return
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
}

/** Suppress tooltips for as long as the caller says. */
export function useTooltipSuppression(): (suppressed: boolean) => void {
  const ctx = useContext(TooltipContext)
  return useCallback(
    (suppressed: boolean) => {
      ctx?.setSuppressed(suppressed)
    },
    [ctx],
  )
}
