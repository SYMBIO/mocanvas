/**
 * The names of the eight resize handles and the four rotate handles, and the
 * arithmetic for moving between them when the thing being resized is rotated.
 *
 * These live with the geometry rather than with the select tool because {@link
 * Box} is the thing that resizes: `Box.Resize` and `Box.getHandlePoint` take a
 * handle name, and nothing above them should have to reach into a tool to name
 * one.
 */

/** A handle on the middle of one of a box's four sides. */
export type SelectionEdge = "top" | "right" | "bottom" | "left"

/** A handle on one of a box's four corners. */
export type SelectionCorner = "top_left" | "top_right" | "bottom_right" | "bottom_left"

/** The invisible handle just outside a corner that rotates instead of resizing. */
export type RotateCorner = "top_left_rotate" | "top_right_rotate" | "bottom_right_rotate" | "bottom_left_rotate" | "mobile_rotate"

/** The four sides, in clockwise order starting from the top. */
export const SIDES: readonly SelectionEdge[] = ["top", "right", "bottom", "left"] as const

/**
 * Which corner each rotate handle sits outside. `mobile_rotate` is the single
 * handle shown below a selection on touch, and it has no corner of its own; it
 * maps to the top left so that callers which need *a* corner get a stable one.
 */
export const ROTATE_CORNER_TO_SELECTION_CORNER: Record<RotateCorner, SelectionCorner> = {
  top_left_rotate: "top_left",
  top_right_rotate: "top_right",
  bottom_right_rotate: "bottom_right",
  bottom_left_rotate: "bottom_left",
  mobile_rotate: "top_left",
}

const ROTATION_ORDER: readonly (SelectionCorner | SelectionEdge)[] = [
  "top_left",
  "top",
  "top_right",
  "right",
  "bottom_right",
  "bottom",
  "bottom_left",
  "left",
]

/**
 * The handle you are really dragging once the selection is rotated.
 *
 * A shape rotated a quarter turn puts its `top_left` handle where an unrotated
 * shape's `top_right` would be, so a resize has to be resolved against the
 * shape's own axes before it means anything. Both corners and edges rotate, in
 * the same clockwise ring, an eighth of a turn per step.
 *
 * SEMANTICS-ASSUMED: the docs give the signature only. Rounding to the nearest
 * eighth is the choice that makes a 45° rotation resolve to the corner between
 * the two edges rather than flapping between them.
 */
export function rotateSelectionHandle<T extends SelectionCorner | SelectionEdge>(handle: T, rotation: number): T {
  const index = ROTATION_ORDER.indexOf(handle)
  if (index === -1) return handle
  // Normalize first: a negative rotation must still land on a positive index.
  const tau = Math.PI * 2
  const normalized = ((rotation % tau) + tau) % tau
  const steps = Math.round(normalized / (tau / 8))
  return ROTATION_ORDER[(index + steps) % 8] as T
}
