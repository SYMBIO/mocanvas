import { createContext, useContext, type ReactNode } from "react"

/**
 * Which way a container of controls runs.
 *
 * A toolbar, a menu and a picker row all need to know this for the same two
 * reasons: which arrow keys move the roving focus, and which CSS axis the
 * children lay out along. Publishing it as context rather than passing a prop
 * lets a button work out its own keyboard behaviour without its parent having
 * to thread the answer through every wrapper in between.
 */

export interface TldrawUiOrientationContext {
  orientation: "horizontal" | "vertical"
  /** Writing direction, which flips what "next" means on a horizontal axis. */
  dir: "ltr" | "rtl"
}

const OrientationContext = createContext<TldrawUiOrientationContext>({ orientation: "horizontal", dir: "ltr" })

export interface TldrawUiOrientationProviderProps extends Partial<TldrawUiOrientationContext> {
  children?: ReactNode
}

/** Publishes an orientation to everything inside it. */
export function TldrawUiOrientationProvider({ orientation = "horizontal", dir = "ltr", children }: TldrawUiOrientationProviderProps) {
  return <OrientationContext.Provider value={{ orientation, dir }}>{children}</OrientationContext.Provider>
}

/**
 * The current orientation, plus the two keys that move focus along it.
 *
 * `prevKey`/`nextKey` are already direction-corrected, so a roving-focus
 * handler can compare `event.key` against them without knowing whether it is
 * in a right-to-left locale.
 */
export function useTldrawUiOrientation(): TldrawUiOrientationContext & { prevKey: string; nextKey: string } {
  const value = useContext(OrientationContext)
  if (value.orientation === "vertical") return { ...value, prevKey: "ArrowUp", nextKey: "ArrowDown" }
  const rtl = value.dir === "rtl"
  return { ...value, prevKey: rtl ? "ArrowRight" : "ArrowLeft", nextKey: rtl ? "ArrowLeft" : "ArrowRight" }
}
