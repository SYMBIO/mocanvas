/**
 * The two overlays that make arrow binding legible.
 *
 * Binding is the one arrow behaviour with no visible geometry of its own: an
 * arrow that is *attached* to a rectangle and one that merely *ends near* it
 * look identical, right up until you move the rectangle and only one of them
 * follows. Both overlays here exist to close that gap.
 *
 * - {@link ArrowHintOverlayUtil} answers "will this bind?" while a terminal is
 *   being dragged — it outlines the shape that is about to be caught.
 * - {@link ArrowBindingHintOverlayUtil} answers "is this bound?" for an arrow
 *   already on the page — it marks each bound terminal with a dot on the
 *   anchor it is attached to.
 */
import {
  getOverlayDisplayValues,
  OverlayUtil,
  type Editor,
  type Geometry2d,
  type OverlayOptionsWithDisplayValues,
  type TLColorMode,
  type TLTheme,
  type UnknownBinding,
  type UnknownShape,
} from "@mocanvas/editor"
import { hairline, withCamera } from "./paint"
import type { OverlayBox, TLArrowBindingHintOverlay, TLArrowHintOverlay } from "./types"

/** The paint an arrow hint is drawn with. */
export interface ArrowHintOverlayUtilDisplayValues {
  /** Outline colour of the shape about to be bound to. */
  stroke: string
}

/** How the "will bind" outline is drawn. */
export interface ArrowHintOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<ArrowHintOverlayUtilDisplayValues> {
  /** Outline weight, in CSS pixels. */
  lineWidth: number
  /** Dash pattern, in CSS pixels. Empty for a continuous outline. */
  lineDash: readonly number[]
  /** How far outside the shape's bounds the outline sits, in CSS pixels. */
  inset: number
}

/**
 * The theme's `hint` colour, not `selectStroke`.
 *
 * A binding target is not selected and must not look selected — the whole
 * point of the outline is that it means something else.
 */
export const DEFAULT_ARROW_HINT_OVERLAY_OPTIONS: ArrowHintOverlayUtilOptions = {
  lineWidth: 2,
  lineDash: [4, 3],
  inset: -3,
  getDefaultDisplayValues: (_editor: unknown, theme: TLTheme, colorMode: TLColorMode) => ({
    stroke: theme.colors[colorMode].hint,
  }),
}

/**
 * Outlines the shape an arrow terminal is about to bind to.
 *
 * SEMANTICS-ASSUMED: which shapes count as "about to bind". The documented
 * surface names the overlay but does not say where its state comes from, and
 * mocanvas has no arrow-target state object. The hinting shape ids are the
 * editor's existing "a gesture in flight is aiming at this shape" channel —
 * `Editor.setHintingShapes`, which the select tool already drives for drop
 * targets — so an arrow tool sets them the same way and this util reads them.
 * The util narrows to the arrow case by only being active while an arrow is the
 * thing being drawn or edited; a drop-target hint during a plain drag stays
 * with the shape indicator compositor, which draws it heavier rather than
 * dashed.
 */
export class ArrowHintOverlayUtil extends OverlayUtil<Editor, ArrowHintOverlayUtilOptions> {
  static override type = "arrowHint"
  static override zIndex = 25
  static override options: ArrowHintOverlayUtilOptions = DEFAULT_ARROW_HINT_OVERLAY_OPTIONS

  /**
   * Whether an arrow gesture is what is producing the hints.
   *
   * Either the arrow tool is drawing one, or an arrow is selected and one of
   * its terminals is being dragged — in both cases the hints on screen are
   * binding targets rather than reparenting targets.
   */
  protected isArrowGestureActive(): boolean {
    const editor = this.editor
    if (editor.getCurrentToolId() === "arrow") return true
    const shape = editor.getOnlySelectedShape()
    return shape?.type === "arrow"
  }

  override isActive(): boolean {
    return this.isArrowGestureActive() && this.editor.getHintingShapeIds().length > 0
  }

  override getOverlays(): TLArrowHintOverlay[] {
    if (!this.isArrowGestureActive()) return []
    const editor = this.editor
    const out: TLArrowHintOverlay[] = []
    for (const shape of editor.getHintingShapes()) {
      // A hinted arrow is the arrow being drawn, not a target for it.
      if (shape.type === "arrow") continue
      const bounds = editor.getShapePageBounds(shape)
      if (!bounds) continue
      out.push({
        id: shape.id,
        type: "arrowHint",
        shapeId: shape.id,
        bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } satisfies OverlayBox,
      })
    }
    return out
  }

  /** The hint is feedback about the drag in flight; it cannot be pointed at. */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }

  /** The colour to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): ArrowHintOverlayUtilDisplayValues {
    return getOverlayDisplayValues<ArrowHintOverlayUtilDisplayValues>(this)
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const { lineWidth, lineDash, inset } = this.options
    const stroke = this.getDisplayValues().stroke
    withCamera(ctx, camera, (c) => {
      c.strokeStyle = stroke
      c.lineWidth = hairline(lineWidth, zoom)
      // Dashes are given in CSS pixels for the same reason the width is, so
      // they take the same division to survive the camera transform.
      c.setLineDash(lineDash.map((d) => hairline(d, zoom)))
      const pad = hairline(inset, zoom)
      for (const overlay of overlays) {
        const { x, y, w, h } = overlay.bounds
        c.beginPath()
        c.rect(x + pad, y + pad, w - pad * 2, h - pad * 2)
        c.stroke()
      }
    })
  }
}

/** The paint a bound-terminal marker is drawn with. */
export interface ArrowBindingHintOverlayUtilDisplayValues {
  /** Body of the anchor dot. */
  fill: string
  /** Ring round the anchor dot, so it stays visible on a shape of the same colour. */
  stroke: string
}

