import { track, useEditor } from "@mocanvas/editor"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { DefaultPageMenu } from "./panel-page"
import { DefaultMainMenu, DefaultZoomMenu } from "./panel-menus"
import { useBreakpoint, PORTRAIT_BREAKPOINT } from "./ui-breakpoint"
import { TldrawUiIcon } from "./ui-icon"

/**
 * The panels that frame the canvas: the minimap and zoom cluster at the
 * bottom-left, the menu plate at the top-left, and the strip above it.
 */

/**
 * A scaled-down view of the page, with the viewport drawn on it.
 *
 * Painted into a 2D canvas rather than composed from DOM nodes: a document
 * with a thousand shapes would otherwise be a thousand absolutely-positioned
 * divs redrawn on every pan.
 */
export const DefaultMinimap = track(function DefaultMinimap() {
  const editor = useEditor()
  const ref = useRef<HTMLCanvasElement>(null)
  const bounds = editor.getCurrentPageBounds()
  const viewport = editor.getViewportPageBounds()
  const shapes = editor.getCurrentPageShapes()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!bounds || bounds.width === 0 || bounds.height === 0) return

    // Fit the union of the page bounds and the viewport, so panning away from
    // the content shrinks the shapes rather than sliding them out of frame.
    const minX = Math.min(bounds.minX, viewport.minX)
    const minY = Math.min(bounds.minY, viewport.minY)
    const maxX = Math.max(bounds.maxX, viewport.maxX)
    const maxY = Math.max(bounds.maxY, viewport.maxY)
    const scale = Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1)) * 0.9
    const ox = (width - (maxX - minX) * scale) / 2 - minX * scale
    const oy = (height - (maxY - minY) * scale) / 2 - minY * scale

    ctx.fillStyle = "rgba(127,127,127,0.5)"
    for (const shape of shapes) {
      const box = editor.getShapePageBounds(shape)
      if (!box) continue
      ctx.fillRect(box.minX * scale + ox, box.minY * scale + oy, Math.max(1, box.width * scale), Math.max(1, box.height * scale))
    }
    ctx.strokeStyle = "var(--mocanvas-selection, #2f6fe4)"
    ctx.strokeStyle = "#2f6fe4"
    ctx.lineWidth = 1.5
    ctx.strokeRect(viewport.minX * scale + ox, viewport.minY * scale + oy, viewport.width * scale, viewport.height * scale)
  })

  return <canvas ref={ref} className="mocanvas-minimap" aria-hidden="true" style={{ width: "100%", height: 80, display: "block" }} />
})

/**
 * The zoom cluster, and the minimap above it on wide layouts.
 *
 * The minimap is dropped below the tablet breakpoint rather than shrunk: a
 * 120px-wide overview of a whiteboard shows nothing usable, and the space is
 * better spent on the buttons.
 */
export function DefaultNavigationPanel() {
  const editor = useEditor()
  const breakpoint = useBreakpoint()
  const showMinimap = breakpoint >= PORTRAIT_BREAKPOINT.TABLET
  return (
    <div className="mocanvas-panel mocanvas-navigation-panel">
      {showMinimap ? <DefaultMinimap /> : null}
      <div className="mocanvas-navigation-row" role="toolbar" aria-label="View">
        <button type="button" className="mocanvas-btn" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => editor.zoomOut()}>
          <TldrawUiIcon icon="zoom-out" />
        </button>
        <DefaultZoomMenu />
        <button type="button" className="mocanvas-btn" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => editor.zoomIn()}>
          <TldrawUiIcon icon="zoom-in" />
        </button>
      </div>
    </div>
  )
}

/** The top-left plate: the main menu and the page picker. */
export function DefaultMenuPanel() {
  return (
    <div className="mocanvas-panel mocanvas-menu-panel">
      <DefaultMainMenu />
      <DefaultPageMenu />
    </div>
  )
}

export interface CenteredTopPanelContainerProps {
  /** Largest width the container will take, in px. */
  maxWidth?: number
  className?: string
  children?: ReactNode
}

/**
 * Centres a panel across the top, between whatever is docked left and right.
 *
 * The margins are the two side panels' widths, so the contents are centred in
 * the space that is actually free rather than in the window — which is not the
 * same thing once the style panel is open.
 */
export function CenteredTopPanelContainer({ maxWidth = 480, className, children }: CenteredTopPanelContainerProps) {
  return (
    <div
      className={["mocanvas-top-panel", className].filter(Boolean).join(" ")}
      style={{
        position: "absolute",
        top: "var(--mocanvas-ui-inset, 12px)",
        left: "calc(var(--mocanvas-ui-inset, 12px) + var(--mocanvas-ui-dock, 0px))",
        right: "calc(var(--mocanvas-ui-inset, 12px) + var(--mocanvas-ui-dock, 0px))",
        maxWidth,
        marginInline: "auto",
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  )
}

/**
 * The "you are offline" chip.
 *
 * Reads `navigator.onLine`, which is the only offline signal a canvas SDK can
 * have: whether a *sync server* is reachable is the sync layer's business, and
 * a host that has one passes its own component into the slot instead.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  if (online) return null
  return (
    <div className="mocanvas-panel mocanvas-offline" role="status">
      Offline
    </div>
  )
}
