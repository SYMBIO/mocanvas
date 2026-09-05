/**
 * What the snapping system publishes, and the two halves of how it works.
 *
 * Snapping asks two questions that only look like one. Dragging a *shape*
 * around asks "do any of my edges or my centre line up with anything nearby?" —
 * a bounds question, answered by aligning discrete points. Dragging a *handle*
 * asks "is there something for this endpoint to attach to?" — a proximity
 * question, answered against points and outlines. {@link BoundsSnaps} and
 * {@link HandleSnaps} are those two, and `SnapManager` owns one of each.
 *
 * The indicators are separate from the result on purpose: what the drag should
 * do and what the person should be shown are different answers, and a tool that
 * applies a nudge without drawing anything is a legitimate (if unfriendly)
 * choice.
 */
import { Box, Vec, type VecLike } from "../geometry"
import type { ShapeId, UnknownShape } from "../records/base"
import type { ShapeHandle } from "./events"
import type { TLResizeHandle } from "../shapes/resize"
import type { BoundsSnapPoint } from "../shapes/snapGeometry"
import type { Editor } from "./Editor"
import type { SnapManager } from "./SnapManager"

/**
 * How far a snap moved the thing being dragged.
 *
 * Always an adjustment rather than a position: the caller has already worked
 * out where the gesture wants to be, and snapping only ever nudges that. A zero
 * nudge means nothing snapped, which callers can apply unconditionally.
 */
export interface SnapData {
  nudge: Vec
}

/**
 * "These points are in a line." The indicator drawn when edges or centres align.
 *
 * `points` are in page space and are the *aligned* points themselves, not the
 * line through them — the renderer decides how far to extend the line, which is
 * a visual decision that depends on the zoom.
 */
export interface PointsSnapIndicator {
  id: string
  type: "points"
  points: VecLike[]
}

/**
 * "These gaps are equal." The indicator drawn when a shape is being spaced
 * evenly between others.
 *
 * Each gap is the pair of facing edges that bound it, so the renderer can draw
 * the end caps in the right places without recomputing which shapes were
 * involved.
 */
export interface GapsSnapIndicator {
  id: string
  type: "gaps"
  /** Which axis the gaps run along. */
  direction: "horizontal" | "vertical"
  gaps: {
    startEdge: [VecLike, VecLike]
    endEdge: [VecLike, VecLike]
  }[]
}

/** Something the canvas draws to explain a snap. */
export type SnapIndicator = PointsSnapIndicator | GapsSnapIndicator

/** What {@link BoundsSnaps.snapTranslateShapes} is asked. */
export interface BoundsSnapTranslateOptions {
  /** The dragged selection's page bounds as they were when the drag started. */
  initialSelectionPageBounds: Box
  /**
   * The snap points the dragged selection offers, in page space at the start of
   * the drag. Passed in rather than recomputed because they do not change
   * during the gesture, and recomputing them per pointer move is the single
   * most expensive thing snapping could do.
   */
  initialSelectionSnapPoints: BoundsSnapPoint[]
  /** How far the gesture wants to move, before snapping. */
  dragDelta: Vec
  /** An axis the gesture is constrained to, or `null`. */
  lockedAxis: "x" | "y" | null
}

/** What {@link BoundsSnaps.snapResizeShapes} is asked. */
export interface BoundsSnapResizeOptions {
  /** The selection's page bounds as they were when the resize started. */
  initialSelectionPageBounds: Box
  /** How far the handle has been dragged. */
  dragDelta: Vec
  /**
   * Which corner or edge is being dragged. Only the moving edges are snapped —
   * snapping the fixed edge would move the shape rather than resize it.
   */
  handle: TLResizeHandle
  /** Whether the resize is constrained to the selection's aspect ratio. */
  isAspectRatioLocked: boolean
  /** Whether the opposite edge moves too, keeping the centre fixed. */
  isResizingFromCenter: boolean
}

/**
 * Bounds snapping: aligning a dragged or resized selection's edges and centres
 * with those of the shapes around it.
 *
 * Reached as `editor.snaps.shapeBounds`.
 */
