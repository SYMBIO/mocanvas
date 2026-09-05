/**
 * Scribbles: the short-lived ink an interaction leaves behind — an eraser's
 * trail, a laser pointer's stroke, a scribble-select lasso.
 *
 * They live on `instance` and `instance_presence` rather than as shapes because
 * nothing about them belongs in the document: they are never saved, never
 * undone, and they fade out on their own. Putting them in the record layer
 * anyway is what makes a collaborator's laser pointer visible without a second
 * transport.
 */

import { T } from "../validation/T"
import { canvasUiColorTypeValidator } from "./uiValues"

/**
 * A scribble's lifecycle. `starting` is drawn but not yet growing, `active`
 * follows the pointer, `paused` holds its shape, and `stopping` fades out —
 * which is why removal is a state rather than a deletion.
 */
export const TL_SCRIBBLE_STATES = ["starting", "paused", "active", "stopping"] as const

/** One of {@link TL_SCRIBBLE_STATES}. */
export type TLScribbleState = (typeof TL_SCRIBBLE_STATES)[number]

export const scribbleValidator = T.object({
  id: T.string,
  points: T.arrayOf(T.object({ x: T.number, y: T.number, z: T.number.optional() })),
  size: T.positiveNumber,
  color: canvasUiColorTypeValidator,
  opacity: T.positiveNumber,
  state: T.literalEnum(...TL_SCRIBBLE_STATES),
  /** Milliseconds before the tail starts retracting. `0` means "never". */
  delay: T.positiveNumber,
  /** How fast the tail retracts, as a fraction of its length per frame. */
  shrink: T.positiveNumber,
  /** Whether the stroke narrows towards its tail. */
  taper: T.boolean,
})
