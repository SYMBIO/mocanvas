/**
 * A shape's own handles: an arrow's two terminals, a line's vertices, the
 * midpoints that become vertices when you drag them.
 *
 * These are not the selection's resize handles — those belong to
 * {@link SelectionForegroundOverlayUtil}. A shape handle is part of the shape's
 * own editing model, comes from the shape util's `getHandles`, and only exists
 * while exactly one shape is selected.
 *
 * This is the first *pointable* overlay in the directory: it answers
 * `getGeometry` and `getCursor`, which is what lets `editor.overlays` say the
 * pointer is over a handle rather than over the shape behind it.
 */
import {
  getOverlayDisplayValues,
  OverlayUtil,
  Rectangle2d,
  type Editor,
  type Geometry2d,
  type OverlayOptionsWithDisplayValues,
  type ShapeHandle,
  type TLColorMode,
  type TLOverlay,
  type TLTheme,
  type UnknownShape,
} from "@mocanvas/editor"
import { withCamera } from "./paint"
import type { TLShapeHandleOverlay } from "./types"

/** The paint a shape handle is drawn with. */
export interface ShapeHandleOverlayUtilDisplayValues {
  /** Outline of a solid handle, and the body of a virtual one. */
  stroke: string
  /** Interior of a solid handle — the surface its outline is drawn against. */
  fill: string
}

/** Handle geometry, all in CSS pixels so handles are one size at every zoom. */
export interface ShapeHandleOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<ShapeHandleOverlayUtilDisplayValues> {
  /** Radius of a real (`vertex`, `create`, `clone`) handle. */
  radius: number
  /** Radius of a `virtual` handle — smaller, because it is only a suggestion. */
  virtualRadius: number
  /** Outline weight. */
  lineWidth: number
  /** Opacity of a virtual handle. */
  virtualOpacity: number
  /**
   * Extra pointer slack around a handle, on top of its radius. A 6px dot is
   * hard to hit on a trackpad and impossible on touch; the target is bigger
   * than the thing you can see, deliberately.
   */
  hitPadding: number
}

/** Solid handles at 6px, virtual ones at 4px and half-transparent. */
export const DEFAULT_SHAPE_HANDLE_OVERLAY_OPTIONS: ShapeHandleOverlayUtilOptions = {
  radius: 6,
  virtualRadius: 4,
  lineWidth: 1.5,
  virtualOpacity: 0.6,
  hitPadding: 6,
  getDefaultDisplayValues: (_editor: unknown, theme: TLTheme, colorMode: TLColorMode) => {
    const colors = theme.colors[colorMode]
    return { stroke: colors.selectStroke, fill: colors.solid }
  },
}

/** Paints, and hit-tests, the handles of the single selected shape. */
export class ShapeHandleOverlayUtil extends OverlayUtil<Editor, ShapeHandleOverlayUtilOptions> {
  static override type = "shapeHandle"
  static override zIndex = 50
  static override options: ShapeHandleOverlayUtilOptions = DEFAULT_SHAPE_HANDLE_OVERLAY_OPTIONS

  /**
   * The shape whose handles are showing, or `undefined`.
   *
   * One shape only. With several selected there is no unambiguous answer to
   * "drag this vertex", and a canvas covered in every selected arrow's
   * terminals is unreadable besides.
   */
  protected getHandleShape(): UnknownShape | undefined {
    if (this.editor.getCurrentToolId() !== "select") return undefined
    const shape = this.editor.getOnlySelectedShape()
    if (!shape || shape.isLocked) return undefined
    return shape
  }

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLShapeHandleOverlay[] {
    const editor = this.editor
    const shape = this.getHandleShape()
    if (!shape) return []
    let handles: ShapeHandle[]
    try {
      handles = editor.getShapeUtil(shape).getHandles?.(shape) ?? []
    } catch {
      // FAIL-SOFT: a util that throws while describing its handles must not
      // take the whole overlay layer down with it.
      return []
    }
    const m = editor.getShapePageTransform(shape)
    return handles.map((handle) => ({
      id: `${shape.id}:${handle.id}`,
      type: "shapeHandle" as const,
      shapeId: shape.id,
      handleId: handle.id,
      handleType: handle.type,
      point: { x: m.a * handle.x + m.c * handle.y + m.e, y: m.b * handle.x + m.d * handle.y + m.f },
    }))
  }

  /**
   * A square hit region around the handle, in page units.
   *
   * Square rather than round because it is a *target*, not the drawing: a
   * rectangle is cheaper to test, and the difference between the two at this
   * size is smaller than the pointer's own precision.
   */
  override getGeometry(overlay: TLOverlay): Geometry2d | undefined {
    const handle = overlay as TLShapeHandleOverlay
    if (!handle.point) return undefined
    const zoom = this.editor.getZoomLevel() || 1
    const visual = handle.handleType === "virtual" ? this.options.virtualRadius : this.options.radius
    const r = (visual + this.options.hitPadding) / zoom
    return new Rectangle2d({
      x: handle.point.x - r,
      y: handle.point.y - r,
      width: r * 2,
      height: r * 2,
      isFilled: true,
    })
  }

  override getCursor(): string {
    return "grab"
  }

  /** The colours to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): ShapeHandleOverlayUtilDisplayValues {
    return getOverlayDisplayValues<ShapeHandleOverlayUtilDisplayValues>(this)
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const display = this.getDisplayValues()
    const { radius, virtualRadius, lineWidth, virtualOpacity } = this.options
    withCamera(ctx, camera, (c) => {
      c.lineWidth = lineWidth / zoom
      for (const overlay of overlays) {
        const isVirtual = overlay.handleType === "virtual"
        const r = (isVirtual ? virtualRadius : radius) / zoom
        c.globalAlpha = isVirtual ? virtualOpacity : 1
        // A virtual handle is a filled dot in the selection colour; a real one
        // is a ring, so the two never read as the same affordance.
        c.fillStyle = isVirtual ? display.stroke : display.fill
        c.strokeStyle = display.stroke
        c.beginPath()
        c.arc(overlay.point.x, overlay.point.y, r, 0, Math.PI * 2)
        c.fill()
        if (!isVirtual) c.stroke()
      }
      c.globalAlpha = 1
    })
  }
}
