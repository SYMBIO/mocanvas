/**
 * Resizing a shape, and the vocabulary that goes with it.
 *
 * A shape util's `onResize` is handed a scale factor and a new position and has
 * to decide what that means for its own props. For anything box-shaped the
 * answer is always the same, and {@link resizeBox} is it; for a shape whose
 * contents should scale rather than reflow — text at a fixed number of lines,
 * an image — {@link resizeScaled} is the other answer.
 */
import type { ResizeInfo } from "./ShapeUtil"
import type { SelectionHandle, ShapeHandle } from "../editor/events"
import type { UnknownShape } from "../records/base"

/** A shape with `w` and `h` props: the shape {@link resizeBox} knows how to resize. */
export type TLBaseBoxShape = UnknownShape & { props: { w: number; h: number } }

/**
 * The handles a resize can be driven from.
 *
 * A subset of {@link SelectionHandle}: the rotate handles are on the same
 * selection frame but start a different gesture, and typing them out of the
 * resize vocabulary is what stops a resize handler having to consider them.
 */
export type TLResizeHandle = Extract<
  SelectionHandle,
  "top" | "right" | "bottom" | "left" | "top_left" | "top_right" | "bottom_left" | "bottom_right"
>

/**
 * What a resize means for the shape's contents.
 *
 * - `resize_bounds` — the shape's box changes and its contents reflow. Dragging
 *   a handle does this.
 * - `scale_shape` — everything scales together, contents included. This is what
 *   a proportional resize of a whole selection does, and what a shape inside a
 *   scaled group receives.
 */
export type TLResizeMode = ResizeInfo<UnknownShape>["mode"]

/** What a handle-drag callback is told. */
export interface TLHandleDragInfo<T extends UnknownShape = UnknownShape> {
  /** The handle being dragged, in shape-local coordinates. */
  handle: ShapeHandle
  /**
   * Whether the drag should ignore snapping and land exactly where the pointer
   * is. Held-modifier behaviour, surfaced so a util can honour it in its own
   * placement logic too.
   */
  isPrecise: boolean
  /** The shape as it was when the drag started, for gestures that need a baseline. */
  initial?: T | undefined
}

/** Bounds a {@link resizeBox} result is clamped to. */
export interface ResizeBoxOptions {
  minWidth?: number | undefined
  maxWidth?: number | undefined
  minHeight?: number | undefined
  maxHeight?: number | undefined
}

/**
 * The default resize for a box-shaped shape.
 *
 * Handles the three things every box shape gets wrong when it writes this
 * itself: a negative scale (dragging a handle past the opposite edge, which
 * should flip the box rather than give it a negative width), the position
 * change that a flip implies, and clamping to a minimum size without letting
 * the box drift while it is clamped.
 *
 * Returns the props to merge into the shape, so a util can post-process the
 * result: `return { ...resizeBox(shape, info), props: { ...} }`.
 */
export function resizeBox<T extends TLBaseBoxShape>(
  shape: T,
  info: ResizeInfo<T>,
  opts: ResizeBoxOptions = {},
): Partial<T> {
  const { initialShape, initialBounds, scaleX, scaleY, newPoint } = info
  const { minWidth = 1, minHeight = 1, maxWidth = Number.POSITIVE_INFINITY, maxHeight = Number.POSITIVE_INFINITY } = opts

  const unclampedW = initialShape.props.w * scaleX
  const unclampedH = initialShape.props.h * scaleY

  const w = clamp(Math.abs(unclampedW), minWidth, maxWidth)
  const h = clamp(Math.abs(unclampedH), minHeight, maxHeight)

  let { x, y } = newPoint
  // A negative scale means the handle has crossed the opposite edge. The box
  // itself is always positive, so the flip has to show up as a position change:
  // the shape's origin moves to what used to be its far edge.
  if (scaleX < 0) x += w
  if (scaleY < 0) y += h

  // Clamping changes the size after the position was computed from the
  // unclamped one, which would let the shape creep while it is pinned at its
  // minimum. Give the difference back, on the side the handle is not on.
  if (scaleX < 0 && w !== Math.abs(unclampedW)) x -= w - Math.abs(unclampedW)
  if (scaleY < 0 && h !== Math.abs(unclampedH)) y -= h - Math.abs(unclampedH)

  void initialBounds
  return { x, y, props: { ...shape.props, w, h } } as Partial<T>
}

/**
 * Resize by scaling the whole shape, including whatever `scale` prop it keeps.
 *
 * For shapes whose contents must not reflow: text that should keep its line
 * breaks, a note whose font should grow with the box. The scale factor is the
 * smaller of the two axes, so the shape stays proportional however the handle
 * is dragged.
 *
 * SEMANTICS-ASSUMED: the shape's own scale is read from and written to a
 * numeric `props.scale`, which is the convention every scaling shape in this
 * library uses; a shape without one is scaled in size only.
 */
export function resizeScaled<T extends TLBaseBoxShape>(shape: T, info: ResizeInfo<T>): Partial<T> {
  const { initialShape, scaleX, scaleY, newPoint } = info
  const factor = Math.min(Math.abs(scaleX), Math.abs(scaleY))

  const props = initialShape.props as { w: number; h: number; scale?: number }
  const w = Math.max(1, props.w * factor)
  const h = Math.max(1, props.h * factor)

  let { x, y } = newPoint
  if (scaleX < 0) x += w
  if (scaleY < 0) y += h

  const next: Record<string, unknown> = { ...shape.props, w, h }
  if (typeof props.scale === "number") next.scale = props.scale * factor

  return { x, y, props: next } as Partial<T>
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}
