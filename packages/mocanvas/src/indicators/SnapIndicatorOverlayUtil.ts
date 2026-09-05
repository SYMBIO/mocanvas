/**
 * Snap guides: the lines that appear while dragging to say "this edge lines up
 * with that one".
 *
 * The snapping itself happens in `SnapManager` during the drag — by the time
 * this util runs, the decision is made and the shape has already been nudged.
 * All that is left is to show *why* it moved, which is the entire reason snap
 * guides exist: a shape that jumps without one looks like a bug.
 */
import {
  getOverlayDisplayValues,
  OverlayUtil,
  type Editor,
  type Geometry2d,
  type OverlayOptionsWithDisplayValues,
  type TLColorMode,
  type TLTheme,
} from "@mocanvas/editor"
import { hairline, traceCross, tracePolyline, withCamera } from "./paint"
import type { TLSnapIndicatorOverlay } from "./types"

/** The paint a snap guide is drawn with. */
export interface SnapIndicatorOverlayUtilDisplayValues {
  /** Guide colour. The theme's `hint`, which is deliberately not the selection colour. */
  color: string
}

/** How snap guides are drawn. */
export interface SnapIndicatorOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<SnapIndicatorOverlayUtilDisplayValues> {
  /** Guide weight, in CSS pixels. */
  lineWidth: number
  /**
   * Half-length of the `×` drawn at each aligned point, in CSS pixels. The
   * crosses are what distinguish "these two edges are collinear" from "there
   * happens to be a line here".
   */
  crossArm: number
}

/** Thin lines and small crosses, in the theme's hint colour. */
export const DEFAULT_SNAP_INDICATOR_OVERLAY_OPTIONS: SnapIndicatorOverlayUtilOptions = {
  lineWidth: 1,
  crossArm: 4,
  getDefaultDisplayValues: (_editor: unknown, theme: TLTheme, colorMode: TLColorMode) => ({
    color: theme.colors[colorMode].hint,
  }),
}

/** Paints the snap guides `editor.snaps` published for the drag in flight. */
export class SnapIndicatorOverlayUtil extends OverlayUtil<Editor, SnapIndicatorOverlayUtilOptions> {
  static override type = "snapIndicator"
  static override zIndex = 20
  static override options: SnapIndicatorOverlayUtilOptions = DEFAULT_SNAP_INDICATOR_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.editor.snaps.getLines().length > 0
  }

  override getOverlays(): TLSnapIndicatorOverlay[] {
    return this.editor.snaps.getLines().map((line) => ({
      id: line.id,
      type: "snapIndicator" as const,
      points: line.points,
    }))
  }

  /** A guide exists only during a drag, so nothing can be pointing at it. */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }

  /** The colour to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): SnapIndicatorOverlayUtilDisplayValues {
    return getOverlayDisplayValues<SnapIndicatorOverlayUtilDisplayValues>(this)
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const { lineWidth, crossArm } = this.options
    const color = this.getDisplayValues().color
    withCamera(ctx, camera, (c) => {
      c.strokeStyle = color
      c.lineWidth = hairline(lineWidth, zoom)
      c.lineCap = "round"
      const arm = hairline(crossArm, zoom)
      for (const overlay of overlays) {
        tracePolyline(c, overlay.points)
        for (const point of overlay.points) traceCross(c, point.x, point.y, arm)
        c.stroke()
      }
    })
  }
}
