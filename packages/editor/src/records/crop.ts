/**
 * Cropping, as it is stored on a shape.
 *
 * The crop itself — {@link TLShapeCrop} — is declared beside the cropping
 * helpers in `../shapes/crop`; what lives here is how it is stored and
 * validated.
 *
 * A crop is expressed in *normalised* coordinates — `0..1` of the source
 * image — not in page units. That is what makes a crop survive resizing: the
 * shape can be scaled to any size and the same fraction of the image stays
 * visible. Storing pixel offsets instead would silently re-crop the picture
 * every time someone dragged a corner.
 */

import { T } from "../validation/T"
import type { UnknownShape } from "./base"
import type { TLShapeCrop } from "../shapes/crop"

/** A shape that can be cropped: one whose props carry a `crop`. */
export type ShapeWithCrop = UnknownShape & { props: { w: number; h: number; crop: TLShapeCrop | null } }

const normalisedPoint = T.object({
  x: T.number.check("normalised", (value) => {
    if (value < 0 || value > 1) throw new Error(`Expected a value between 0 and 1, got ${String(value)}`)
  }),
  y: T.number.check("normalised", (value) => {
    if (value < 0 || value > 1) throw new Error(`Expected a value between 0 and 1, got ${String(value)}`)
  }),
})

/**
 * The validator an image-like shape declares its `crop` prop with.
 *
 * ```ts
 * static props = { w: T.nonZeroNumber, h: T.nonZeroNumber, crop: ImageShapeCrop.nullable() }
 * ```
 */
export const ImageShapeCrop = T.object({
  topLeft: normalisedPoint,
  bottomRight: normalisedPoint,
  isCircle: T.boolean.optional(),
})
