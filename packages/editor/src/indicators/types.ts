/**
 * The v5 indicator model: a shape's selection outline is a **canvas path**, not
 * a React tree.
 *
 * A util returns geometry in *shape-local* coordinates and says nothing about
 * paint: the compositor ({@link ShapeIndicatorCompositor}) applies the shape's
 * page transform, picks the stroke colour out of the live theme and sets a
 * zoom-independent stroke width. That split is what lets indicators be drawn in
 * one canvas pass instead of one DOM node per selected shape.
 */

/**
 * A composed indicator: an outline, an optional hole punched in it, and extra
 * strokes drawn outside that hole.
 *
 * The three parts exist because a container's outline usually has to make room
 * for something drawn over it — a frame's name strip, a section's heading. The
 * compositor draws them in this order:
 *
 * 1. `clipPath` is installed as an **even-odd** clip. An outer rectangle plus a
 *    label rectangle therefore clips to "everything except the label", so the
 *    part of the outline that would run behind the label is not painted.
 * 2. `path` is stroked inside that clip.
 * 3. `additionalPaths` are stroked with the clip removed, so a util can draw
 *    the box *around* the label it just punched out.
 */
export interface TLIndicatorPath {
  /** The outline, stroked under `clipPath`. Shape-local coordinates. */
  path: Path2D
  /** An even-odd clip applied before `path` is stroked. */
  clipPath?: Path2D
  /** Strokes drawn after `path`, with no clip. */
  additionalPaths?: Path2D[]
  /**
   * Dash pattern for the whole indicator, **in CSS pixels** — so it stays the
   * same on screen at every zoom, exactly like the stroke width. Omit for a
   * continuous stroke.
   *
   * SEMANTICS-ASSUMED: a mocanvas addition, not part of the v5 shape. The old
   * SVG indicators could set `stroke-dasharray` for themselves (a group's
   * outline does); moving paint into the compositor took that away, and this
   * gives it back without letting a util set colours or widths it should not
   * own. A util that never sets it behaves exactly as the v5 model describes.
   */
  lineDash?: readonly number[]
}

/**
 * What `ShapeUtil.getIndicatorPath` may return: a bare `Path2D` (the common
 * case), a composed {@link TLIndicatorPath}, or `undefined` to draw nothing.
 *
 * `undefined` means "nothing", not "use the default": a util that wants the
 * default bounds rectangle simply does not implement the method at all.
 */
export type TLIndicatorPathResult = Path2D | TLIndicatorPath | undefined

/**
 * Why a shape is showing an indicator. The context picks the stroke weight:
 * `hinting` is heavier so a drop target reads as "it will land here" rather
 * than "it is selected".
 */
export type TLIndicatorContext = "selected" | "hovered" | "hinting"

/** A 2×3 affine matrix, in the `a b c d e f` order `CanvasRenderingContext2D` takes. */
export interface TLIndicatorTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * One indicator, fully resolved: the paths to stroke, the page transform to
 * stroke them under, and the paint to use.
 *
 * Produced by {@link ShapeIndicatorCompositor.getIndicators} and consumed by
 * its `render`. Keeping the two apart is what makes the compositor testable
 * without a canvas: the interesting decisions (which shapes, which weight,
 * which colour) all land in this record.
 */
export interface TLIndicatorOverlay {
  /** The shape this outline belongs to. */
  shapeId: string
  /** Why it is being drawn. */
  context: TLIndicatorContext
  /** The shape's page transform. */
  transform: TLIndicatorTransform
  /** The resolved paths, in shape-local coordinates. */
  paths: TLIndicatorPath
  /** Stroke colour, a CSS colour string from the live theme. */
  color: string
  /** Stroke width **in CSS pixels** — the compositor divides it by the zoom. */
  lineWidth: number
}
