/**
 * The zoom tool: click to zoom in, alt-click to zoom out, drag a box to zoom to
 * it.
 *
 * It remembers the tool it was entered from and returns there when it is done,
 * because zooming is almost always an interruption of something else — you
 * zoom in to place a shape precisely, not to stay zoomed in.
 */

import { Box, StateNode, Vec, type PointerEventInfo, type StateNodeConstructor } from "@mocanvas/editor"

/** How far a single click zooms, as a multiple of the current zoom. */
const CLICK_ZOOM_FACTOR = 2

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "zoom-in", rotation: 0 } })
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    this.parent!.transition("pointing", info)
  }

  override onKeyDown(): void {
    // Alt flips the cursor while it is held, so the modifier is discoverable
    // before the click rather than only after it.
    this.editor.updateInstanceState({ cursor: { type: this.editor.inputs.altKey ? "zoom-out" : "zoom-in", rotation: 0 } })
  }

  override onKeyUp(): void {
    this.editor.updateInstanceState({ cursor: { type: this.editor.inputs.altKey ? "zoom-out" : "zoom-in", rotation: 0 } })
  }

  override onCancel(): void {
    ;(this.parent as ZoomTool | null)?.returnToOriginatingTool()
  }
}

class Pointing extends StateNode {
  static override id = "pointing"

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("zoom_brushing")
  }

  override onPointerUp(): void {
    // A click, not a drag: zoom about the point that was clicked, so what was
    // under the cursor stays under the cursor.
    const point = this.editor.inputs.currentScreenPoint
    const zoom = this.editor.getZoomLevel()
    const next = this.editor.inputs.altKey ? zoom / CLICK_ZOOM_FACTOR : zoom * CLICK_ZOOM_FACTOR
    this.editor.zoomToPointAt(point, next, { animation: { duration: this.editor.options.animationMediumMs } })
    ;(this.parent as ZoomTool | null)?.returnToOriginatingTool()
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class ZoomBrushing extends StateNode {
  static override id = "zoom_brushing"

  override onPointerMove(): void {
    this.editor.updateInstanceState({ zoomBrush: this.brush() })
  }

  override onPointerUp(): void {
    const brush = this.brush()
    this.editor.updateInstanceState({ zoomBrush: null })
    // A degenerate box is a click that wandered a pixel; zooming to it would
    // slam the camera to the maximum.
    if (brush.w > 4 && brush.h > 4) {
      this.editor.zoomToBounds(brush, { animation: { duration: this.editor.options.animationMediumMs } })
    }
    ;(this.parent as ZoomTool | null)?.returnToOriginatingTool()
  }

  override onCancel(): void {
    this.editor.updateInstanceState({ zoomBrush: null })
    this.parent!.transition("idle")
  }

  override onExit(): void {
    this.editor.updateInstanceState({ zoomBrush: null })
  }

  /** The dragged box, in page space. */
  private brush(): Box {
    const { originPagePoint, currentPagePoint } = this.editor.inputs
    return Box.FromPoints([Vec.From(originPagePoint), Vec.From(currentPagePoint)])
  }
}

/** Click, alt-click or drag a box to move the camera. */
export class ZoomTool extends StateNode {
  static override id = "zoom"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing, ZoomBrushing]

  /** The tool the user was in when they reached for zoom, if any. */
  info: { onInteractionEnd?: string } = {}

  override onEnter(info: { onInteractionEnd?: string } = {}): void {
    this.info = info
    // Zoom is a transient tool; showing it as the active toolbar button would
    // suggest the user has switched tools, which they have not.
    this.setCurrentToolIdMask(info.onInteractionEnd)
  }

  override onExit(): void {
    this.setCurrentToolIdMask(undefined)
    this.editor.updateInstanceState({ zoomBrush: null })
  }

  /** Go back to whatever tool the user was in, or to select. */
  returnToOriginatingTool(): void {
    this.editor.setCurrentTool(this.info.onInteractionEnd ?? "select")
  }
}
