/**
 * The selection foreground: the box round what is selected, and the corner,
 * edge and rotate handles on it.
 *
 * "Foreground" as opposed to the selection *background* — the invisible region
 * that catches a drag on the interior. This util draws only what you can see,
 * and answers which handle the pointer is over so a tool can start the right
 * gesture.
 *
 * Positions come from `getSelectionHandlePositions`, which already knows the
 * awkward parts: a rotated single selection is measured in its own space, edge
 * handles disappear on an edge too short to hold one, and a util can hide its
 * resize or rotate handles entirely. Duplicating any of that here would let the
 * drawing and the hit testing disagree, which is the one failure a selection
 * box must not have.
 */
import {
  getOverlayDisplayValues,
  getSelectionHandlePositions,
  OverlayUtil,
  Rectangle2d,
  type Editor,
  type Geometry2d,
  type OverlayOptionsWithDisplayValues,
  type TLColorMode,
  type TLOverlay,
  type TLTheme,
} from "@mocanvas/editor"
import { isolate, traceRoundedRect } from "./paint"
import type { TLSelectionForegroundOverlay } from "./types"

/** The paint the selection box and its handles are drawn with. */
export interface SelectionForegroundOverlayUtilDisplayValues {
  /** Box outline and handle outline. */
  stroke: string
  /** Handle interior — the surface the outline is drawn against. */
  fill: string
}

/** Selection chrome geometry, in CSS pixels. */
export interface SelectionForegroundOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<SelectionForegroundOverlayUtilDisplayValues> {
  /** Outline weight for the box and the handles. */
  lineWidth: number
  /** Side of a square corner/edge handle. */
  handleSize: number
  /** Corner radius of a square handle. */
  handleRadius: number
  /** Radius of the round rotate handle. */
  rotateRadius: number
  /** Extra pointer slack around each handle, on top of its own size. */
  hitPadding: number
}

/** The v5 defaults: a 9px square handle, a 5.5px rotate dot, 1.5px strokes. */
export const DEFAULT_SELECTION_FOREGROUND_OVERLAY_OPTIONS: SelectionForegroundOverlayUtilOptions = {
  lineWidth: 1.5,
  handleSize: 9,
  handleRadius: 2,
  rotateRadius: 5.5,
  hitPadding: 6,
  getDefaultDisplayValues: (_editor: unknown, theme: TLTheme, colorMode: TLColorMode) => {
    const colors = theme.colors[colorMode]
    return { stroke: colors.selectStroke, fill: colors.solid }
  },
}

/** A corner or edge handle, as opposed to the rotate handle. */
function isSquareHandle(handle: string): boolean {
  return handle !== "rotate"
}

/**
 * The cursor for each resize handle.
 *
 * Deliberately *not* rotated with the selection. A rotated box's "top left"
 * corner may point south-east on screen, and matching the cursor to the screen
 * direction would need the selection rotation folded in on every frame. Naming
 * the axis the drag acts on is both cheaper and less surprising: the cursor
 * says which dimension changes, not which way your hand moves.
 */
const HANDLE_CURSORS: Record<string, string> = {
  top: "ns-resize",
  bottom: "ns-resize",
  left: "ew-resize",
  right: "ew-resize",
  top_left: "nwse-resize",
  bottom_right: "nwse-resize",
  top_right: "nesw-resize",
  bottom_left: "nesw-resize",
  rotate: "grab",
}