export class BoundsSnaps {
  readonly editor: Editor

  constructor(readonly manager: SnapManager) {
    this.editor = manager.editor
  }

  /**
   * The page-space points a shape offers as snap targets.
   *
   * A shape util may name its own through `getBoundsSnapGeometry`; a shape that
   * names none contributes its four corners and its centre, which is what
   * almost every shape wants. A util that returns an *empty* list is saying
   * something different — that it should not be snapped to at all.
   */
  getSnapPoints(shapeId: ShapeId): BoundsSnapPoint[] {
    const shape = this.editor.getShape<UnknownShape>(shapeId)
    if (!shape) return []
    const util = this.editor.getShapeUtil<UnknownShape>(shape)
    const geometry = util.getBoundsSnapGeometry?.(shape)
    const transform = this.editor.getShapePageTransform(shape)

    if (geometry?.points) {
      if (!transform) return geometry.points.map((point) => ({ ...point }))
      return geometry.points.map((point) => {
        const moved = transform.applyToPoint(point)
        return { ...point, x: moved.x, y: moved.y }
      })
    }

    const bounds = this.editor.getShapePageBounds(shape)
    if (!bounds) return []
    return [
      { id: "top-left", x: bounds.minX, y: bounds.minY, handle: "top_left" },
      { id: "top-right", x: bounds.maxX, y: bounds.minY, handle: "top_right" },
      { id: "bottom-right", x: bounds.maxX, y: bounds.maxY, handle: "bottom_right" },
      { id: "bottom-left", x: bounds.minX, y: bounds.maxY, handle: "bottom_left" },
      { id: "center", x: bounds.midX, y: bounds.midY },
    ]
  }

  /**
   * Snap a translation. Returns the extra nudge to add to `dragDelta`, and
   * publishes the indicators that explain it.
   */
  snapTranslateShapes({
    initialSelectionPageBounds,
    dragDelta,
    lockedAxis,
  }: BoundsSnapTranslateOptions): SnapData {
    const moving = new Box(
      initialSelectionPageBounds.x + dragDelta.x,
      initialSelectionPageBounds.y + dragDelta.y,
      initialSelectionPageBounds.w,
      initialSelectionPageBounds.h,
    )
    // A locked axis is the axis the gesture may move along, so the *other* one
    // is already fixed and must not be nudged.
    const result = this.manager.snapTranslate(moving, this.draggedIds(), {
      ...(lockedAxis === "x" ? { lockY: true } : {}),
      ...(lockedAxis === "y" ? { lockX: true } : {}),
    })
    return { nudge: result.nudge }
  }

  /**
   * Snap a resize. Only the edges the handle actually moves are considered, so
   * a bottom-right drag never nudges the top-left corner.
   */
  snapResizeShapes({
    initialSelectionPageBounds,
    dragDelta,
    handle,
    isAspectRatioLocked,
    isResizingFromCenter,
  }: BoundsSnapResizeOptions): SnapData {
    // An aspect-locked resize has one degree of freedom, and nudging it on
    // either axis independently would break the ratio the person is holding.
    if (isAspectRatioLocked) return { nudge: new Vec(0, 0) }

    const current = resizedBounds(initialSelectionPageBounds, dragDelta, handle, isResizingFromCenter)
    // A handle that only moves along one axis must not be snapped on the other:
    // the fixed edge is what the person is resizing *against*.
    const lockX = handle === "top" || handle === "bottom"
    const lockY = handle === "left" || handle === "right"
    const result = this.manager.snapTranslate(current, this.draggedIds(), {
      ...(lockX ? { lockX: true } : {}),
      ...(lockY ? { lockY: true } : {}),
    })
    return { nudge: result.nudge }
  }

  /** The selection's ids, which are never their own snap targets. */
  private draggedIds(): Set<ShapeId> {
    return new Set<ShapeId>(this.editor.getSelectedShapeIds())
  }
}

