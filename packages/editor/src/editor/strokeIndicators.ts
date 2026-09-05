/**
 * Painting selection outlines for many shapes in one pass.
 *
 * A selection of two hundred shapes used to be two hundred DOM nodes, each with
 * its own transform, restyled on every camera move. The v5 model makes an
 * indicator a `Path2D` in shape-local coordinates instead, which means the
 * whole selection can be stroked onto one canvas in a single loop — and, more
 * usefully, that the same code can stroke them into an export.
 *
 * This is that loop, taking the context and the shapes explicitly so it works
 * on the live overlay canvas, on an offscreen canvas, or on an export surface.
 */
import { getShapeIndicatorPath, type IndicatorPathSource } from "../indicators/resolve"
import type { UnknownShape } from "../records/base"
import type { Editor } from "./Editor"

/** How the indicators should look. */
export interface StrokeShapeIndicatorsOptions {
  /** Stroke colour. Defaults to the current theme's selection stroke. */
  color?: string
  /**
   * Stroke width **in CSS pixels**, not page units.
   *
   * An indicator is a piece of UI drawn over the canvas, not a mark on it: it
   * has to stay the same weight at every zoom, or a selection becomes
   * invisible when you zoom out and a slab when you zoom in.
   */
  strokeWidth?: number
  /** Dash pattern in CSS pixels. Omit for a continuous stroke. */
  lineDash?: readonly number[]
  /** The camera zoom, so the CSS-pixel widths above can be converted. Defaults to the editor's. */
  zoom?: number
}

/**
 * Stroke the indicator outline of each shape onto `ctx`.
 *
 * The context is expected to already be in **page space** — the caller has
 * applied the camera — so this only applies each shape's own page transform.
 * Doing it the other way round would mean re-deriving the camera per shape.
 *
 * Shapes still on the deprecated React `indicator()` hook are skipped rather
 * than approximated: their outline is drawn by the SVG layer, and drawing a
 * bounds rectangle here as well would double every one of them.
 */
export function strokeShapeIndicators(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  shapes: readonly UnknownShape[],
  options: StrokeShapeIndicatorsOptions = {},
): void {
  if (shapes.length === 0) return

  const zoom = options.zoom ?? editor.getZoomLevel()
  const color = options.color ?? editor.getCurrentTheme().colors[editor.getColorMode()].selectStroke
  const strokeWidth = (options.strokeWidth ?? 1.5) / zoom

  ctx.save()
  ctx.strokeStyle = typeof color === "string" ? color : "#000"
  ctx.lineWidth = strokeWidth
  ctx.lineJoin = "round"
  ctx.lineCap = "round"

  for (const shape of shapes) {
    const util = editor.getShapeUtil<UnknownShape>(shape) as unknown as IndicatorPathSource<UnknownShape>
    const bounds = editor.getShapeGeometry(shape)?.bounds
    const composed = getShapeIndicatorPath(util, shape, bounds)
    if (!composed) continue

    const transform = editor.getShapePageTransform(shape)
    ctx.save()
    if (transform) {
      const { a, b, c, d, e, f } = transform
      ctx.transform(a, b, c, d, e, f)
    }

    const dash = options.lineDash ?? composed.lineDash
    ctx.setLineDash(dash ? dash.map((n) => n / zoom) : [])

    if (composed.clipPath) {
      // Even-odd, so an outer rectangle plus a label rectangle clips to
      // "everything except the label" — which is how a frame's outline makes
      // room for its own name strip instead of running behind it.
      ctx.save()
      ctx.clip(composed.clipPath, "evenodd")
      ctx.stroke(composed.path)
      ctx.restore()
    } else {
      ctx.stroke(composed.path)
    }

    // Drawn after the clip is gone, so a util can stroke the box *around* the
    // label it just punched out.
    for (const extra of composed.additionalPaths ?? []) ctx.stroke(extra)

    ctx.restore()
  }

  ctx.restore()
}
