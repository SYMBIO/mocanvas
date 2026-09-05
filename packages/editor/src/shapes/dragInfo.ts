/**
 * What a container shape is told while shapes are dragged across it.
 *
 * A container — a frame, a slot, a layout — has to answer four separate
 * questions during a drag: shapes have just arrived, they are still here, they
 * have left, they have been dropped. The callbacks are separate for that
 * reason, and they share one context object because the useful facts are the
 * same in all four: what the drag started from, and where each shape came from.
 *
 * `initialParentIds` and `initialIndices` are the load-bearing part. A shape
 * dragged out of a frame and back in again should return to the z-position it
 * had, not to the top of the stack; without a record of where it started there
 * is nothing to return it to.
 */
import type { IndexKey } from "@mocanvas/store"
import type { ParentId, ShapeId } from "../records/base"

/** The facts every drag callback receives. */
export interface TLDragShapesInfo {
  /** The shape under the pointer when the drag began, if any. */
  initialDraggingOverShapeId: ShapeId | null
  /** Each dragged shape's parent when the drag began. */
  initialParentIds: ReadonlyMap<ShapeId, ParentId>
  /** Each dragged shape's z-index when the drag began. */
  initialIndices: ReadonlyMap<ShapeId, IndexKey>
}

/** Shapes have just been dragged over this shape for the first time. */
export interface TLDragShapesInInfo extends TLDragShapesInfo {
  /** The shape they were over immediately before, if any. */
  prevDraggingOverShapeId: ShapeId | null
}

/**
 * Shapes are still being dragged over this shape.
 *
 * Fires as the pointer moves and on an interval while it is still, so a
 * container that lays its children out live keeps up with a slow drag.
 * Deliberately *not* gated by `canReceiveNewChildrenOfType`, so a container can
 * show "no" as clearly as it shows "yes".
 */
export type TLDragShapesOverInfo = TLDragShapesInfo

/** Shapes have been dragged away from this shape. */
export interface TLDragShapesOutInfo extends TLDragShapesInfo {
  /**
   * The shape they are being dragged into, if any.
   *
   * A container that reparents its children back to the page on the way out
   * must check this first: when the shapes are on their way into another
   * container, that container decides where they go.
   */
  nextDraggingOverShapeId: ShapeId | null
}

/** Shapes have been dropped while over this shape. */
export type TLDropShapesOverInfo = TLDragShapesInfo
