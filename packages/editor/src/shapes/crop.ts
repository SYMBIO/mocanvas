/**
 * The cropping contract a shape util sees.
 *
 * Cropping is *not* resizing: the shape's box changes while the content inside
 * it stays the size it was, and the shape remembers which part of that content
 * is showing. That memory is {@link TLShapeCrop} — a window over the original,
 * in normalized `0…1` coordinates, so it survives the shape being scaled
 * afterwards.
 */
import type { VecLike } from "../geometry"
import type { SelectionHandle } from "../editor/events"

/**
 * The visible window over a croppable shape's content, in normalized
 * coordinates: `{ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } }` is
 * the whole thing.
 *
 * Normalized rather than absolute on purpose — an image cropped to its middle
 * third stays cropped to its middle third when the shape is resized, and the
 * crop needs no knowledge of the source's pixel dimensions to be applied.
 */
export interface TLShapeCrop {
  topLeft: VecLike
  bottomRight: VecLike
  /** Whether the crop window is a circle inscribed in that rectangle. */
  isCircle?: boolean
}

/**
 * A crop in progress, handed to {@link ShapeUtil.onCrop}.
 *
 * SEMANTICS-ASSUMED: the field set mirrors {@link ResizeInfo}, which is the
 * gesture this one is the sibling of — the handle being dragged, the movement
 * so far, and the shape as it was when the gesture started, so a util can
 * always recompute from the original instead of accumulating rounding error.
 * `uncroppedSize` is what the shape's box would be showing the whole content at
 * the current scale, which is what a util needs to convert a pixel drag into a
 * normalized crop.
 */
export interface TLCropInfo<T extends { props: object }> {
  /** Which corner or edge is being dragged. */
  handle: SelectionHandle
  /** Movement since the gesture started, in the shape's own space. */
  change: VecLike
  /** The crop as it stands this frame. */
  crop: TLShapeCrop
  /** The size the shape's box would have if nothing were cropped away. */
  uncroppedSize: { w: number; h: number }
  /** The shape as it was when the crop gesture began. */
  initialShape: T
}

/** The whole of the content: the crop a shape starts out with. */
export function getDefaultCrop(): TLShapeCrop {
  return { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } }
}

/** Whether `crop` hides nothing — the case a util can skip drawing a crop for. */
export function isFullCrop(crop: TLShapeCrop | null | undefined): boolean {
  if (!crop) return true
  return crop.topLeft.x === 0 && crop.topLeft.y === 0 && crop.bottomRight.x === 1 && crop.bottomRight.y === 1
}

/**
 * The size the content would occupy uncropped, given the shape's current box.
 *
 * A shape cropped to a third of its width is drawn at a third of the content's
 * width, so the content itself is three times the box — that ratio is what
 * every crop-aware renderer needs and what this returns.
 */
export function getUncroppedSize(size: { w: number; h: number }, crop: TLShapeCrop | null | undefined): { w: number; h: number } {
  if (!crop) return { w: size.w, h: size.h }
  const cw = crop.bottomRight.x - crop.topLeft.x
  const ch = crop.bottomRight.y - crop.topLeft.y
  return {
    w: cw > 0 ? size.w / cw : size.w,
    h: ch > 0 ? size.h / ch : size.h,
  }
}