/** Paints, and hit-tests, the selection box and its handles. */
export class SelectionForegroundOverlayUtil extends OverlayUtil<Editor, SelectionForegroundOverlayUtilOptions> {
  static override type = "selectionForeground"
  static override zIndex = 40
  static override options: SelectionForegroundOverlayUtilOptions = DEFAULT_SELECTION_FOREGROUND_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.editor.getCurrentToolId() === "select" && this.editor.getSelectionPageBounds() !== null
  }

  /**
   * One record for the box, then one per handle.
   *
   * The box comes first so that painting in order puts the handles on top of
   * it, and hit testing in reverse lets a handle win over the box it sits on.
   */
  override getOverlays(): TLSelectionForegroundOverlay[] {
    if (!this.isActive()) return []
    const info = getSelectionHandlePositions(this.editor)
    const out: TLSelectionForegroundOverlay[] = [
      { id: "selection", type: "selectionForeground", handle: null, point: null },
    ]
    if (!info) return out
    for (const h of info.handles) {
      out.push({ id: `handle:${h.handle}`, type: "selectionForeground", handle: h.handle, point: h.point })
    }
    return out
  }

  /**
   * A square hit region round a handle, in **page** units — the space
   * `OverlayManager.getOverlayAtPoint` tests in. The handle positions are
   * viewport pixels, so they are converted here rather than at the source,
   * which the SVG layer and the tools both want in viewport space.
   *
   * The box outline itself has no geometry: a click on it is a click on the
   * selection, and the select tool already owns that.
   */
  override getGeometry(overlay: TLOverlay): Geometry2d | undefined {
    const record = overlay as TLSelectionForegroundOverlay
    if (!record.handle || !record.point) return undefined
    const zoom = this.editor.getZoomLevel() || 1
    const visual = isSquareHandle(record.handle) ? this.options.handleSize / 2 : this.options.rotateRadius
    const r = (visual + this.options.hitPadding) / zoom
    const center = this.editor.viewportToPage(record.point)
    return new Rectangle2d({ x: center.x - r, y: center.y - r, width: r * 2, height: r * 2, isFilled: true })
  }

  override getCursor(overlay: TLOverlay): string | undefined {
    const record = overlay as TLSelectionForegroundOverlay
    if (!record.handle) return undefined
    return HANDLE_CURSORS[record.handle]
  }

  /** The colours to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): SelectionForegroundOverlayUtilDisplayValues {
    return getOverlayDisplayValues<SelectionForegroundOverlayUtilDisplayValues>(this)
  }

  /**
   * Everything here is painted in **screen** space, without the camera.
   *
   * The handles are a fixed size in CSS pixels and the box is drawn round the
   * selection's screen-space corners, so installing the camera would only mean
   * dividing every number back out by the zoom again.
   */
  override render(ctx: CanvasRenderingContext2D): void {
    if (!this.isActive()) return
    const editor = this.editor
    const display = this.getDisplayValues()
    const { lineWidth, handleSize, handleRadius, rotateRadius } = this.options
    const bounds = editor.getSelectionPageBounds()
    const info = getSelectionHandlePositions(editor)

    isolate(ctx, (c) => {
      c.strokeStyle = display.stroke
      c.fillStyle = display.fill
      c.lineWidth = lineWidth

      // `info` is null exactly when a lone selected shape hides both its resize and
      // its rotate handles — which is how a util says it draws its own selection
      // chrome. The box was drawn from `bounds` alone and never asked, so such a
      // shape got the frame anyway: a selected arrow, which has no box to speak of,
      // came up wrapped in one.
      // One shape needs no box: it already has an outline of its own, drawn by the
      // indicator layer along the shape itself. Stroking the bounds as well put a
      // second line beside the first — near enough to read as a mistake, and it
      // cannot be made to coincide, because a hand-drawn outline genuinely does
      // not run along its own geometry. The handles below still mark where the
      // box is, and the corners are where the two differ visibly: the outline
      // rounds, the handle sits out on the true corner.
      //
      // Several shapes are the other case. There is no single outline to stand in
      // for the selection, so the union box is the only thing that says what the
      // gesture will act on.
      if (bounds && info) {
        const selected = editor.getSelectedShapes()
        const single = selected.length === 1 ? selected[0] : undefined
        if (!single) {
          const topLeft = editor.pageToViewport({ x: bounds.x, y: bounds.y })
          const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
          c.beginPath()
          c.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
          c.stroke()
        }
      }

      if (!info) return
      for (const h of info.handles) {
        if (isSquareHandle(h.handle)) {
          traceRoundedRect(c, h.point.x - handleSize / 2, h.point.y - handleSize / 2, handleSize, handleSize, handleRadius)
        } else {
          c.beginPath()
          c.arc(h.point.x, h.point.y, rotateRadius, 0, Math.PI * 2)
        }
        c.fill()
        c.stroke()
      }
    })
  }
}
