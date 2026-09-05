/**
 * The selection brush — the translucent rectangle you drag across the canvas to
 * select what it touches — and its sibling, the zoom tool's brush.
 *
 * This is the smallest complete overlay util, and so the one worth reading
 * first: it resolves its paint from the theme through
 * {@link getOverlayDisplayValues}, it names one overlay so the manager can talk
 * about it, and it paints in page space by asking for the camera. Every other
 * painter in this directory is a longer version of the same three steps.
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
import { traceRoundedRect, withCamera } from "./paint"
import type { OverlayBox, TLBrushOverlay, TLZoomBrushOverlay } from "./types"

/**
 * The paint a brush is drawn with, resolved against the live theme.
 *
 * Separate from the options so an app can restyle *one* of them: overriding
 * `getCustomDisplayValues` changes the colours and leaves the geometry alone,
 * while `configure({ radius })` changes the geometry and leaves the theme in
 * charge of the colours.
 */
export interface BrushOverlayUtilDisplayValues {
  /** Interior colour, including its alpha. */
  fill: string
  /** Outline colour. */
  stroke: string
}

/** Everything about a brush that is not a colour. */
export interface BrushOverlayUtilOptions extends OverlayOptionsWithDisplayValues<BrushOverlayUtilDisplayValues> {
  /** Outline weight, in CSS pixels — so it is a hairline at any zoom. */
  lineWidth: number
  /** Corner radius, in CSS pixels. */
  radius: number
}

/**
 * The theme tokens a brush uses.
 *
 * `selectFill` and `selectStroke` exist in the theme for exactly this, so the
 * brush, the selection box and the indicators cannot drift apart when an app
 * retints one of them.
 */
function defaultBrushDisplayValues(
  _editor: unknown,
  theme: TLTheme,
  colorMode: TLColorMode,
): BrushOverlayUtilDisplayValues {
  const colors = theme.colors[colorMode]
  return { fill: colors.selectFill, stroke: colors.selectStroke }
}

/** The default brush geometry and paint, shared by both brushes. */
export const DEFAULT_BRUSH_OVERLAY_OPTIONS: BrushOverlayUtilOptions = {
  lineWidth: 1.5,
  radius: 2,
  getDefaultDisplayValues: defaultBrushDisplayValues,
}

/**
 * The half a brush painter shares with the other one: read a rectangle off the
 * instance record, name it, stroke it in page space.
 *
 * Generic in its overlay record so the two concrete utils can each declare
 * their own — a caller that asked `editor.overlays.getOverlayUtil("zoomBrush")`
 * for its overlays gets `TLZoomBrushOverlay[]`, not the union.
 */
abstract class BaseBrushOverlayUtil<T extends TLBrushOverlay | TLZoomBrushOverlay> extends OverlayUtil<
  Editor,
  BrushOverlayUtilOptions
> {
  /** The brush rectangle, or `null` when no drag is in flight. */
  protected abstract getBrushBounds(): OverlayBox | null

  override isActive(): boolean {
    return this.getBrushBounds() !== null
  }

  abstract override getOverlays(): T[]

  /**
   * A brush is not pointable — it *is* the pointer gesture. Returning the
   * rectangle would make the brush swallow the drag that draws it.
   */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }

  /** The colours to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): BrushOverlayUtilDisplayValues {
    return getOverlayDisplayValues<BrushOverlayUtilDisplayValues>(this)
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const display = this.getDisplayValues()
    const { lineWidth, radius } = this.options
    withCamera(ctx, camera, (c) => {
      c.fillStyle = display.fill
      c.strokeStyle = display.stroke
      c.lineWidth = lineWidth / zoom
      for (const overlay of overlays) {
        const { x, y, w, h } = overlay.bounds
        traceRoundedRect(c, x, y, w, h, radius / zoom)
        if (display.fill !== "transparent") c.fill()
        c.stroke()
      }
    })
  }
}

/**
 * Paints the select tool's brush.
 *
 * Register it — or a configured subclass — as an overlay util:
 *
 * ```ts
 * <Mocanvas overlayUtils={[BrushOverlayUtil.configure({ radius: 0 })]} />
 * ```
 */
export class BrushOverlayUtil extends BaseBrushOverlayUtil<TLBrushOverlay> {
  static override type = "brush"
  static override zIndex = 10
  static override options: BrushOverlayUtilOptions = DEFAULT_BRUSH_OVERLAY_OPTIONS

  protected override getBrushBounds(): OverlayBox | null {
    return this.editor.getInstanceState().brush
  }

  override getOverlays(): TLBrushOverlay[] {
    const bounds = this.getBrushBounds()
    if (!bounds) return []
    return [{ id: "brush", type: "brush", bounds }]
  }
}

/**
 * The zoom tool's brush: the rectangle you drag to zoom to a region.
 *
 * Everything about it is the selection brush except which slot of the instance
 * record it reads and how loudly it is painted.
 */
export class ZoomBrushOverlayUtil extends BaseBrushOverlayUtil<TLZoomBrushOverlay> {
  static override type = "zoomBrush"
  static override zIndex = 10
  static override options: BrushOverlayUtilOptions = {
    ...DEFAULT_BRUSH_OVERLAY_OPTIONS,
    radius: 4,
    // SEMANTICS-ASSUMED: the docs name the overlay but not its paint. The zoom
    // brush borrows the selection stroke and drops the fill entirely, because
    // it is a viewport gesture rather than a selection: tinting it as solidly
    // as the select brush implies the shapes underneath are being picked up.
    getDefaultDisplayValues: (_editor, theme, colorMode) => ({
      fill: "transparent",
      stroke: theme.colors[colorMode].selectStroke,
    }),
  }

  protected override getBrushBounds(): OverlayBox | null {
    return this.editor.getInstanceState().zoomBrush
  }

  override getOverlays(): TLZoomBrushOverlay[] {
    const bounds = this.getBrushBounds()
    if (!bounds) return []
    return [{ id: "zoomBrush", type: "zoomBrush", bounds }]
  }
}
