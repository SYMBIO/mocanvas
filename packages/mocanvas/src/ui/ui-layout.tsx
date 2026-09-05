import type { CSSProperties, ReactNode } from "react"
import { TldrawUiOrientationProvider } from "./ui-orientation"

/**
 * The three layout boxes the chrome is assembled from.
 *
 * They exist as components rather than as CSS classes so that a row also
 * publishes its orientation (see {@link TldrawUiOrientationProvider}) — which
 * is what lets the buttons inside it work out their own arrow-key behaviour
 * without being told.
 */
export interface TLUiLayoutProps {
  /** Cross-axis alignment. */
  align?: "start" | "center" | "end" | "stretch"
  /** Main-axis distribution. */
  justify?: "start" | "center" | "end" | "between"
  /** Gap between children, in px. */
  gap?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" }
const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" }

/** A horizontal run of controls. */
export function TldrawUiRow({ align = "center", justify = "start", gap = 2, className, style, children }: TLUiLayoutProps) {
  return (
    <TldrawUiOrientationProvider orientation="horizontal">
      <div
        className={["mocanvas-row", className].filter(Boolean).join(" ")}
        style={{ display: "flex", flexDirection: "row", alignItems: ALIGN[align], justifyContent: JUSTIFY[justify], gap, ...style }}
      >
        {children}
      </div>
    </TldrawUiOrientationProvider>
  )
}

/** A vertical stack of controls. */
export function TldrawUiColumn({ align = "stretch", justify = "start", gap = 2, className, style, children }: TLUiLayoutProps) {
  return (
    <TldrawUiOrientationProvider orientation="vertical">
      <div
        className={["mocanvas-column", className].filter(Boolean).join(" ")}
        style={{ display: "flex", flexDirection: "column", alignItems: ALIGN[align], justifyContent: JUSTIFY[justify], gap, ...style }}
      >
        {children}
      </div>
    </TldrawUiOrientationProvider>
  )
}

export interface TLUiGridProps extends TLUiLayoutProps {
  /** Columns. Defaults to four, which is what a swatch grid wants. */
  columns?: number
}

/**
 * A fixed-column grid: colour swatches, geo kinds, the shortcuts dialog.
 *
 * Reports itself as `role="grid"`-less on purpose — it is a layout, and giving
 * it a grid role would make a screen reader announce row and column numbers
 * for what the user experiences as a list of buttons.
 */
export function TldrawUiGrid({ columns = 4, gap = 2, className, style, children }: TLUiGridProps) {
  return (
    <div
      className={["mocanvas-grid", className].filter(Boolean).join(" ")}
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap, ...style }}
    >
      {children}
    </div>
  )
}