/** How the anchor dot is drawn. */
export interface ArrowBindingHintOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<ArrowBindingHintOverlayUtilDisplayValues> {
  /** Dot radius, in CSS pixels. */
  radius: number
  /** Ring weight, in CSS pixels. */
  lineWidth: number
}

/** A small hint-coloured dot with a paper-coloured ring. */
export const DEFAULT_ARROW_BINDING_HINT_OVERLAY_OPTIONS: ArrowBindingHintOverlayUtilOptions = {
  radius: 3.5,
  lineWidth: 1.5,
  getDefaultDisplayValues: (_editor: unknown, theme: TLTheme, colorMode: TLColorMode) => {
    const colors = theme.colors[colorMode]
    return { fill: colors.hint, stroke: colors.solid }
  },
}

/** An arrow binding, in the only two fields this overlay needs from it. */
interface ArrowBindingLike extends UnknownBinding {
  props: { terminal?: "start" | "end"; normalizedAnchor?: { x: number; y: number } }
}

/**
 * Marks the anchor each bound terminal of the selected arrow is attached to.
 *
 * Only for a selected arrow: the dots are an editing aid, and drawing one on
 * every bound terminal on the page would bury the board in them.
 *
 * The binding is read structurally — `props.terminal` and
 * `props.normalizedAnchor` off a binding of type `arrow` — rather than through
 * the arrow shape's own helpers. That keeps this file out of the shape and
 * binding modules entirely, which matters because the package barrel loads the
 * overlays before either of them.
 */
export class ArrowBindingHintOverlayUtil extends OverlayUtil<Editor, ArrowBindingHintOverlayUtilOptions> {
  static override type = "arrowBindingHint"
  static override zIndex = 26
  static override options: ArrowBindingHintOverlayUtilOptions = DEFAULT_ARROW_BINDING_HINT_OVERLAY_OPTIONS

  /** The arrows whose bindings are worth marking: the selected ones. */
  protected getArrows(): UnknownShape[] {
    return this.editor.getSelectedShapes().filter((shape) => shape.type === "arrow")
  }

  override isActive(): boolean {
    return this.getArrows().length > 0
  }

  override getOverlays(): TLArrowBindingHintOverlay[] {
    const editor = this.editor
    const out: TLArrowBindingHintOverlay[] = []
    for (const arrow of this.getArrows()) {
      for (const binding of editor.getBindingsFromShape<ArrowBindingLike>(arrow, "arrow")) {
        const terminal = binding.props?.terminal
        const anchor = binding.props?.normalizedAnchor
        if (!terminal || !anchor) continue
        const target = editor.getShape(binding.toId)
        if (!target) continue
        const local = editor.getShapeGeometryBounds(target)
        const m = editor.getShapePageTransform(target)
        if (!local) continue
        // The anchor is normalized against the target's geometry bounds, which
        // is what lets it survive the target being resized.
        const x = local.x + local.w * anchor.x
        const y = local.y + local.h * anchor.y
        out.push({
          id: `${arrow.id}:${terminal}`,
          type: "arrowBindingHint",
          arrowId: arrow.id,
          boundShapeId: target.id,
          terminal,
          point: { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f },
        })
      }
    }
    return out
  }

  /** A marker, not a control: dragging the terminal is the arrow handle's job. */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }

  /** The colours to draw with, read fresh from the theme on every frame. */
  getDisplayValues(): ArrowBindingHintOverlayUtilDisplayValues {
    return getOverlayDisplayValues<ArrowBindingHintOverlayUtilDisplayValues>(this)
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const display = this.getDisplayValues()
    const { radius, lineWidth } = this.options
    withCamera(ctx, camera, (c) => {
      c.fillStyle = display.fill
      c.strokeStyle = display.stroke
      c.lineWidth = hairline(lineWidth, zoom)
      const r = hairline(radius, zoom)
      for (const overlay of overlays) {
        c.beginPath()
        c.arc(overlay.point.x, overlay.point.y, r, 0, Math.PI * 2)
        c.fill()
        c.stroke()
      }
    })
  }
}