/** Where a resize handle drag would put the selection's box, before snapping. */
function resizedBounds(initial: Box, delta: Vec, handle: TLResizeHandle, fromCenter: boolean): Box {
  const movesLeft = handle === "left" || handle === "top_left" || handle === "bottom_left"
  const movesRight = handle === "right" || handle === "top_right" || handle === "bottom_right"
  const movesTop = handle === "top" || handle === "top_left" || handle === "top_right"
  const movesBottom = handle === "bottom" || handle === "bottom_left" || handle === "bottom_right"

  let { minX, minY, maxX, maxY } = initial
  if (movesLeft) minX += delta.x
  if (movesRight) maxX += delta.x
  if (movesTop) minY += delta.y
  if (movesBottom) maxY += delta.y
  // Resizing from the centre mirrors every edge move onto its opposite.
  if (fromCenter) {
    if (movesLeft) maxX -= delta.x
    if (movesRight) minX -= delta.x
    if (movesTop) maxY -= delta.y
    if (movesBottom) minY -= delta.y
  }
  return new Box(Math.min(minX, maxX), Math.min(minY, maxY), Math.abs(maxX - minX), Math.abs(maxY - minY))
}

/** What {@link HandleSnaps.snapHandle} is asked. */
export interface HandleSnapOptions {
  /** The shape whose handle is being dragged. */
  currentShapeId: ShapeId
  /**
   * The handle, in the dragged shape's local space — the same object the shape
   * util produced, so its `id` can be used to ask that shape for the targets it
   * offers its *own* handles.
   */
  handle: ShapeHandle
}

/**
 * Handle snapping: finding somewhere for a dragged endpoint to land.
 *
 * Reached as `editor.snaps.handles`. Distinct from bounds snapping because the
 * answer is a *point*, not an alignment: an arrow endpoint dropped near a
 * rectangle should attach to the rectangle's outline, which has nothing to do
 * with whether any edges line up.
 */
export class HandleSnaps {
  readonly editor: Editor

  constructor(readonly manager: SnapManager) {
    this.editor = manager.editor
  }

  /**
   * Where a dragged handle should actually go, or `null` when nothing is close
   * enough.
   *
   * Discrete points win over outlines within the same threshold: a point is a
   * deliberate target a shape offered, while an outline is a continuum, and
   * landing exactly on a named point is almost always what was meant.
   */
  snapHandle({ currentShapeId, handle }: HandleSnapOptions): SnapData | null {
    const threshold = this.manager.getSnapThreshold()
    const handleId = handle.id
    const current = this.editor.getShape<UnknownShape>(currentShapeId)
    const currentTransform = current ? this.editor.getShapePageTransform(current) : undefined
    const point = currentTransform ? currentTransform.applyToPoint(handle) : Vec.From(handle)

    let best: { distance: number; target: Vec } | null = null
    const consider = (candidate: VecLike): void => {
      const target = Vec.From(candidate)
      const distance = Vec.Dist(point, target)
      if (distance > threshold) return
      if (best && best.distance <= distance) return
      best = { distance, target }
    }

    for (const shape of this.manager.getSnappableShapes()) {
      const util = this.editor.getShapeUtil<UnknownShape>(shape)
      const geometry = util.getHandleSnapGeometry?.(shape)
      if (!geometry) continue
      const transform = this.editor.getShapePageTransform(shape)

      const isSelf = shape.id === currentShapeId
      const points = isSelf ? (geometry.getSelfSnapPoints?.(handleId) ?? []) : (geometry.points ?? [])
      for (const candidate of points) consider(transform ? transform.applyToPoint(candidate) : candidate)

      const outline = isSelf ? (geometry.getSelfSnapOutline?.(handleId) ?? null) : (geometry.outline ?? null)
      if (!outline) continue
      // Nearest point on the outline is computed in shape space, then brought
      // back: the outline geometry has no idea where its shape sits on the page.
      const local = transform ? transform.clone().invert().applyToPoint(point) : point
      const nearest = outline.nearestPoint(local)
      consider(transform ? transform.applyToPoint(nearest) : nearest)
    }

    if (!best) return null
    const found = best as { distance: number; target: Vec }
    return { nudge: Vec.Sub(found.target, point) }
  }
}
