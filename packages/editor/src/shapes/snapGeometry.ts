/**
 * What a shape offers the snapping system.
 *
 * Snapping asks a shape two different questions, and they have two different
 * answers. *Bounds* snapping — dragging a whole shape around — needs a handful
 * of discrete points to align against (the corners and centre of a box, the
 * tips of an arrow). *Handle* snapping — dragging one handle of one shape onto
 * another — needs somewhere for that handle to land: points to click onto, and
 * an outline to slide along.
 *
 * Both contracts are answered by {@link ShapeUtil.getBoundsSnapGeometry} and
 * {@link ShapeUtil.getHandleSnapGeometry} in **shape-local** coordinates; the
 * snap manager applies the shape's page transform.
 */
import type { Geometry2d, VecLike } from "../geometry"

/**
 * One point a dragged shape's own points may align to.
 *
 * `id` is stable for the life of the shape and identifies the point across
 * frames, so an indicator drawn for "the top-left corner of that frame" keeps
 * pointing at the same thing while the drag continues. `handle` names the
 * selection handle the point corresponds to, when it corresponds to one.
 */
export interface BoundsSnapPoint extends VecLike {
  /** Stable within one shape; the snap manager namespaces it by shape id. */
  id: string
  /** Which corner/edge this point is, when it is one. */
  handle?: string
}

/**
 * The points a shape contributes to bounds snapping.
 *
 * Omitting `points` means "use my bounds" — the manager falls back to the four
 * corners and the centre of the shape's geometry bounds, which is what almost
 * every shape wants. Returning an **empty array** is the opposite instruction:
 * this shape contributes nothing and cannot be snapped to.
 */
export interface BoundsSnapGeometry {
  points?: BoundsSnapPoint[]
}

/**
 * Where a dragged *handle* may land on this shape.
 *
 * - `points` are discrete targets: a handle within the snap threshold of one
 *   jumps exactly onto it.
 * - `outline` is a continuous target: a handle near it slides to the nearest
 *   point along it, which is how an arrow stays attached to the edge of a shape
 *   while the shape is reshaped.
 * - `getSelfSnapPoints` / `getSelfSnapOutline` answer the same two questions
 *   for the shape *being dragged* — a line's own earlier vertices, which it
 *   should snap to even though it is not a separate shape.
 */
export interface HandleSnapGeometry {
  points?: VecLike[]
  /** `null` means "no outline to slide along", which is not the same as "use my geometry". */
  outline?: Geometry2d | null
  /** Points on the shape being dragged that its own handle may snap to. */
  getSelfSnapPoints?(handleId: string): VecLike[]
  /** The outline of the shape being dragged that its own handle may slide along. */
  getSelfSnapOutline?(handleId: string): Geometry2d | null
}
