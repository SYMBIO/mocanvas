/**
 * Turning a crop drag into a shape update.
 *
 * Cropping is not resizing: the content stays the size it was and the shape's
 * box moves over it, so a crop handle changes two things at once — the shape's
 * position and size, *and* the normalized window it shows. Getting the pair
 * consistent is the whole job, and it is the same job for every croppable
 * shape, so it lives here rather than in each util's `onCrop`.
 */

import {
  getUncroppedSize,
  type ShapeWithCrop,
  type TLCropInfo,
  type TLShapeCrop,
} from "@mocanvas/editor"

/** Limits {@link getCropBox} respects. */
export interface CropBoxOptions {
  /** The narrowest the shape's box may be cropped to, in page units. */
  minWidth?: number
  /** The shortest the shape's box may be cropped to, in page units. */
  minHeight?: number
}

/**
 * How small a crop may get by default.
 *
 * SEMANTICS-ASSUMED: not pinned by the docs. Small enough that a deliberate
 * sliver crop is possible, large enough that the shape never collapses to
 * something with no grabbable handles.
 */
const DEFAULT_MIN_CROP_SIZE = 8

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The shape update one step of a crop drag produces, or `undefined` when the
 * drag would change nothing.
 *
 * Returns a partial in the same form `onResize` does — `x`, `y` and the
 * changed props — so a util's `onCrop` can hand it straight back:
 *
 * ```ts
 * override onCrop(shape: ImageShape, info: TLCropInfo<ImageShape>) {
 *   return getCropBox(shape, info, { minWidth: 32 })
 * }
 * ```
 *
 * The handle being dragged decides which of the four normalized edges moves.
 * Each edge is clamped so the window stays inside `0…1` and so the box stays
 * above the minimum; because every step recomputes from `info.initialShape`
 * rather than from the shape's current state, a drag that hits a clamp and
 * comes back lands exactly where it would have without the clamp.
 */
export function getCropBox<T extends ShapeWithCrop>(
  shape: T,
  info: TLCropInfo<T>,
  options: CropBoxOptions = {},
): Partial<T> | undefined {
  const { handle, change, initialShape } = info
  const crop: TLShapeCrop = info.crop ?? { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } }
  const minWidth = options.minWidth ?? DEFAULT_MIN_CROP_SIZE
  const minHeight = options.minHeight ?? DEFAULT_MIN_CROP_SIZE

  // The content's full size at the shape's current scale: the frame the
  // normalized window is a fraction of, and what turns a pixel drag into one.
  const uncropped = getUncroppedSize({ w: initialShape.props.w, h: initialShape.props.h }, crop)
  if (uncropped.w <= 0 || uncropped.h <= 0) return undefined

  const movesLeft = handle === "left" || handle === "top_left" || handle === "bottom_left"
  const movesRight = handle === "right" || handle === "top_right" || handle === "bottom_right"
  const movesTop = handle === "top" || handle === "top_left" || handle === "top_right"
  const movesBottom = handle === "bottom" || handle === "bottom_left" || handle === "bottom_right"
  if (!movesLeft && !movesRight && !movesTop && !movesBottom) return undefined

  let { x: x0, y: y0 } = crop.topLeft
  let { x: x1, y: y1 } = crop.bottomRight

  // The most either edge may travel before the box is thinner than the minimum.
  const minCropW = minWidth / uncropped.w
  const minCropH = minHeight / uncropped.h

  if (movesLeft) x0 = clamp01(Math.min(x0 + change.x / uncropped.w, x1 - minCropW))
  if (movesRight) x1 = clamp01(Math.max(x1 + change.x / uncropped.w, x0 + minCropW))
  if (movesTop) y0 = clamp01(Math.min(y0 + change.y / uncropped.h, y1 - minCropH))
  if (movesBottom) y1 = clamp01(Math.max(y1 + change.y / uncropped.h, y0 + minCropH))

  const w = (x1 - x0) * uncropped.w
  const h = (y1 - y0) * uncropped.h
  if (w <= 0 || h <= 0) return undefined

  // A crop from the left or the top moves the shape as well as resizing it:
  // the content must not appear to slide under the window.
  const dx = movesLeft ? (x0 - crop.topLeft.x) * uncropped.w : 0
  const dy = movesTop ? (y0 - crop.topLeft.y) * uncropped.h : 0

  const next: TLShapeCrop = {
    topLeft: { x: x0, y: y0 },
    bottomRight: { x: x1, y: y1 },
    ...(crop.isCircle === undefined ? {} : { isCircle: crop.isCircle }),
  }

  return {
    x: initialShape.x + dx,
    y: initialShape.y + dy,
    props: { ...shape.props, w, h, crop: next },
  } as Partial<T>
}
