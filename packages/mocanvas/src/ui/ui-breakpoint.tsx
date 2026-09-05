import { useContainerIfExists } from "@mocanvas/editor"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

/**
 * How much room the chrome has, as one number the panels branch on.
 *
 * Measured from the editor's container rather than the window, because an
 * editor embedded in a sidebar is narrow even on a wide screen — and a media
 * query cannot see that.
 */

/**
 * The breakpoints, smallest first. A component compares against the named
 * constants rather than the raw numbers: `breakpoint < PORTRAIT_BREAKPOINT.TABLET_SM`.
 */
export const PORTRAIT_BREAKPOINT = {
  ZERO: 0,
  MOBILE_XXS: 1,
  MOBILE_XS: 2,
  MOBILE_SM: 3,
  MOBILE: 4,
  TABLET_SM: 5,
  TABLET: 6,
  DESKTOP: 7,
} as const

/** One of the {@link PORTRAIT_BREAKPOINT} values. */
export type TLUiBreakpoint = (typeof PORTRAIT_BREAKPOINT)[keyof typeof PORTRAIT_BREAKPOINT]

/** The container widths, in CSS px, at which each breakpoint starts. */
const BREAKPOINT_WIDTHS: readonly number[] = [0, 390, 428, 468, 580, 640, 840, 1024]

/** The breakpoint a container of `width` CSS px is in. */
export function getBreakpointForWidth(width: number): TLUiBreakpoint {
  let result: number = PORTRAIT_BREAKPOINT.ZERO
  for (let i = 0; i < BREAKPOINT_WIDTHS.length; i++) {
    if (width >= (BREAKPOINT_WIDTHS[i] as number)) result = i
  }
  return result as TLUiBreakpoint
}

const BreakpointContext = createContext<TLUiBreakpoint>(PORTRAIT_BREAKPOINT.DESKTOP)

export interface BreakPointProviderProps {
  /** Pin the breakpoint to the smallest one, whatever the container measures. */
  forceMobile?: boolean
  children?: ReactNode
}

/**
 * Measures the editor's container and publishes its breakpoint.
 *
 * Starts at `DESKTOP` and narrows once measured: chrome that starts full and
 * settles narrower reads as a layout, while chrome that starts collapsed and
 * expands reads as a glitch.
 */
export function BreakPointProvider({ forceMobile = false, children }: BreakPointProviderProps) {
  const container = useContainerIfExists()
  const [breakpoint, setBreakpoint] = useState<TLUiBreakpoint>(PORTRAIT_BREAKPOINT.DESKTOP)

  useEffect(() => {
    if (!container || typeof ResizeObserver === "undefined") return
    const update = () => setBreakpoint(getBreakpointForWidth(container.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    return () => ro.disconnect()
  }, [container])

  const value = forceMobile ? PORTRAIT_BREAKPOINT.MOBILE_XXS : breakpoint
  return <BreakpointContext.Provider value={value}>{children}</BreakpointContext.Provider>
}

/** The current breakpoint. `DESKTOP` outside a provider. */
export function useBreakpoint(): TLUiBreakpoint {
  return useContext(BreakpointContext)
}
